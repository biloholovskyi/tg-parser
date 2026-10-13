import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { AlertGate } from '../../alerts/interfaces/alert.interface';
import {
  closeApplication,
  describeError,
  EXIT_CODE_FAILURE,
  EXIT_CODE_SUCCESS,
  registerProcessHandlers,
  resetShutdownState,
  SHUTDOWN_SIGNALS,
  SHUTDOWN_TIMEOUT_MS,
} from './process-handlers';

type ProcessListener = (...args: unknown[]) => void;
type MockApp = { close: jest.Mock };

/**
 * The typed `process` overloads only accept signal names, so listener bookkeeping goes
 * through this narrow emitter view. Emitting events still uses the typed `process.emit`.
 */
const processEvents = process as unknown as {
  listeners(event: string): ProcessListener[];
  listenerCount(event: string): number;
  removeAllListeners(event: string): void;
  on(event: string, listener: ProcessListener): void;
};

const REJECTION_EVENT = 'unhandledRejection';
const EXCEPTION_EVENT = 'uncaughtException';
const MANAGED_EVENTS: string[] = [REJECTION_EVENT, EXCEPTION_EVENT, ...SHUTDOWN_SIGNALS];

const INPUT_ERROR_MESSAGE = 'fake network fault';
const INPUT_STRING_REASON = 'fake string reason';
const INPUT_HIDDEN_PAYLOAD = 'fake-hidden-payload';
const DESCRIBE_ERROR_FALLBACK = 'unknown error';
const SHUTDOWN_TIMEOUT_OVERSHOOT_MS = 1;

function createMockApp(): MockApp {
  return { close: jest.fn().mockResolvedValue(undefined) };
}

function asNestApp(mockApp: MockApp): INestApplication {
  return mockApp as unknown as INestApplication;
}

/** Lets the floating promise inside the handlers settle without a real timer. */
async function flushPendingPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * These specs attach real process listeners, so every managed event is emptied before
 * a test and its original listeners (the ones Jest installs included) are put back after.
 */
function detachManagedListeners(): Map<string, ProcessListener[]> {
  const savedListeners = new Map<string, ProcessListener[]>();

  for (const event of MANAGED_EVENTS) {
    savedListeners.set(event, processEvents.listeners(event));
    processEvents.removeAllListeners(event);
  }

  return savedListeners;
}

function restoreManagedListeners(savedListeners: Map<string, ProcessListener[]>): void {
  for (const event of MANAGED_EVENTS) {
    processEvents.removeAllListeners(event);

    for (const listener of savedListeners.get(event) ?? []) {
      processEvents.on(event, listener);
    }
  }
}

