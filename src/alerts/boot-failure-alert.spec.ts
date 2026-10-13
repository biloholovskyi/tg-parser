import { Logger } from '@nestjs/common';
import * as alertsConfigModule from '../config/alerts.config';
import type { AlertsConfig } from '../config/alerts.config';
import * as alertSenderModule from './alert-sender';
import { sendBootFailureAlert } from './boot-failure-alert';
import { ALERTS_INGEST_PATH, ALERT_CALL_TIMEOUT_MS, ALERT_REDACTED } from './constants';
import type { AlertPayload } from './interfaces/alert.interface';

const BOOT_FAILURE_MESSAGE = 'Application failed to start';
const INPUT_REASON = 'fake listen EADDRINUSE';
/** Shaped like a GramJS StringSession; built in code so no fixture holds a session-like literal. */
const INPUT_FAKE_SESSION = '1' + 'A'.repeat(250);
const TIMER_SLACK_MS = 1;

const mockEnabledConfig: AlertsConfig = {
  url: 'https://alerts.example.test',
  apiKey: 'test-alert-key',
  serviceName: 'fake-service',
  isEnabled: true,
};

function abortError(): Error {
  return Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
}

describe('sendBootFailureAlert', () => {
  let configSpy: jest.SpyInstance<AlertsConfig, []>;
  let sendSpy: jest.SpyInstance<Promise<void>, Parameters<typeof alertSenderModule.sendAlert>>;

  /** Records how the call settles, so fake time can run before awaiting it. */
  function startAlert(reason: string): { settled: () => boolean; done: Promise<unknown> } {
    let isSettled = false;
    const done = sendBootFailureAlert(reason).then(
      (value) => {
        isSettled = true;
        return value;
      },
      (error: unknown) => {
        isSettled = true;
        return error;
      },
    );
    return { settled: () => isSettled, done };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    configSpy = jest
      .spyOn(alertsConfigModule, 'getAlertsConfig')
      .mockReturnValue(mockEnabledConfig);
    sendSpy = jest.spyOn(alertSenderModule, 'sendAlert').mockResolvedValue(undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('sends nothing and arms no timer when alerts are disabled', async () => {
    // Arrange
    configSpy.mockReturnValue({ ...mockEnabledConfig, url: '', isEnabled: false });

    // Act
    await sendBootFailureAlert(INPUT_REASON);

    // Assert
    expect(sendSpy).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('sends one error alert with the reason and clears its timer', async () => {
    // Arrange: alerts enabled in beforeEach

    // Act
    await sendBootFailureAlert(INPUT_REASON);

    // Assert
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [actualTarget, actualPayload, actualSignal] = sendSpy.mock.calls[0];
    expect(actualTarget).toBe(mockEnabledConfig);
    expect(actualPayload).toEqual<AlertPayload>({
      serviceName: mockEnabledConfig.serviceName,
      level: 'error',
      message: BOOT_FAILURE_MESSAGE,
      details: { reason: INPUT_REASON },
    });
    expect(actualSignal).toBeInstanceOf(AbortSignal);
    expect(actualSignal?.aborted).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('redacts a session string inside the reason', async () => {
    // Arrange
    const inputReason = `fake failure ${INPUT_FAKE_SESSION}`;

    // Act
    await sendBootFailureAlert(inputReason);

    // Assert
    const [, actualPayload] = sendSpy.mock.calls[0];
    const actualText = JSON.stringify(actualPayload);
    expect(actualText).not.toContain(INPUT_FAKE_SESSION);
    expect(actualPayload.details).toEqual({ reason: `fake failure ${ALERT_REDACTED}` });
  });

  it('resolves and clears its timer when the send rejects', async () => {
    // Arrange
    sendSpy.mockRejectedValue(new alertSenderModule.AlertSendError('HTTP 503', true));

    // Act
    const actualResult = sendBootFailureAlert(INPUT_REASON);

    // Assert
    await expect(actualResult).resolves.toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('aborts a hanging send after ALERT_CALL_TIMEOUT_MS and then resolves', async () => {
    // Arrange
    sendSpy.mockImplementation(
      (_target, _payload, signal) =>
        new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(abortError()));
        }),
    );

    // Act
    const actualCall = startAlert(INPUT_REASON);
    await jest.advanceTimersByTimeAsync(ALERT_CALL_TIMEOUT_MS - TIMER_SLACK_MS);
    const isSettledBeforeTimeout = actualCall.settled();
    await jest.advanceTimersByTimeAsync(TIMER_SLACK_MS);
    const actualResult = await actualCall.done;

    // Assert
    expect(isSettledBeforeTimeout).toBe(false);
    expect(actualResult).toBeUndefined();
    const [, , actualSignal] = sendSpy.mock.calls[0];
    expect(actualSignal?.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('ends within ALERT_CALL_TIMEOUT_MS through the real sender when fetch never answers', async () => {
    // Arrange
    sendSpy.mockRestore();
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(abortError()));
        }),
    );

    // Act
    const actualCall = startAlert(INPUT_REASON);
    await jest.advanceTimersByTimeAsync(ALERT_CALL_TIMEOUT_MS);
    const actualResult = await actualCall.done;

    // Assert
    expect(actualResult).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe(`${mockEnabledConfig.url}${ALERTS_INGEST_PATH}`);
    expect(jest.getTimerCount()).toBe(0);
  });
});
