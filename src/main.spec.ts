import type { AlertsConfig } from './config/alerts.config';
import { ALERT_CALL_TIMEOUT_MS } from './alerts/constants';
import type { AlertPayload } from './alerts/interfaces/alert.interface';
import { EXIT_CODE_FAILURE } from './shared/utils/process-handlers';

const mockCreate = jest.fn();
const mockSendAlert = jest.fn();
const mockGetAlertsConfig = jest.fn();
const mockRegisterProcessHandlers = jest.fn();
const mockConfigureHttpPipeline = jest.fn();

/** The real root module pulls in GramJS, Redis and the digest. */
jest.mock('./app.module', () => ({ AppModule: class {} }));
jest.mock('@nestjs/core', () => ({
  ...jest.requireActual('@nestjs/core'),
  NestFactory: { create: (...args: unknown[]) => mockCreate(...args) },
}));
jest.mock('./alerts/alert-sender', () => ({
  ...jest.requireActual('./alerts/alert-sender'),
  sendAlert: (...args: unknown[]) => mockSendAlert(...args),
}));
jest.mock('./config/alerts.config', () => ({
  ...jest.requireActual('./config/alerts.config'),
  getAlertsConfig: () => mockGetAlertsConfig(),
}));
jest.mock('./shared/utils/http-pipeline', () => ({
  configureHttpPipeline: (...args: unknown[]) => mockConfigureHttpPipeline(...args),
}));
jest.mock('./shared/utils/process-handlers', () => ({
  ...jest.requireActual('./shared/utils/process-handlers'),
  registerProcessHandlers: (...args: unknown[]) => mockRegisterProcessHandlers(...args),
}));

const INPUT_BOOT_ERROR = 'fake listen EADDRINUSE';
const TIMER_SLACK_MS = 1;

const mockEnabledConfig: AlertsConfig = {
  url: 'https://alerts.example.test',
  apiKey: 'test-alert-key',
  serviceName: 'fake-service',
  isEnabled: true,
};

/** Runs `src/main.ts` once in a fresh module registry, as `node dist/main` would. */
async function runMain(): Promise<void> {
  await jest.isolateModulesAsync(async () => {
    // The fresh registry has its own Logger class, so the output is muted on that one.
    const { Logger: IsolatedLogger } = await import('@nestjs/common');
    jest.spyOn(IsolatedLogger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(IsolatedLogger.prototype, 'log').mockImplementation(() => undefined);
    await import('./main');
  });
}

describe('main bootstrap', () => {
  let mockExit: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    mockCreate.mockReset().mockRejectedValue(new Error(INPUT_BOOT_ERROR));
    mockSendAlert.mockReset().mockResolvedValue(undefined);
    mockGetAlertsConfig.mockReset().mockReturnValue(mockEnabledConfig);
    mockRegisterProcessHandlers.mockReset();
    mockConfigureHttpPipeline.mockReset();
    mockExit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('sends the boot failure alert before it exits with the failure code', async () => {
    // Arrange: NestFactory.create rejects in beforeEach

    // Act
    await runMain();
    await jest.advanceTimersByTimeAsync(0);

    // Assert
    expect(mockSendAlert).toHaveBeenCalledTimes(1);
    const [, actualPayload] = mockSendAlert.mock.calls[0] as [AlertsConfig, AlertPayload];
    expect(actualPayload).toMatchObject({
      level: 'error',
      message: 'Application failed to start',
      details: { reason: `Error: ${INPUT_BOOT_ERROR}` },
    });
    expect(mockExit).toHaveBeenCalledTimes(1);
    expect(mockExit).toHaveBeenCalledWith(EXIT_CODE_FAILURE);
    expect(mockSendAlert.mock.invocationCallOrder[0]).toBeLessThan(
      mockExit.mock.invocationCallOrder[0],
    );
  });

  it.each([
    ['a string', 'fake string boot failure', 'fake string boot failure'],
    ['a plain object', { detail: 'fake-hidden-payload' }, 'unknown error'],
  ])(
    'describes a boot rejected with %s through describeError',
    async (_label, inputRejection, expectedReason) => {
      // Arrange
      mockCreate.mockReset().mockRejectedValue(inputRejection);

      // Act
      await runMain();
      await jest.advanceTimersByTimeAsync(0);

      // Assert
      const [, actualPayload] = mockSendAlert.mock.calls[0] as [AlertsConfig, AlertPayload];
      expect(actualPayload.details).toEqual({ reason: expectedReason });
      expect(JSON.stringify(actualPayload)).not.toContain('fake-hidden-payload');
      expect(mockExit).toHaveBeenCalledWith(EXIT_CODE_FAILURE);
    },
  );

  it('exits once ALERT_CALL_TIMEOUT_MS elapses when the alert send hangs', async () => {
    // Arrange
    mockSendAlert.mockImplementation(
      (_target: unknown, _payload: unknown, signal?: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('fake aborted')));
        }),
    );

    // Act
    await runMain();
    await jest.advanceTimersByTimeAsync(ALERT_CALL_TIMEOUT_MS - TIMER_SLACK_MS);
    const actualExitCallsBeforeTimeout = mockExit.mock.calls.length;
    await jest.advanceTimersByTimeAsync(TIMER_SLACK_MS);

    // Assert
    expect(actualExitCallsBeforeTimeout).toBe(0);
    expect(mockExit).toHaveBeenCalledWith(EXIT_CODE_FAILURE);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('exits without sending when alerts are disabled', async () => {
    // Arrange
    mockGetAlertsConfig.mockReturnValue({ ...mockEnabledConfig, isEnabled: false });

    // Act
    await runMain();
    await jest.advanceTimersByTimeAsync(0);

    // Assert
    expect(mockSendAlert).not.toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(EXIT_CODE_FAILURE);
  });

  it('passes the AlertService instance to the process handlers on a successful start', async () => {
    // Arrange
    const mockAlertSink = {
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn(),
      beginShutdown: jest.fn(),
    };
    const mockApp = {
      get: jest.fn().mockReturnValue(mockAlertSink),
      listen: jest.fn().mockResolvedValue(undefined),
    };
    mockCreate.mockResolvedValue(mockApp);

    // Act
    await runMain();
    await jest.advanceTimersByTimeAsync(0);

    // Assert
    expect(mockApp.get).toHaveBeenCalledTimes(1);
    expect((mockApp.get.mock.calls[0][0] as { name: string }).name).toBe('AlertService');
    expect(mockRegisterProcessHandlers).toHaveBeenCalledWith(mockApp, mockAlertSink);
    expect(mockApp.listen).toHaveBeenCalledTimes(1);
    expect(mockSendAlert).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });
});