describe('registerProcessHandlers', () => {
  let mockApp: MockApp;
  let mockExit: jest.SpyInstance;
  let savedListeners: Map<string, ProcessListener[]>;

  beforeEach(() => {
    resetShutdownState();
    savedListeners = detachManagedListeners();
    mockApp = createMockApp();
    mockExit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    restoreManagedListeners(savedListeners);
    jest.restoreAllMocks();
    resetShutdownState();
  });

  it('registers one listener per managed process event', () => {
    registerProcessHandlers(asNestApp(mockApp));

    for (const event of MANAGED_EVENTS) {
      expect(processEvents.listenerCount(event)).toBe(1);
    }
  });

  it('logs an unhandled rejection and keeps the process alive', async () => {
    const inputReason = new Error(INPUT_ERROR_MESSAGE);
    registerProcessHandlers(asNestApp(mockApp));

    process.emit(REJECTION_EVENT, inputReason, Promise.resolve());
    await flushPendingPromises();

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining(INPUT_ERROR_MESSAGE),
    );
    expect(mockExit).not.toHaveBeenCalled();
    expect(mockApp.close).not.toHaveBeenCalled();
  });

  it('logs an unhandled rejection carrying a non-error reason without exiting', async () => {
    const inputReason = INPUT_STRING_REASON;
    registerProcessHandlers(asNestApp(mockApp));

    process.emit(REJECTION_EVENT, inputReason, Promise.resolve());
    await flushPendingPromises();

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining(INPUT_STRING_REASON),
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('keeps serving after repeated unhandled rejections', async () => {
    const inputReason = new Error(INPUT_ERROR_MESSAGE);
    registerProcessHandlers(asNestApp(mockApp));

    process.emit(REJECTION_EVENT, inputReason, Promise.resolve());
    process.emit(REJECTION_EVENT, inputReason, Promise.resolve());
    await flushPendingPromises();

    expect(Logger.prototype.error).toHaveBeenCalledTimes(2);
    expect(mockExit).not.toHaveBeenCalled();
    expect(mockApp.close).not.toHaveBeenCalled();
  });

  it('logs an uncaught exception, closes the application and exits with the failure code', async () => {
    const inputError = new Error(INPUT_ERROR_MESSAGE);
    registerProcessHandlers(asNestApp(mockApp));

    process.emit(EXCEPTION_EVENT, inputError);
    await flushPendingPromises();

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining(INPUT_ERROR_MESSAGE),
    );
    expect(mockApp.close).toHaveBeenCalledTimes(1);
    expect(mockExit).toHaveBeenCalledWith(EXIT_CODE_FAILURE);
  });

  it('closes the application before it exits on an uncaught exception', async () => {
    const inputError = new Error(INPUT_ERROR_MESSAGE);
    registerProcessHandlers(asNestApp(mockApp));

    process.emit(EXCEPTION_EVENT, inputError);
    await flushPendingPromises();

    const actualCloseOrder = mockApp.close.mock.invocationCallOrder[0];
    const actualExitOrder = mockExit.mock.invocationCallOrder[0];
    expect(actualCloseOrder).toBeLessThan(actualExitOrder);
  });

  it('closes and exits once for two uncaught exceptions in a row', async () => {
    const inputError = new Error(INPUT_ERROR_MESSAGE);
    registerProcessHandlers(asNestApp(mockApp));

    process.emit(EXCEPTION_EVENT, inputError);
    process.emit(EXCEPTION_EVENT, inputError);
    await flushPendingPromises();

    expect(mockApp.close).toHaveBeenCalledTimes(1);
    expect(mockExit).toHaveBeenCalledTimes(1);
    expect(mockExit).toHaveBeenCalledWith(EXIT_CODE_FAILURE);
  });

  for (const inputSignal of SHUTDOWN_SIGNALS) {
    it(`closes the application and exits with the success code on ${inputSignal}`, async () => {
      registerProcessHandlers(asNestApp(mockApp));

      process.emit(inputSignal, inputSignal);
      await flushPendingPromises();

      expect(Logger.prototype.log).toHaveBeenCalledWith(expect.stringContaining(inputSignal));
      expect(mockApp.close).toHaveBeenCalledTimes(1);
      expect(mockExit).toHaveBeenCalledWith(EXIT_CODE_SUCCESS);
    });
  }

  it('handles a repeated shutdown signal only once', async () => {
    const [inputSignal] = SHUTDOWN_SIGNALS;
    registerProcessHandlers(asNestApp(mockApp));

    process.emit(inputSignal, inputSignal);
    process.emit(inputSignal, inputSignal);
    await flushPendingPromises();

    expect(mockApp.close).toHaveBeenCalledTimes(1);
    expect(mockExit).toHaveBeenCalledTimes(1);
  });

  it('ignores the second shutdown signal when both signals arrive', async () => {
    const [inputFirstSignal, inputSecondSignal] = SHUTDOWN_SIGNALS;
    registerProcessHandlers(asNestApp(mockApp));

    process.emit(inputFirstSignal, inputFirstSignal);
    process.emit(inputSecondSignal, inputSecondSignal);
    await flushPendingPromises();

    expect(mockApp.close).toHaveBeenCalledTimes(1);
    expect(mockExit).toHaveBeenCalledTimes(1);
  });
});

