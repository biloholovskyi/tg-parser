import { Logger } from '@nestjs/common';
import type { AlertsConfig } from '../config/alerts.config';
import * as alertSanitizer from './alert-sanitizer';
import { AlertSendError, sendAlert } from './alert-sender';
import { AlertService } from './alert.service';
import {
  ALERT_DEDUP_WINDOW_MS,
  ALERT_DRAIN_TIMEOUT_MS,
  ALERT_MAX_CONCURRENT,
  ALERT_QUEUE_MAX_SIZE,
  ALERT_REDACTED,
} from './constants';
import type { AlertPayload } from './interfaces/alert.interface';

jest.mock('./alert-sender', () => ({
  ...jest.requireActual('./alert-sender'),
  sendAlert: jest.fn(),
}));

const LOGGER_LEVELS = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;
const FAKE_PHONE = '+10000000000';
const FLUSH_ROUNDS = 1000;

const mockConfig: AlertsConfig = {
  url: 'https://alerts.example.test',
  apiKey: 'test-alert-key',
  serviceName: 'fake-service',
  isEnabled: true,
};

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<void>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  for (let round = 0; round < FLUSH_ROUNDS; round++) {
    await Promise.resolve();
  }
}

describe('AlertService', () => {
  const mockSendAlert = sendAlert as jest.MockedFunction<typeof sendAlert>;
  let loggerSpies: jest.SpyInstance[];
  let service: AlertService;

  function sentPayloads(): AlertPayload[] {
    return mockSendAlert.mock.calls.map(([, payload]) => payload);
  }

  function loggedText(): string {
    return loggerSpies
      .flatMap((spy) => spy.mock.calls.flat())
      .map((arg) => String(arg))
      .join('\n');
  }

  function warnSpy(): jest.SpyInstance {
    return loggerSpies[LOGGER_LEVELS.indexOf('warn')];
  }

  beforeEach(() => {
    jest.useFakeTimers();
    mockSendAlert.mockReset();
    mockSendAlert.mockResolvedValue(undefined);
    loggerSpies = LOGGER_LEVELS.map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    );
    service = new AlertService(mockConfig);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('info, warning and error', () => {
    it.each(['info', 'warning', 'error'] as const)(
      '%s returns synchronously even when the send never settles',
      (inputLevel) => {
        // Arrange
        mockSendAlert.mockReturnValue(new Promise<void>(() => undefined));

        // Act
        const actualResult = service[inputLevel]('fake message');

        // Assert
        expect(actualResult).toBeUndefined();
        expect(mockSendAlert).toHaveBeenCalledTimes(1);
      },
    );

    it('sends nothing when alerts are disabled', async () => {
      // Arrange
      const disabledService = new AlertService({ ...mockConfig, isEnabled: false });

      // Act
      disabledService.info('fake info');
      disabledService.warning('fake warning');
      disabledService.error('fake error');
      await flushMicrotasks();

      // Assert
      expect(mockSendAlert).not.toHaveBeenCalled();
    });

    it('sends the config service name, the level and a sanitized message to the config target', () => {
      // Act
      service.error(`login failed for ${FAKE_PHONE}`, { attempt: 2, password: 'fake-password' });

      // Assert
      expect(mockSendAlert).toHaveBeenCalledTimes(1);
      const [actualTarget, actualPayload, actualSignal] = mockSendAlert.mock.calls[0];
      expect(actualTarget).toBe(mockConfig);
      expect(actualPayload).toEqual({
        serviceName: mockConfig.serviceName,
        level: 'error',
        message: `login failed for ${ALERT_REDACTED}`,
        details: { attempt: 2 },
      });
      expect(actualSignal).toBeInstanceOf(AbortSignal);
      expect(actualSignal?.aborted).toBe(false);
    });

    it('does not throw when building the payload throws', () => {
      // Arrange
      jest.spyOn(alertSanitizer, 'buildAlertPayload').mockImplementation(() => {
        throw new Error('fake build failure');
      });

      // Act
      const actualCall = (): void => service.error('fake error');

      // Assert
      expect(actualCall).not.toThrow();
      expect(mockSendAlert).not.toHaveBeenCalled();
    });
  });

  describe('delivery failures', () => {
    it('does not throw out and logs one warn line without the API key', async () => {
      // Arrange
      mockSendAlert.mockRejectedValue(new AlertSendError('HTTP 503', true));

      // Act
      service.error('fake error');
      await flushMicrotasks();

      // Assert
      expect(warnSpy()).toHaveBeenCalledTimes(1);
      expect(loggedText()).toContain('HTTP 503');
      expect(loggedText()).not.toContain(mockConfig.apiKey);
      expect(loggedText()).not.toContain(mockConfig.url);
    });

    it('logs a non-Error rejection as unknown', async () => {
      // Arrange
      mockSendAlert.mockRejectedValue('fake reason');

      // Act
      service.info('fake info');
      await flushMicrotasks();

      // Assert
      expect(warnSpy()).toHaveBeenCalledTimes(1);
      expect(loggedText()).toContain('unknown');
    });

    it('logs at most one failure line per ALERT_DEDUP_WINDOW_MS and counts the rest', async () => {
      // Arrange
      mockSendAlert.mockRejectedValue(new AlertSendError('HTTP 503', true));

      // Act
      service.info('first');
      await flushMicrotasks();
      service.info('second');
      await flushMicrotasks();
      const actualWarnsInWindow = warnSpy().mock.calls.length;
      jest.advanceTimersByTime(ALERT_DEDUP_WINDOW_MS);
      service.info('third');
      await flushMicrotasks();

      // Assert
      expect(actualWarnsInWindow).toBe(1);
      expect(warnSpy()).toHaveBeenCalledTimes(2);
      expect(String(warnSpy().mock.calls[1][0])).toContain('2 failed');
    });
  });

  describe('concurrency and queue', () => {
    it('keeps at most ALERT_MAX_CONCURRENT sends in flight and sends queued ones after', async () => {
      // Arrange
      const mockGates: Deferred[] = [];
      mockSendAlert.mockImplementation(() => {
        const gate = deferred();
        mockGates.push(gate);
        return gate.promise;
      });

      // Act
      for (let index = 0; index <= ALERT_MAX_CONCURRENT; index++) {
        service.info(`alert ${index}`);
      }
      const actualCallsWhileBusy = mockSendAlert.mock.calls.length;
      mockGates[0].resolve();
      await flushMicrotasks();

      // Assert
      expect(actualCallsWhileBusy).toBe(ALERT_MAX_CONCURRENT);
      expect(mockSendAlert).toHaveBeenCalledTimes(ALERT_MAX_CONCURRENT + 1);
      expect(sentPayloads()[ALERT_MAX_CONCURRENT].message).toBe(`alert ${ALERT_MAX_CONCURRENT}`);
    });

    it('drops alerts beyond ALERT_QUEUE_MAX_SIZE and reports the count on the next accepted one', async () => {
      // Arrange
      const mockGates: Deferred[] = [];
      mockSendAlert.mockImplementation(() => {
        const gate = deferred();
        mockGates.push(gate);
        return gate.promise;
      });
      for (let index = 0; index < ALERT_MAX_CONCURRENT + ALERT_QUEUE_MAX_SIZE; index++) {
        service.info(`accepted ${index}`);
      }
      service.info('dropped');
      mockGates[0].resolve();
      await flushMicrotasks();
      mockSendAlert.mockResolvedValue(undefined);

      // Act
      service.info('after overflow');
      mockGates.forEach((gate) => gate.resolve());
      await flushMicrotasks();

      // Assert
      const actualMessages = sentPayloads().map((payload) => payload.message);
      expect(actualMessages).not.toContain('dropped');
      expect(actualMessages).toHaveLength(ALERT_MAX_CONCURRENT + ALERT_QUEUE_MAX_SIZE + 1);
      const actualAfter = sentPayloads().find((payload) => payload.message === 'after overflow');
      expect(actualAfter?.details).toEqual({ droppedAlerts: 1 });
    });
  });

  describe('deduplication', () => {
    it.each(['warning', 'error'] as const)(
      'does not resend a duplicate %s inside the window and reports suppressed repeats after it',
      async (inputLevel) => {
        // Act
        service[inputLevel]('fake repeat');
        service[inputLevel]('fake repeat');
        service[inputLevel]('fake repeat');
        await flushMicrotasks();
        const actualCallsInWindow = mockSendAlert.mock.calls.length;
        jest.advanceTimersByTime(ALERT_DEDUP_WINDOW_MS);
        service[inputLevel]('fake repeat', { channel: 'fake_channel' });
        await flushMicrotasks();

        // Assert
        expect(actualCallsInWindow).toBe(1);
        expect(mockSendAlert).toHaveBeenCalledTimes(2);
        expect(sentPayloads()[1].details).toEqual({
          channel: 'fake_channel',
          suppressedRepeats: 2,
        });
      },
    );

    it('keeps warning and error with the same message apart', () => {
      // Act
      service.warning('fake same');
      service.error('fake same');

      // Assert
      expect(mockSendAlert).toHaveBeenCalledTimes(2);
    });

    it('never deduplicates info', async () => {
      // Act
      service.info('fake info');
      service.info('fake info');
      service.info('fake info');
      await flushMicrotasks();

      // Assert
      expect(mockSendAlert).toHaveBeenCalledTimes(3);
      sentPayloads().forEach((payload) => expect(payload.details).toBeUndefined());
    });
  });

  describe('onApplicationShutdown', () => {
    it('resolves at once when idle', async () => {
      // Act
      const actualOutcome = await Promise.race([
        service.onApplicationShutdown().then(() => 'resolved'),
        flushMicrotasks().then(() => 'pending'),
      ]);

      // Assert
      expect(actualOutcome).toBe('resolved');
      expect(jest.getTimerCount()).toBe(0);
    });

    it('waits for in-flight sends to settle', async () => {
      // Arrange
      const mockGate = deferred();
      mockSendAlert.mockReturnValue(mockGate.promise);
      service.error('fake error');
      let isResolved = false;

      // Act
      const actualShutdown = service.onApplicationShutdown().then(() => {
        isResolved = true;
      });
      await flushMicrotasks();
      const actualResolvedBeforeSettle = isResolved;
      mockGate.resolve();
      await actualShutdown;

      // Assert
      expect(actualResolvedBeforeSettle).toBe(false);
      expect(isResolved).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('resolves after ALERT_DRAIN_TIMEOUT_MS when a send hangs and aborts its signal', async () => {
      // Arrange
      mockSendAlert.mockReturnValue(new Promise<void>(() => undefined));
      service.error('fake error');
      const actualSignal = mockSendAlert.mock.calls[0][2] as AbortSignal;
      let isResolved = false;

      // Act
      const actualShutdown = service.onApplicationShutdown().then(() => {
        isResolved = true;
      });
      await jest.advanceTimersByTimeAsync(ALERT_DRAIN_TIMEOUT_MS - 1);
      const actualResolvedEarly = isResolved;
      const actualAbortedEarly = actualSignal.aborted;
      await jest.advanceTimersByTimeAsync(1);
      await actualShutdown;

      // Assert
      expect(actualResolvedEarly).toBe(false);
      expect(actualAbortedEarly).toBe(false);
      expect(isResolved).toBe(true);
      expect(actualSignal.aborted).toBe(true);
    });

    it('logs nothing when a send cut off by the drain timeout rejects afterwards', async () => {
      // Arrange
      const mockGate = deferred();
      mockSendAlert.mockReturnValue(mockGate.promise);
      service.error('fake error');
      const actualShutdown = service.onApplicationShutdown();
      await jest.advanceTimersByTimeAsync(ALERT_DRAIN_TIMEOUT_MS);
      await actualShutdown;

      // Act
      mockGate.reject(new AlertSendError('aborted', false));
      await flushMicrotasks();

      // Assert
      expect(warnSpy()).not.toHaveBeenCalled();
      expect(loggedText()).toBe('');
    });

    it('ignores alerts reported after shutdown', async () => {
      // Arrange
      await service.onApplicationShutdown();

      // Act
      service.info('late info');
      service.error('late error');
      await flushMicrotasks();

      // Assert
      expect(mockSendAlert).not.toHaveBeenCalled();
    });
  });
});