describe('closeApplication', () => {
  let mockApp: MockApp;
  let mockExit: jest.SpyInstance;

  beforeEach(() => {
    resetShutdownState();
    mockApp = createMockApp();
    mockExit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    resetShutdownState();
  });

  it('closes the application and exits with the requested code', async () => {
    await closeApplication(asNestApp(mockApp), EXIT_CODE_SUCCESS);

    expect(mockApp.close).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.log).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(EXIT_CODE_SUCCESS);
  });

  it('still exits with the requested code when closing the application rejects', async () => {
    mockApp.close.mockRejectedValue(new Error(INPUT_ERROR_MESSAGE));

    await closeApplication(asNestApp(mockApp), EXIT_CODE_FAILURE);

    expect(mockExit).toHaveBeenCalledWith(EXIT_CODE_FAILURE);
  });

  it('logs the shutdown failure when closing the application rejects', async () => {
    mockApp.close.mockRejectedValue(new Error(INPUT_ERROR_MESSAGE));

    await closeApplication(asNestApp(mockApp), EXIT_CODE_FAILURE);

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining(INPUT_ERROR_MESSAGE),
    );
    expect(Logger.prototype.log).not.toHaveBeenCalled();
  });

  it('does not close or exit a second time after a completed shutdown', async () => {
    await closeApplication(asNestApp(mockApp), EXIT_CODE_SUCCESS);

    await closeApplication(asNestApp(mockApp), EXIT_CODE_FAILURE);

    expect(mockApp.close).toHaveBeenCalledTimes(1);
    expect(mockExit).toHaveBeenCalledTimes(1);
    expect(mockExit).toHaveBeenCalledWith(EXIT_CODE_SUCCESS);
  });

  it('ignores a second call made while the first shutdown is still in flight', async () => {
    let resolveClose: () => void = () => undefined;
    mockApp.close.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveClose = resolve;
      }),
    );

    const actualFirstShutdown = closeApplication(asNestApp(mockApp), EXIT_CODE_SUCCESS);
    await closeApplication(asNestApp(mockApp), EXIT_CODE_FAILURE);

    expect(mockApp.close).toHaveBeenCalledTimes(1);
    expect(mockExit).not.toHaveBeenCalled();

    resolveClose();
    await actualFirstShutdown;

    expect(mockApp.close).toHaveBeenCalledTimes(1);
    expect(mockExit).toHaveBeenCalledTimes(1);
    expect(mockExit).toHaveBeenCalledWith(EXIT_CODE_SUCCESS);
  });

  it('exits with the requested code once the shutdown timeout elapses on a close that never settles', async () => {
    jest.useFakeTimers();
    mockApp.close.mockReturnValue(new Promise<void>(() => undefined));

    const actualShutdown = closeApplication(asNestApp(mockApp), EXIT_CODE_FAILURE);
    await jest.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS + SHUTDOWN_TIMEOUT_OVERSHOOT_MS);
    await actualShutdown;

    expect(mockExit).toHaveBeenCalledWith(EXIT_CODE_FAILURE);
  });

  it('logs the timeout as a shutdown failure when the close never settles', async () => {
    jest.useFakeTimers();
    mockApp.close.mockReturnValue(new Promise<void>(() => undefined));

    const actualShutdown = closeApplication(asNestApp(mockApp), EXIT_CODE_FAILURE);
    await jest.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS + SHUTDOWN_TIMEOUT_OVERSHOOT_MS);
    await actualShutdown;

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining(String(SHUTDOWN_TIMEOUT_MS)),
    );
    expect(Logger.prototype.log).not.toHaveBeenCalled();
  });

  it('does not exit before the shutdown timeout elapses', async () => {
    jest.useFakeTimers();
    mockApp.close.mockReturnValue(new Promise<void>(() => undefined));

    const actualShutdown = closeApplication(asNestApp(mockApp), EXIT_CODE_FAILURE);
    await jest.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS - SHUTDOWN_TIMEOUT_OVERSHOOT_MS);

    expect(mockExit).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_OVERSHOOT_MS);
    await actualShutdown;

    expect(mockExit).toHaveBeenCalledWith(EXIT_CODE_FAILURE);
  });
});

describe('describeError', () => {
  it('returns the name and the message of an error', () => {
    const inputError = new Error(INPUT_ERROR_MESSAGE);

    const actualDescription = describeError(inputError);

    expect(actualDescription).toBe(`Error: ${INPUT_ERROR_MESSAGE}`);
  });

  it('keeps the concrete error subclass name', () => {
    const inputError = new TypeError(INPUT_ERROR_MESSAGE);

    const actualDescription = describeError(inputError);

    expect(actualDescription).toBe(`TypeError: ${INPUT_ERROR_MESSAGE}`);
  });

  it('returns a string reason unchanged', () => {
    const inputReason = INPUT_STRING_REASON;

    const actualDescription = describeError(inputReason);

    expect(actualDescription).toBe(INPUT_STRING_REASON);
  });

  it('falls back to a fixed text for a non-error object and never leaks its payload', () => {
    const inputReason = { detail: INPUT_HIDDEN_PAYLOAD };

    const actualDescription = describeError(inputReason);

    expect(actualDescription).toBe(DESCRIBE_ERROR_FALLBACK);
    expect(actualDescription).not.toContain(INPUT_HIDDEN_PAYLOAD);
  });

  it('falls back to a fixed text for undefined, null and a number', () => {
    expect(describeError(undefined)).toBe(DESCRIBE_ERROR_FALLBACK);
    expect(describeError(null)).toBe(DESCRIBE_ERROR_FALLBACK);
    expect(describeError(EXIT_CODE_FAILURE)).toBe(DESCRIBE_ERROR_FALLBACK);
  });
});

describe('resetShutdownState', () => {
  let mockApp: MockApp;
  let mockExit: jest.SpyInstance;

  beforeEach(() => {
    resetShutdownState();
    mockApp = createMockApp();
    mockExit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resetShutdownState();
  });

  it('clears the latch so a later shutdown closes the application again', async () => {
    await closeApplication(asNestApp(mockApp), EXIT_CODE_SUCCESS);

    resetShutdownState();
    await closeApplication(asNestApp(mockApp), EXIT_CODE_FAILURE);

    expect(mockApp.close).toHaveBeenCalledTimes(2);
    expect(mockExit).toHaveBeenLastCalledWith(EXIT_CODE_FAILURE);
  });
});

describe('process handlers with an alert sink', () => {
  let mockApp: MockApp;
  let mockExit: jest.SpyInstance;
  let mockAlerts: {
    info: jest.Mock;
    warning: jest.Mock;
    error: jest.Mock;
    beginShutdown: jest.Mock;
  };
  let savedListeners: Map<string, ProcessListener[]>;

  function asAlertGate(): AlertGate {
    return mockAlerts as unknown as AlertGate;
  }

  beforeEach(() => {
    resetShutdownState();
    savedListeners = detachManagedListeners();
    mockApp = createMockApp();
    mockAlerts = {
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn(),
      beginShutdown: jest.fn(),
    };
    mockExit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    restoreManagedListeners(savedListeners);
    jest.restoreAllMocks();
    resetShutdownState();
  });

  it('sends one error for an unhandled rejection and keeps the process running', async () => {
    // Arrange
    registerProcessHandlers(asNestApp(mockApp), asAlertGate());

    // Act
    process.emit(REJECTION_EVENT, new Error(INPUT_ERROR_MESSAGE), Promise.resolve());
    await flushPendingPromises();

    // Assert
    expect(mockAlerts.error).toHaveBeenCalledTimes(1);
    expect(mockAlerts.error).toHaveBeenCalledWith('Unhandled promise rejection', {
      error: `Error: ${INPUT_ERROR_MESSAGE}`,
    });
    expect(mockApp.close).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('describes a non-error rejection without leaking its payload', async () => {
    // Arrange
    registerProcessHandlers(asNestApp(mockApp), asAlertGate());

    // Act
    process.emit(REJECTION_EVENT, { detail: INPUT_HIDDEN_PAYLOAD }, Promise.resolve());
    await flushPendingPromises();

    // Assert
    expect(mockAlerts.error).toHaveBeenCalledWith('Unhandled promise rejection', {
      error: DESCRIBE_ERROR_FALLBACK,
    });
    expect(JSON.stringify(mockAlerts.error.mock.calls)).not.toContain(INPUT_HIDDEN_PAYLOAD);
  });

  it('sends one error for an uncaught exception before closing, then exits with failure', async () => {
    // Arrange
    registerProcessHandlers(asNestApp(mockApp), asAlertGate());

    // Act
    process.emit(EXCEPTION_EVENT, new TypeError(INPUT_ERROR_MESSAGE));
    await flushPendingPromises();

    // Assert
    expect(mockAlerts.error).toHaveBeenCalledTimes(1);
    expect(mockAlerts.error).toHaveBeenCalledWith('Uncaught exception, shutting down', {
      error: `TypeError: ${INPUT_ERROR_MESSAGE}`,
    });
    expect(mockAlerts.error.mock.invocationCallOrder[0]).toBeLessThan(
      mockApp.close.mock.invocationCallOrder[0],
    );
    expect(mockExit).toHaveBeenCalledWith(EXIT_CODE_FAILURE);
    expect(mockAlerts.warning).not.toHaveBeenCalled();
  });

  it('queues the uncaught exception alert before it begins the alert shutdown', async () => {
    // Arrange
    registerProcessHandlers(asNestApp(mockApp), asAlertGate());

    // Act
    process.emit(EXCEPTION_EVENT, new Error(INPUT_ERROR_MESSAGE));
    await flushPendingPromises();

    // Assert
    expect(mockAlerts.beginShutdown).toHaveBeenCalledTimes(1);
    expect(mockAlerts.error.mock.invocationCallOrder[0]).toBeLessThan(
      mockAlerts.beginShutdown.mock.invocationCallOrder[0],
    );
  });

  it('logs but sends no alert when closing fails after an uncaught exception', async () => {
    // Arrange
    mockApp.close.mockRejectedValue(new Error(INPUT_ERROR_MESSAGE));
    registerProcessHandlers(asNestApp(mockApp), asAlertGate());

    // Act
    process.emit(EXCEPTION_EVENT, new Error(INPUT_ERROR_MESSAGE));
    await flushPendingPromises();

    // Assert
    expect(mockAlerts.error).toHaveBeenCalledTimes(1);
    expect(mockAlerts.warning).not.toHaveBeenCalled();
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      `Error during shutdown: Error: ${INPUT_ERROR_MESSAGE}`,
    );
    expect(mockExit).toHaveBeenCalledWith(EXIT_CODE_FAILURE);
  });

  it('sends no alert when closing fails after a shutdown signal', async () => {
    // Arrange
    const [inputSignal] = SHUTDOWN_SIGNALS;
    mockApp.close.mockRejectedValue(new Error(INPUT_ERROR_MESSAGE));
    registerProcessHandlers(asNestApp(mockApp), asAlertGate());

    // Act
    process.emit(inputSignal, inputSignal);
    await flushPendingPromises();

    // Assert
    expect(mockAlerts.warning).not.toHaveBeenCalled();
    expect(mockAlerts.error).not.toHaveBeenCalled();
    expect(mockAlerts.beginShutdown).toHaveBeenCalledTimes(1);
    expect(mockExit).toHaveBeenCalledWith(EXIT_CODE_SUCCESS);
  });

  it('sends no alert for a clean shutdown on a signal', async () => {
    // Arrange
    const [inputSignal] = SHUTDOWN_SIGNALS;
    registerProcessHandlers(asNestApp(mockApp), asAlertGate());

    // Act
    process.emit(inputSignal, inputSignal);
    await flushPendingPromises();

    // Assert
    expect(mockAlerts.info).not.toHaveBeenCalled();
    expect(mockAlerts.warning).not.toHaveBeenCalled();
    expect(mockAlerts.error).not.toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(EXIT_CODE_SUCCESS);
  });

  it('logs the timeout and sends no alert when a direct close never settles', async () => {
    // Arrange
    jest.useFakeTimers();
    mockApp.close.mockReturnValue(new Promise<void>(() => undefined));

    // Act
    const actualShutdown = closeApplication(asNestApp(mockApp), EXIT_CODE_FAILURE, asAlertGate());
    await jest.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS + SHUTDOWN_TIMEOUT_OVERSHOOT_MS);
    await actualShutdown;
    jest.useRealTimers();

    // Assert
    expect(mockAlerts.warning).not.toHaveBeenCalled();
    expect(mockAlerts.error).not.toHaveBeenCalled();
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining(String(SHUTDOWN_TIMEOUT_MS)),
    );
    expect(mockExit).toHaveBeenCalledWith(EXIT_CODE_FAILURE);
  });

  it('begins the alert shutdown before it closes the application', async () => {
    // Act
    await closeApplication(asNestApp(mockApp), EXIT_CODE_SUCCESS, asAlertGate());

    // Assert
    expect(mockAlerts.beginShutdown).toHaveBeenCalledTimes(1);
    expect(mockAlerts.beginShutdown.mock.invocationCallOrder[0]).toBeLessThan(
      mockApp.close.mock.invocationCallOrder[0],
    );
  });

  it('begins the alert shutdown once when a second close arrives', async () => {
    // Act
    await closeApplication(asNestApp(mockApp), EXIT_CODE_SUCCESS, asAlertGate());
    await closeApplication(asNestApp(mockApp), EXIT_CODE_FAILURE, asAlertGate());

    // Assert
    expect(mockAlerts.beginShutdown).toHaveBeenCalledTimes(1);
    expect(mockApp.close).toHaveBeenCalledTimes(1);
  });

  it('begins the alert shutdown once when a signal and an uncaught exception race', async () => {
    // Arrange
    const [inputSignal] = SHUTDOWN_SIGNALS;
    registerProcessHandlers(asNestApp(mockApp), asAlertGate());

    // Act
    process.emit(inputSignal, inputSignal);
    process.emit(EXCEPTION_EVENT, new Error(INPUT_ERROR_MESSAGE));
    await flushPendingPromises();

    // Assert
    expect(mockAlerts.beginShutdown).toHaveBeenCalledTimes(1);
    expect(mockApp.close).toHaveBeenCalledTimes(1);
    expect(mockExit).toHaveBeenCalledTimes(1);
  });

  it('keeps handling every event without an alert sink', async () => {
    // Arrange
    mockApp.close.mockRejectedValue(new Error(INPUT_ERROR_MESSAGE));
    registerProcessHandlers(asNestApp(mockApp));

    // Act
    process.emit(REJECTION_EVENT, new Error(INPUT_ERROR_MESSAGE), Promise.resolve());
    process.emit(EXCEPTION_EVENT, new Error(INPUT_ERROR_MESSAGE));
    await flushPendingPromises();

    // Assert
    expect(mockApp.close).toHaveBeenCalledTimes(1);
    expect(mockExit).toHaveBeenCalledWith(EXIT_CODE_FAILURE);
    expect(mockAlerts.error).not.toHaveBeenCalled();
  });
});
