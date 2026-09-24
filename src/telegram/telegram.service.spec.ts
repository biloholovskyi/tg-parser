import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as fs from 'fs';
import { MS_IN_SECOND } from '../shared/constants/rate-limit.constants';
import { TooManyRequestsException } from '../shared/exceptions/too-many-requests.exception';
import {
  AUTH_INPUT_ERRORS,
  AUTH_STATE_SWEEP_INTERVAL_MS,
  AUTH_STATE_TTL_MS,
  CHANNEL_LOOKUP_FAILURE_PREFIXES,
  CONNECTION_LABEL,
  CONNECTION_RETRIES_COUNT,
  EXTERNAL_CALL_TIMEOUT_MS,
  FLOOD_SLEEP_THRESHOLD_S,
  POSTS_MAX_MESSAGES,
  POSTS_PAGE_SIZE,
  REQUEST_RETRIES_COUNT,
  PHONE_FLOOD_ERRORS,
  PHONE_FLOOD_RETRY_AFTER_S,
  RETRY_DELAY_MS,
  SECONDS_IN_HOUR,
  TIMEOUT_SUFFIX,
} from './constants';
import { AuthService } from './auth.service';
import { ChannelService } from './channel.service';
import { SessionStore } from './session-store';
import { TelegramClientFactory } from './telegram-client.factory';
import { TelegramService } from './telegram.service';
import {
  CHANNEL_UNAVAILABLE_MESSAGE,
  INVALID_SESSION_MESSAGE,
  MISSING_CONFIG_MESSAGE,
  TELEGRAM_FAILED_MESSAGE,
  TELEGRAM_UNAVAILABLE_MESSAGE,
} from './utils/telegram-errors';

interface PageRequest {
  limit: number;
  offsetId: number;
}

interface MockTelegramClient {
  constructorArgs: unknown[];
  session: { save: jest.Mock<string, []> };
  connected: boolean;
  connect: jest.Mock<Promise<void>, []>;
  destroy: jest.Mock<Promise<void>, []>;
  invoke: jest.Mock<Promise<unknown>, [unknown]>;
  sendCode: jest.Mock<Promise<{ phoneCodeHash: string }>, [unknown, string]>;
  getInputEntity: jest.Mock<Promise<unknown>, [string]>;
  getMessages: jest.Mock<Promise<unknown[]>, [unknown, PageRequest]>;
}

interface FakeMessageFields {
  id: number;
  date: number;
  message?: string;
  media?: unknown;
  photo?: unknown;
  video?: unknown;
  document?: unknown;
}

type FakeMessageClass = new (fields: FakeMessageFields) => FakeMessageFields;

const mockCreatedClients: MockTelegramClient[] = [];
let mockConfigureClient: (client: MockTelegramClient) => void = () => undefined;
const mockFakeConfig = { apiId: 1, apiHash: 'fake-api-hash' };
let mockActiveConfig: { apiId: number; apiHash: string } = { ...mockFakeConfig };
const mockFakeSessionString = 'fake-session';
const mockFakeInputChannel = { fakeInputPeer: 'fake-channel-peer' };

jest.mock('telegram', () => ({
  TelegramClient: class {
    constructorArgs: unknown[];
    session: unknown;
    connected = true;
    connect = jest.fn().mockResolvedValue(undefined);
    destroy = jest.fn().mockResolvedValue(undefined);
    invoke = jest.fn().mockResolvedValue({});
    sendCode = jest.fn().mockResolvedValue({ phoneCodeHash: 'fake-code-hash' });
    getInputEntity = jest.fn().mockResolvedValue(mockFakeInputChannel);
    getMessages = jest.fn().mockResolvedValue([]);

    constructor(...args: unknown[]) {
      this.constructorArgs = args;
      this.session = args[0];
      mockCreatedClients.push(this as unknown as MockTelegramClient);
      mockConfigureClient(this as unknown as MockTelegramClient);
    }
  },
}));

jest.mock('telegram/sessions', () => ({
  StringSession: class {
    save = jest.fn(() => mockFakeSessionString);

    constructor(readonly initial: string) {}
  },
}));

jest.mock('telegram/tl', () => {
  class MockRequest {
    constructor(readonly args?: unknown) {}
  }
  class MockMessage {
    constructor(fields: object) {
      Object.assign(this, fields);
    }
  }
  class MockMessageService {
    constructor(fields: object) {
      Object.assign(this, fields);
    }
  }
  return {
    Api: {
      auth: { SignIn: MockRequest, CheckPassword: MockRequest },
      account: { GetPassword: MockRequest },
      users: { GetUsers: MockRequest },
      InputUserSelf: MockRequest,
      Message: MockMessage,
      MessageService: MockMessageService,
    },
  };
});

jest.mock('telegram/extensions/Logger', () => ({
  Logger: class {
    constructor(readonly level?: string) {}
  },
  LogLevel: { NONE: 'none', ERROR: 'error', WARN: 'warn', INFO: 'info', DEBUG: 'debug' },
}));

jest.mock('telegram/Password', () => ({
  computeCheck: jest.fn().mockResolvedValue({}),
}));

let mockConfigError: Error | undefined;

jest.mock('../config/telegram.config', () => ({
  getTelegramConfig: () => {
    if (mockConfigError) {
      throw mockConfigError;
    }
    return { ...mockActiveConfig };
  },
}));

/**
 * The filesystem stays real, but every sync and promise-based read or write is observed, so a
 * spec can prove the memory-only session model never reaches the disk.
 */
jest.mock('fs', () => {
  const actualFs = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actualFs,
    mkdirSync: jest.fn(actualFs.mkdirSync),
    existsSync: jest.fn(actualFs.existsSync),
    readFileSync: jest.fn(actualFs.readFileSync),
    writeFileSync: jest.fn(actualFs.writeFileSync),
    promises: {
      ...actualFs.promises,
      mkdir: jest.fn(actualFs.promises.mkdir),
      readFile: jest.fn(actualFs.promises.readFile),
      writeFile: jest.fn(actualFs.promises.writeFile),
    },
  };
});

const { Api: mockApi } = jest.requireMock<{
  Api: { Message: FakeMessageClass; MessageService: FakeMessageClass };
}>('telegram/tl');

const { Logger: MockGramLogger, LogLevel: mockLogLevel } = jest.requireMock<{
  Logger: new (level?: string) => { level?: string };
  LogLevel: { ERROR: string };
}>('telegram/extensions/Logger');

const inputPhoneNumber = '+10000000000';
const inputOtherPhoneNumber = '+10000000001';
const inputPhoneCode = '00000';
const inputPassword = 'fake-2fa-password';
const inputChannel = 'fake_channel';
const INPUT_HOURS_BACK = 1;
const INPUT_FLOOD_SECONDS = 30;
const SERVICE_BACKGROUND_TIMER_COUNT = 2;
const SHORT_PAGE_SIZE = 3;
const FIRST_MESSAGE_ID = 1_000_000;
const PROBE_LIMIT = 1;

/** A fixed clock: 2023-11-14T22:13:20Z, with the window start derived from INPUT_HOURS_BACK. */
const FAKE_NOW_MS = 1_700_000_000_000;
const WINDOW_START_S = FAKE_NOW_MS / MS_IN_SECOND - INPUT_HOURS_BACK * SECONDS_IN_HOUR;
const IN_WINDOW_DATE_S = WINDOW_START_S;
const OLDER_DATE_S = WINDOW_START_S - 1;

const CODE_NOT_REQUESTED_PATTERN = /Request a code first/;

/** A fake GramJS RPCError: the exact MTProto code travels in `errorMessage`. */
function rpcError(code: string): Error {
  return Object.assign(new Error(`RPCError: 400: ${code} (caused by fake.Call)`), {
    errorMessage: code,
  });
}

function buildMessage(id: number, date: number = IN_WINDOW_DATE_S): FakeMessageFields {
  return new mockApi.Message({ id, date, message: `fake post ${id}` });
}

function buildServiceMessage(id: number, date: number = IN_WINDOW_DATE_S): FakeMessageFields {
  return new mockApi.MessageService({ id, date });
}

/** A newest-first page of in-window posts with descending ids starting at `firstId`. */
function buildPage(firstId: number, size: number, date = IN_WINDOW_DATE_S): FakeMessageFields[] {
  return Array.from({ length: size }, (_unused, index) => buildMessage(firstId - index, date));
}

function lastIdOf(page: FakeMessageFields[]): number {
  return page[page.length - 1].id;
}

/** Full in-window pages that together reach exactly POSTS_MAX_MESSAGES items. */
function buildPagesUpToCeiling(withServiceMessage = false): FakeMessageFields[][] {
  const pages: FakeMessageFields[][] = [];
  let nextId = FIRST_MESSAGE_ID;
  for (let walked = 0; walked < POSTS_MAX_MESSAGES; walked += POSTS_PAGE_SIZE) {
    const page = buildPage(nextId, POSTS_PAGE_SIZE);
    if (withServiceMessage) {
      page[0] = buildServiceMessage(page[0].id);
    }
    pages.push(page);
    nextId = lastIdOf(page) - 1;
  }
  return pages;
}

function queuePages(client: MockTelegramClient, pages: FakeMessageFields[][]): void {
  for (const page of pages) {
    client.getMessages.mockResolvedValueOnce(page);
  }
}

/** Asserts the exception class and the caller-facing message; the `cause` is not compared. */
async function expectHttpError(
  actualPromise: Promise<unknown>,
  expectedClass: new (...args: never[]) => HttpException,
  expectedMessage: string,
): Promise<void> {
  const actualError = await actualPromise.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(actualError).toBeInstanceOf(expectedClass);
  expect((actualError as HttpException).message).toBe(expectedMessage);
}

const LOGGER_LEVELS = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;
type LoggerLevel = (typeof LOGGER_LEVELS)[number];
type LoggerSpies = Record<LoggerLevel, jest.SpyInstance>;

function spyOnLogger(): LoggerSpies {
  return Object.fromEntries(
    LOGGER_LEVELS.map((level) => [
      level,
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    ]),
  ) as LoggerSpies;
}

function clearLoggerSpies(spies: LoggerSpies): void {
  for (const level of LOGGER_LEVELS) {
    spies[level].mockClear();
  }
}

/** Total number of log calls at every level since the last clear. */
function countLogLines(spies: LoggerSpies): number {
  return LOGGER_LEVELS.reduce((total, level) => total + spies[level].mock.calls.length, 0);
}

/** Every argument passed to any logger level, stringified, so objects cannot hide a secret. */
function loggedText(spies: LoggerSpies): string {
  return LOGGER_LEVELS.flatMap((level) => spies[level].mock.calls.flat())
    .map((argument) => (typeof argument === 'string' ? argument : JSON.stringify(argument)))
    .join(' | ');
}

async function authenticateFully(service: TelegramService): Promise<MockTelegramClient> {
  await service.authenticate(inputPhoneNumber);
  const client = mockCreatedClients[mockCreatedClients.length - 1];
  await service.authenticate(inputPhoneNumber, inputPhoneCode);
  return client;
}

/** The production wiring of the module, built by hand: factory -> store -> services -> facade. */
interface ServiceGraph {
  service: TelegramService;
  sessions: SessionStore;
}

function buildService(): ServiceGraph {
  const factory = new TelegramClientFactory();
  const sessions = new SessionStore(factory);
  const auth = new AuthService(factory, sessions);
  const channels = new ChannelService(sessions);
  return { service: new TelegramService(auth, channels, sessions), sessions };
}

/** The caller-facing message configured for an auth-input MTProto code. */
function authInputMessageFor(inputCode: string): string {
  const entry = AUTH_INPUT_ERRORS.find(([code]) => code === inputCode);
  if (!entry) {
    throw new Error(`No AUTH_INPUT_ERRORS entry for ${inputCode}`);
  }
  return entry[1];
}

/** The HTTP exception a call rejected with; fails the test when the call resolves instead. */
async function captureHttpError(actualPromise: Promise<unknown>): Promise<HttpException> {
  const actualError = await actualPromise.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(actualError).toBeInstanceOf(HttpException);
  return actualError as HttpException;
}

/** Every observed filesystem entry point; the session model must call none of them. */
function observedFsCalls(): number {
  const observed = [
    fs.mkdirSync,
    fs.existsSync,
    fs.readFileSync,
    fs.writeFileSync,
    fs.promises.mkdir,
    fs.promises.readFile,
    fs.promises.writeFile,
  ];
  for (const fsFunction of observed) {
    expect(jest.isMockFunction(fsFunction)).toBe(true);
  }
  return observed.reduce(
    (total, fsFunction) => total + jest.mocked(fsFunction).mock.calls.length,
    0,
  );
}

describe('TelegramService', () => {
  let service: TelegramService;
  let sessions: SessionStore;
  let loggerSpies: LoggerSpies;

  beforeEach(() => {
    jest.useFakeTimers();
    mockCreatedClients.length = 0;
    mockConfigureClient = () => undefined;
    mockActiveConfig = { ...mockFakeConfig };
    mockConfigError = undefined;
    loggerSpies = spyOnLogger();
    ({ service, sessions } = buildService());
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('createClient', () => {
    it('passes explicit GramJS options from named constants', async () => {
      // Arrange
      const expectedOptions = {
        floodSleepThreshold: FLOOD_SLEEP_THRESHOLD_S,
        connectionRetries: CONNECTION_RETRIES_COUNT,
        requestRetries: REQUEST_RETRIES_COUNT,
        retryDelay: RETRY_DELAY_MS,
        autoReconnect: true,
        baseLogger: expect.any(MockGramLogger),
      };

      // Act
      const actualResult = await service.authenticate(inputPhoneNumber);

      // Assert
      expect(actualResult.needsCode).toBe(true);
      expect(mockCreatedClients).toHaveLength(1);
      const [, actualApiId, actualApiHash, actualOptions] = mockCreatedClients[0].constructorArgs;
      expect(actualApiId).toBe(mockFakeConfig.apiId);
      expect(actualApiHash).toBe(mockFakeConfig.apiHash);
      expect(actualOptions).toEqual(expectedOptions);
    });

    it('gives GramJS its own logger capped at the ERROR level', async () => {
      // Act
      await service.authenticate(inputPhoneNumber);

      // Assert
      const [, , , actualOptions] = mockCreatedClients[0].constructorArgs as [
        unknown,
        unknown,
        unknown,
        { baseLogger: { level?: string } },
      ];
      expect(actualOptions.baseLogger).toBeInstanceOf(MockGramLogger);
      expect(actualOptions.baseLogger.level).toBe(mockLogLevel.ERROR);
    });
  });

  describe('authenticate step 1', () => {
    it('destroys the client when connect fails, maps the failure to 502 and stores no auth state', async () => {
      // Arrange
      mockConfigureClient = (client) => {
        client.connect.mockRejectedValue(new Error('fake connect failure'));
      };

      // Act
      const actualResult = service.authenticate(inputPhoneNumber);

      // Assert
      await expect(actualResult).rejects.toBeInstanceOf(BadGatewayException);
      expect(mockCreatedClients).toHaveLength(1);
      expect(mockCreatedClients[0].destroy).toHaveBeenCalled();
      expect(mockCreatedClients[0].sendCode).not.toHaveBeenCalled();
      await expect(service.authenticate(inputPhoneNumber, inputPhoneCode)).rejects.toThrow(
        CODE_NOT_REQUESTED_PATTERN,
      );
    });

    it('destroys the client when sendCode fails with PHONE_NUMBER_INVALID and returns 400', async () => {
      // Arrange
      const expectedMessage = authInputMessageFor('PHONE_NUMBER_INVALID');
      mockConfigureClient = (client) => {
        client.sendCode.mockRejectedValue(rpcError('PHONE_NUMBER_INVALID'));
      };

      // Act
      const actualResult = service.authenticate(inputPhoneNumber);

      // Assert
      await expectHttpError(actualResult, BadRequestException, expectedMessage);
      expect(mockCreatedClients[0].destroy).toHaveBeenCalled();
    });

    it('releases the previous pending client when step 1 is repeated', async () => {
      // Arrange
      await service.authenticate(inputPhoneNumber);
      const mockFirstClient = mockCreatedClients[0];

      // Act
      await service.authenticate(inputPhoneNumber);

      // Assert
      expect(mockFirstClient.destroy).toHaveBeenCalledTimes(1);
      expect(mockCreatedClients).toHaveLength(2);
      expect(mockCreatedClients[1].destroy).not.toHaveBeenCalled();
    });

    it('destroys the pending client stored by a concurrent step 1 when a later one overwrites it (M-3)', async () => {
      // Arrange
      const mockResolvers: Array<(value: { phoneCodeHash: string }) => void> = [];
      mockConfigureClient = (client) => {
        client.sendCode.mockReturnValue(
          new Promise((resolve) => {
            mockResolvers.push(resolve);
          }),
        );
      };
      const actualFirstCall = service.authenticate(inputPhoneNumber);
      const actualSecondCall = service.authenticate(inputPhoneNumber);
      await jest.advanceTimersByTimeAsync(0);
      expect(mockCreatedClients).toHaveLength(2);
      const [mockFirstClient, mockSecondClient] = mockCreatedClients;

      // Act
      mockResolvers[0]({ phoneCodeHash: 'fake-code-hash-first' });
      await actualFirstCall;
      const actualDestroyedBeforeOverwrite = mockFirstClient.destroy.mock.calls.length;
      mockResolvers[1]({ phoneCodeHash: 'fake-code-hash-second' });
      await actualSecondCall;

      // Assert
      expect(actualDestroyedBeforeOverwrite).toBe(0);
      expect(mockFirstClient.destroy).toHaveBeenCalledTimes(1);
      expect(mockSecondClient.destroy).not.toHaveBeenCalled();
      await service.authenticate(inputPhoneNumber, inputPhoneCode);
      expect(mockSecondClient.invoke).toHaveBeenCalledTimes(1);
      expect(mockFirstClient.invoke).not.toHaveBeenCalled();
    });

    it.each(PHONE_FLOOD_ERRORS)(
      'maps %s at send-code to 429 with PHONE_FLOOD_RETRY_AFTER_S and destroys the client',
      async (inputCode) => {
        // Arrange
        mockConfigureClient = (client) => {
          client.sendCode.mockRejectedValue(rpcError(inputCode));
        };

        // Act
        const actualError = await service.authenticate(inputPhoneNumber).catch((error) => error);

        // Assert
        expect(actualError).toBeInstanceOf(TooManyRequestsException);
        expect((actualError as TooManyRequestsException).retryAfterSeconds).toBe(
          PHONE_FLOOD_RETRY_AFTER_S,
        );
        expect(mockCreatedClients[0].destroy).toHaveBeenCalledTimes(1);
      },
    );

    it('maps a connect that exceeds the call timeout to 503 and destroys the client', async () => {
      // Arrange
      mockConfigureClient = (client) => {
        client.connect.mockReturnValue(new Promise(() => undefined));
      };

      // Act
      const actualResult = service.authenticate(inputPhoneNumber);
      const actualAssertion = expectHttpError(
        actualResult,
        ServiceUnavailableException,
        TELEGRAM_UNAVAILABLE_MESSAGE,
      );
      await jest.advanceTimersByTimeAsync(EXTERNAL_CALL_TIMEOUT_MS);

      // Assert
      await actualAssertion;
      expect(mockCreatedClients[0].destroy).toHaveBeenCalled();
      expect(mockCreatedClients[0].sendCode).not.toHaveBeenCalled();
      expect(loggerSpies.error).toHaveBeenCalledWith(
        expect.stringContaining(`${CONNECTION_LABEL}${TIMEOUT_SUFFIX}`),
      );
    });
  });

  describe('authenticate error mapping', () => {
    it('throws 500 with the configuration message when the credentials are missing', async () => {
      // Arrange
      mockActiveConfig = { apiId: 0, apiHash: '' };
      const { service: unconfiguredService } = buildService();

      try {
        // Act
        const actualResult = unconfiguredService.authenticate(inputPhoneNumber);

        // Assert
        await expect(actualResult).rejects.toBeInstanceOf(InternalServerErrorException);
        await expect(unconfiguredService.authenticate(inputPhoneNumber)).rejects.toThrow(
          MISSING_CONFIG_MESSAGE,
        );
        expect(mockCreatedClients).toHaveLength(0);
      } finally {
        await unconfiguredService.onModuleDestroy();
      }
    });

    it('rejects step 2 without a prior step 1 with 400', async () => {
      // Act
      const actualResult = service.authenticate(inputPhoneNumber, inputPhoneCode);

      // Assert
      await expect(actualResult).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.authenticate(inputPhoneNumber, inputPhoneCode)).rejects.toThrow(
        CODE_NOT_REQUESTED_PATTERN,
      );
      expect(mockCreatedClients).toHaveLength(0);
    });

    it.each(['PHONE_CODE_INVALID', 'PHONE_CODE_EXPIRED'])(
      'maps %s at sign-in to 400 with its own message and releases the client',
      async (inputCode) => {
        // Arrange
        const expectedMessage = authInputMessageFor(inputCode);
        await service.authenticate(inputPhoneNumber);
        const mockClient = mockCreatedClients[0];
        mockClient.invoke.mockRejectedValueOnce(rpcError(inputCode));

        // Act
        const actualResult = service.authenticate(inputPhoneNumber, inputPhoneCode);

        // Assert
        await expectHttpError(actualResult, BadRequestException, expectedMessage);
        expect(mockClient.destroy).toHaveBeenCalledTimes(1);
      },
    );

    it('maps a wrong 2FA password to 400 with a message distinct from the code errors', async () => {
      // Arrange
      const expectedMessage = authInputMessageFor('PASSWORD_HASH_INVALID');
      await service.authenticate(inputPhoneNumber);
      const mockClient = mockCreatedClients[0];
      mockClient.invoke
        .mockRejectedValueOnce(rpcError('SESSION_PASSWORD_NEEDED'))
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(rpcError('PASSWORD_HASH_INVALID'));

      // Act
      const actualResult = service.authenticate(inputPhoneNumber, inputPhoneCode, inputPassword);

      // Assert
      await expectHttpError(actualResult, BadRequestException, expectedMessage);
      expect(mockClient.destroy).toHaveBeenCalledTimes(1);
    });

    it('maps a flood wait at send-code to 429 with the wait duration', async () => {
      // Arrange
      mockConfigureClient = (client) => {
        client.sendCode.mockRejectedValue(rpcError(`FLOOD_WAIT_${INPUT_FLOOD_SECONDS}`));
      };

      // Act
      const actualError = await service.authenticate(inputPhoneNumber).catch((error) => error);

      // Assert
      expect(actualError).toBeInstanceOf(TooManyRequestsException);
      expect((actualError as TooManyRequestsException).retryAfterSeconds).toBe(INPUT_FLOOD_SECONDS);
      expect(mockCreatedClients[0].destroy).toHaveBeenCalled();
    });
  });

  describe('memory-only session model', () => {
    it('never touches the filesystem across a full 2FA login, a session check and a posts walk', async () => {
      // Arrange
      await service.authenticate(inputPhoneNumber);
      const mockClient = mockCreatedClients[0];
      mockClient.invoke
        .mockRejectedValueOnce(rpcError('SESSION_PASSWORD_NEEDED'))
        .mockRejectedValueOnce(rpcError('SESSION_PASSWORD_NEEDED'));
      await service.authenticate(inputPhoneNumber, inputPhoneCode);

      // Act
      const actualLogin = await service.authenticate(
        inputPhoneNumber,
        inputPhoneCode,
        inputPassword,
      );
      const actualCheck = await service.checkSession(mockFakeSessionString);
      const actualPosts = await service.getChannelPosts(inputChannel, mockFakeSessionString);
      await sessions.evict(mockFakeSessionString);

      // Assert
      expect(actualLogin.sessionString).toBe(mockFakeSessionString);
      expect(actualCheck).toEqual({ status: 'success' });
      expect(actualPosts.count).toBe(0);
      expect(observedFsCalls()).toBe(0);
    });

    it('never touches the filesystem when a login fails or a pending state expires', async () => {
      // Arrange
      await service.authenticate(inputPhoneNumber);
      mockCreatedClients[0].invoke.mockRejectedValueOnce(rpcError('PHONE_CODE_INVALID'));
      await service.authenticate(inputOtherPhoneNumber);

      // Act
      await service.authenticate(inputPhoneNumber, inputPhoneCode).catch(() => undefined);
      await jest.advanceTimersByTimeAsync(AUTH_STATE_TTL_MS + AUTH_STATE_SWEEP_INTERVAL_MS);

      // Assert
      expect(mockCreatedClients[1].destroy).toHaveBeenCalledTimes(1);
      expect(observedFsCalls()).toBe(0);
    });

    it('never touches the filesystem when the service is built and shut down', async () => {
      // Arrange
      const { service: inputService } = buildService();

      // Act
      await inputService.onModuleDestroy();

      // Assert
      expect(observedFsCalls()).toBe(0);
    });
  });

  describe('onModuleDestroy', () => {
    it('destroys cached and pending auth clients and clears every timer', async () => {
      // Arrange
      const mockCachedClient = await authenticateFully(service);
      await service.authenticate(inputOtherPhoneNumber);
      const mockPendingClient = mockCreatedClients[mockCreatedClients.length - 1];
      expect(jest.getTimerCount()).toBe(SERVICE_BACKGROUND_TIMER_COUNT);

      // Act
      await service.onModuleDestroy();

      // Assert
      expect(mockCachedClient.destroy).toHaveBeenCalledTimes(1);
      expect(mockPendingClient.destroy).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('checkSession', () => {
    it('reuses the cached client on a hit', async () => {
      // Arrange
      await authenticateFully(service);
      const expectedClientCount = mockCreatedClients.length;

      // Act
      const actualResult = await service.checkSession(mockFakeSessionString);

      // Assert
      expect(actualResult).toEqual({ status: 'success' });
      expect(mockCreatedClients).toHaveLength(expectedClientCount);
    });

    it('reports failed for a session with no cached client (empty cache after restart)', async () => {
      // Act
      const actualResult = await service.checkSession(mockFakeSessionString);

      // Assert
      expect(actualResult).toEqual({ status: 'failed' });
      expect(mockCreatedClients).toHaveLength(0);
    });

    it('evicts and destroys the client on AUTH_KEY_UNREGISTERED and reports failed', async () => {
      // Arrange
      const mockClient = await authenticateFully(service);
      mockClient.invoke.mockRejectedValue(rpcError('AUTH_KEY_UNREGISTERED'));
      const expectedClientCount = mockCreatedClients.length;

      // Act
      const actualFirstResult = await service.checkSession(mockFakeSessionString);
      const actualSecondResult = await service.checkSession(mockFakeSessionString);

      // Assert
      expect(actualFirstResult).toEqual({ status: 'failed' });
      expect(mockClient.destroy).toHaveBeenCalledTimes(1);
      expect(actualSecondResult).toEqual({ status: 'failed' });
      expect(mockClient.invoke).toHaveBeenCalledTimes(2);
      expect(mockCreatedClients).toHaveLength(expectedClientCount);
    });

    it('throws 503 on a connectivity failure instead of reporting failed, and keeps the client', async () => {
      // Arrange
      const mockClient = await authenticateFully(service);
      mockClient.invoke.mockRejectedValueOnce(new Error('fake ECONNRESET'));

      // Act
      const actualResult = service.checkSession(mockFakeSessionString);

      // Assert
      await expectHttpError(
        actualResult,
        ServiceUnavailableException,
        TELEGRAM_UNAVAILABLE_MESSAGE,
      );
      await expect(service.checkSession(mockFakeSessionString)).resolves.toEqual({
        status: 'success',
      });
      expect(mockClient.destroy).not.toHaveBeenCalled();
    });

    it('throws 503 when the self lookup exceeds the call timeout', async () => {
      // Arrange
      const mockClient = await authenticateFully(service);
      mockClient.invoke.mockReturnValueOnce(new Promise(() => undefined));

      // Act
      const actualResult = service.checkSession(mockFakeSessionString);
      const actualAssertion = expect(actualResult).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      await jest.advanceTimersByTimeAsync(EXTERNAL_CALL_TIMEOUT_MS);

      // Assert
      await actualAssertion;
      expect(mockClient.destroy).not.toHaveBeenCalled();
    });

    it('throws 429 on a flood wait instead of reporting failed', async () => {
      // Arrange
      const mockClient = await authenticateFully(service);
      mockClient.invoke.mockRejectedValueOnce(rpcError(`FLOOD_WAIT_${INPUT_FLOOD_SECONDS}`));

      // Act
      const actualResult = service.checkSession(mockFakeSessionString);

      // Assert
      await expect(actualResult).rejects.toBeInstanceOf(TooManyRequestsException);
      expect(mockClient.destroy).not.toHaveBeenCalled();
    });

    it('reconnects a cached client that reports disconnected', async () => {
      // Arrange
      const mockClient = await authenticateFully(service);
      mockClient.connected = false;
      const expectedConnectCount = mockClient.connect.mock.calls.length + 1;

      // Act
      const actualResult = await service.checkSession(mockFakeSessionString);

      // Assert
      expect(actualResult).toEqual({ status: 'success' });
      expect(mockClient.connect).toHaveBeenCalledTimes(expectedConnectCount);
    });
  });

  describe('getChannelPosts pagination', () => {
    let mockClient: MockTelegramClient;

    beforeEach(async () => {
      mockClient = await authenticateFully(service);
      jest.spyOn(Date, 'now').mockReturnValue(FAKE_NOW_MS);
    });

    it('returns a complete result for a single short page', async () => {
      // Arrange
      const inputPage = buildPage(FIRST_MESSAGE_ID, SHORT_PAGE_SIZE);
      queuePages(mockClient, [inputPage]);

      // Act
      const actualResult = await service.getChannelPosts(
        inputChannel,
        mockFakeSessionString,
        INPUT_HOURS_BACK,
      );

      // Assert
      expect(actualResult.count).toBe(SHORT_PAGE_SIZE);
      expect(actualResult.isTruncated).toBe(false);
      expect(actualResult.posts[0]).toEqual({
        id: FIRST_MESSAGE_ID,
        text: `fake post ${FIRST_MESSAGE_ID}`,
        date: new Date(IN_WINDOW_DATE_S * MS_IN_SECOND),
        media: [],
        postUrl: `https://t.me/${inputChannel}/${FIRST_MESSAGE_ID}`,
      });
      expect(mockClient.getInputEntity).toHaveBeenCalledTimes(1);
      expect(mockClient.getInputEntity).toHaveBeenCalledWith(inputChannel);
      expect(mockClient.getMessages).toHaveBeenCalledTimes(1);
      expect(mockClient.getMessages).toHaveBeenCalledWith(mockFakeInputChannel, {
        limit: POSTS_PAGE_SIZE,
        offsetId: 0,
      });
    });

    it('keeps a post dated exactly at the window start and drops one a second older', async () => {
      // Arrange
      queuePages(mockClient, [
        [
          buildMessage(FIRST_MESSAGE_ID, IN_WINDOW_DATE_S),
          buildMessage(FIRST_MESSAGE_ID - 1, OLDER_DATE_S),
        ],
      ]);

      // Act
      const actualResult = await service.getChannelPosts(
        inputChannel,
        mockFakeSessionString,
        INPUT_HOURS_BACK,
      );

      // Assert
      expect(actualResult.posts.map((post) => post.id)).toEqual([FIRST_MESSAGE_ID]);
      expect(actualResult.isTruncated).toBe(false);
    });

    it('stops at the page where the window ends without requesting another page', async () => {
      // Arrange
      const inputInWindowCount = POSTS_PAGE_SIZE / 2;
      const inputPage = [
        ...buildPage(FIRST_MESSAGE_ID, inputInWindowCount),
        ...buildPage(FIRST_MESSAGE_ID - inputInWindowCount, inputInWindowCount, OLDER_DATE_S),
      ];
      queuePages(mockClient, [
        inputPage,
        buildPage(FIRST_MESSAGE_ID - POSTS_PAGE_SIZE, POSTS_PAGE_SIZE),
      ]);

      // Act
      const actualResult = await service.getChannelPosts(
        inputChannel,
        mockFakeSessionString,
        INPUT_HOURS_BACK,
      );

      // Assert
      expect(actualResult.count).toBe(inputInWindowCount);
      expect(actualResult.isTruncated).toBe(false);
      expect(mockClient.getMessages).toHaveBeenCalledTimes(1);
    });

    it('walks multiple pages, passing the last id of the previous page as offsetId', async () => {
      // Arrange
      const inputFirstPage = buildPage(FIRST_MESSAGE_ID, POSTS_PAGE_SIZE);
      const inputSecondPage = buildPage(lastIdOf(inputFirstPage) - 1, SHORT_PAGE_SIZE);
      queuePages(mockClient, [inputFirstPage, inputSecondPage]);

      // Act
      const actualResult = await service.getChannelPosts(
        inputChannel,
        mockFakeSessionString,
        INPUT_HOURS_BACK,
      );

      // Assert
      expect(actualResult.count).toBe(POSTS_PAGE_SIZE + SHORT_PAGE_SIZE);
      expect(actualResult.isTruncated).toBe(false);
      expect(mockClient.getMessages.mock.calls.map(([, page]) => page)).toEqual([
        { limit: POSTS_PAGE_SIZE, offsetId: 0 },
        { limit: POSTS_PAGE_SIZE, offsetId: lastIdOf(inputFirstPage) },
      ]);
    });

    it('flags the result as truncated when the probe past the ceiling finds an in-window post', async () => {
      // Arrange
      const inputPages = buildPagesUpToCeiling();
      const expectedProbeOffsetId = lastIdOf(inputPages[inputPages.length - 1]);
      queuePages(mockClient, [...inputPages, [buildMessage(expectedProbeOffsetId - 1)]]);

      // Act
      const actualResult = await service.getChannelPosts(
        inputChannel,
        mockFakeSessionString,
        INPUT_HOURS_BACK,
      );

      // Assert
      expect(actualResult.isTruncated).toBe(true);
      expect(actualResult.count).toBe(POSTS_MAX_MESSAGES);
      expect(actualResult.count).toBeLessThanOrEqual(POSTS_MAX_MESSAGES);
      expect(mockClient.getMessages).toHaveBeenCalledTimes(inputPages.length + 1);
      expect(mockClient.getMessages).toHaveBeenLastCalledWith(mockFakeInputChannel, {
        limit: PROBE_LIMIT,
        offsetId: expectedProbeOffsetId,
      });
      for (const [, actualPage] of mockClient.getMessages.mock.calls) {
        expect(actualPage.limit).toBeLessThanOrEqual(POSTS_PAGE_SIZE);
      }
    });

    it('is not truncated when the probe past the ceiling finds nothing', async () => {
      // Arrange
      queuePages(mockClient, [...buildPagesUpToCeiling(), []]);

      // Act
      const actualResult = await service.getChannelPosts(
        inputChannel,
        mockFakeSessionString,
        INPUT_HOURS_BACK,
      );

      // Assert
      expect(actualResult.isTruncated).toBe(false);
      expect(actualResult.count).toBe(POSTS_MAX_MESSAGES);
    });

    it('is not truncated when the probe past the ceiling finds an older post', async () => {
      // Arrange
      const inputPages = buildPagesUpToCeiling();
      const inputProbeId = lastIdOf(inputPages[inputPages.length - 1]) - 1;
      queuePages(mockClient, [...inputPages, [buildMessage(inputProbeId, OLDER_DATE_S)]]);

      // Act
      const actualResult = await service.getChannelPosts(
        inputChannel,
        mockFakeSessionString,
        INPUT_HOURS_BACK,
      );

      // Assert
      expect(actualResult.isTruncated).toBe(false);
      expect(actualResult.count).toBe(POSTS_MAX_MESSAGES);
    });

    it('skips service messages but counts them toward the walk ceiling', async () => {
      // Arrange
      const inputPages = buildPagesUpToCeiling(true);
      queuePages(mockClient, [...inputPages, []]);
      const expectedCount = POSTS_MAX_MESSAGES - inputPages.length;

      // Act
      const actualResult = await service.getChannelPosts(
        inputChannel,
        mockFakeSessionString,
        INPUT_HOURS_BACK,
      );

      // Assert
      expect(actualResult.count).toBe(expectedCount);
      expect(mockClient.getMessages).toHaveBeenCalledTimes(inputPages.length + 1);
      expect(mockClient.getMessages).toHaveBeenLastCalledWith(
        mockFakeInputChannel,
        expect.objectContaining({ limit: PROBE_LIMIT }),
      );
    });

    it('skips a service message on a short page', async () => {
      // Arrange
      queuePages(mockClient, [
        [buildMessage(FIRST_MESSAGE_ID), buildServiceMessage(FIRST_MESSAGE_ID - 1)],
      ]);

      // Act
      const actualResult = await service.getChannelPosts(
        inputChannel,
        mockFakeSessionString,
        INPUT_HOURS_BACK,
      );

      // Assert
      expect(actualResult.posts.map((post) => post.id)).toEqual([FIRST_MESSAGE_ID]);
    });
  });

  describe('getChannelPosts error mapping', () => {
    it('rejects an unknown session with 401 without creating a client', async () => {
      // Act
      const actualResult = service.getChannelPosts(inputChannel, mockFakeSessionString);

      // Assert
      await expectHttpError(actualResult, UnauthorizedException, INVALID_SESSION_MESSAGE);
      expect(mockCreatedClients).toHaveLength(0);
    });

    it('answers an unknown session and a revoked session with the same 401 message', async () => {
      // Arrange
      const mockClient = await authenticateFully(service);
      mockClient.getMessages.mockRejectedValueOnce(rpcError('SESSION_REVOKED'));
      const actualRevoked = await captureHttpError(
        service.getChannelPosts(inputChannel, mockFakeSessionString),
      );

      // Act
      const actualUnknown = await captureHttpError(
        service.getChannelPosts(inputChannel, 'fake-session-never-issued'),
      );

      // Assert
      expect(actualUnknown).toBeInstanceOf(UnauthorizedException);
      expect(actualRevoked).toBeInstanceOf(UnauthorizedException);
      expect(actualUnknown.message).toBe(actualRevoked.message);
      expect(actualUnknown.getStatus()).toBe(actualRevoked.getStatus());
    });

    describe('a username echoed into a GramJS lookup failure never steers the mapping (M1)', () => {
      const lookupPrefix = CHANNEL_LOOKUP_FAILURE_PREFIXES[0];

      it.each([
        ['AUTH_KEY_UNREGISTERED'],
        ['SESSION_REVOKED'],
        ['FLOOD_WAIT_99999'],
        ['PHONE_NUMBER_FLOOD'],
        ['ECONNRESET'],
      ])('maps `No user has "%s" as username` to 404 and keeps the client', async (inputName) => {
        // Arrange
        const mockClient = await authenticateFully(service);
        mockClient.getInputEntity.mockRejectedValueOnce(
          new Error(`${lookupPrefix} "${inputName}" as username`),
        );

        // Act
        const actualResult = service.getChannelPosts(inputName, mockFakeSessionString);

        // Assert
        await expectHttpError(actualResult, NotFoundException, CHANNEL_UNAVAILABLE_MESSAGE);
        expect(mockClient.destroy).not.toHaveBeenCalled();
        await expect(service.checkSession(mockFakeSessionString)).resolves.toEqual({
          status: 'success',
        });
      });
    });

    it('maps SESSION_REVOKED to 401, evicts and destroys the client', async () => {
      // Arrange
      const mockClient = await authenticateFully(service);
      mockClient.getMessages.mockRejectedValue(rpcError('SESSION_REVOKED'));

      // Act
      const actualResult = service.getChannelPosts(inputChannel, mockFakeSessionString);

      // Assert
      await expectHttpError(actualResult, UnauthorizedException, INVALID_SESSION_MESSAGE);
      expect(mockClient.destroy).toHaveBeenCalledTimes(1);
      await expect(service.checkSession(mockFakeSessionString)).resolves.toEqual({
        status: 'failed',
      });
    });

    it('maps CHANNEL_PRIVATE to 404 and keeps the client', async () => {
      // Arrange
      const mockClient = await authenticateFully(service);
      mockClient.getInputEntity.mockRejectedValue(rpcError('CHANNEL_PRIVATE'));

      // Act
      const actualResult = service.getChannelPosts(inputChannel, mockFakeSessionString);

      // Assert
      await expectHttpError(actualResult, NotFoundException, CHANNEL_UNAVAILABLE_MESSAGE);
      expect(mockClient.destroy).not.toHaveBeenCalled();
      expect(mockClient.getMessages).not.toHaveBeenCalled();
    });

    it('maps a flood wait to 429 carrying the wait duration and keeps the client', async () => {
      // Arrange
      const mockClient = await authenticateFully(service);
      mockClient.getMessages.mockRejectedValue(rpcError(`FLOOD_WAIT_${INPUT_FLOOD_SECONDS}`));

      // Act
      const actualError: HttpException = await service
        .getChannelPosts(inputChannel, mockFakeSessionString)
        .catch((error) => error);

      // Assert
      expect(actualError.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(actualError.getResponse()).toEqual(
        expect.objectContaining({ retryAfterSeconds: INPUT_FLOOD_SECONDS }),
      );
      expect(mockClient.destroy).not.toHaveBeenCalled();
    });

    it('maps a page request that exceeds the call timeout to 503', async () => {
      // Arrange
      const mockClient = await authenticateFully(service);
      mockClient.getMessages.mockReturnValue(new Promise(() => undefined));

      // Act
      const actualResult = service.getChannelPosts(inputChannel, mockFakeSessionString);
      const actualAssertion = expect(actualResult).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      await jest.advanceTimersByTimeAsync(EXTERNAL_CALL_TIMEOUT_MS);

      // Assert
      await actualAssertion;
      expect(mockClient.destroy).not.toHaveBeenCalled();
    });
  });

  describe('SessionStore.evict through the wired graph', () => {
    it('destroys the cached client and forgets the session', async () => {
      // Arrange
      const mockClient = await authenticateFully(service);

      // Act
      await sessions.evict(mockFakeSessionString);

      // Assert
      expect(mockClient.destroy).toHaveBeenCalledTimes(1);
      await expect(service.checkSession(mockFakeSessionString)).resolves.toEqual({
        status: 'failed',
      });
    });

    it('is a no-op for an unknown session', async () => {
      // Arrange
      const mockClient = await authenticateFully(service);

      // Act
      await sessions.evict('fake-session-unknown');

      // Assert
      expect(mockClient.destroy).not.toHaveBeenCalled();
    });
  });

  describe('logging: secret hygiene in the auth flow', () => {
    const inputLogSessionString = 'fake-log-hygiene-session-value';
    const SESSION_PREFIX_LENGTH = 8;
    const inputPhoneDigits = inputPhoneNumber.replace(/\D/g, '');

    function expectNoAuthSecretLogged(): void {
      const actualText = loggedText(loggerSpies);
      expect(actualText).not.toContain(inputPhoneNumber);
      expect(actualText).not.toContain(inputPhoneDigits);
      expect(actualText).not.toContain(inputPhoneCode);
      expect(actualText).not.toContain(inputPassword);
      // A prefix of the session is still a leak; no 8-char prefix means no longer one either.
      expect(actualText).not.toContain(inputLogSessionString.slice(0, SESSION_PREFIX_LENGTH));
    }

    it('logs one outcome line per step of a full 2FA cycle and none carries a secret', async () => {
      // Arrange
      const expectedLineCounts = [1, 2, 3];
      const actualLineCounts: number[] = [];

      // Act
      await service.authenticate(inputPhoneNumber);
      actualLineCounts.push(countLogLines(loggerSpies));
      const mockClient = mockCreatedClients[0];
      mockClient.session.save.mockReturnValue(inputLogSessionString);
      mockClient.invoke
        .mockRejectedValueOnce(rpcError('SESSION_PASSWORD_NEEDED'))
        .mockRejectedValueOnce(rpcError('SESSION_PASSWORD_NEEDED'))
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});
      const actualStep2Result = await service.authenticate(inputPhoneNumber, inputPhoneCode);
      actualLineCounts.push(countLogLines(loggerSpies));
      const actualStep3Result = await service.authenticate(
        inputPhoneNumber,
        inputPhoneCode,
        inputPassword,
      );
      actualLineCounts.push(countLogLines(loggerSpies));

      // Assert
      expect(actualStep2Result.needsPassword).toBe(true);
      expect(actualStep3Result.sessionString).toBe(inputLogSessionString);
      expect(actualLineCounts).toEqual(expectedLineCounts);
      expect(loggerSpies.log.mock.calls).toEqual([
        ['Auth: code sent'],
        ['Auth: 2FA password required'],
        ['Auth: authenticated with 2FA'],
      ]);
      expectNoAuthSecretLogged();
    });

    it('logs "Auth: code sent" then "Auth: authenticated" for a cycle without 2FA', async () => {
      // Arrange
      await service.authenticate(inputPhoneNumber);
      mockCreatedClients[0].session.save.mockReturnValue(inputLogSessionString);

      // Act
      const actualResult = await service.authenticate(inputPhoneNumber, inputPhoneCode);

      // Assert
      expect(actualResult.sessionString).toBe(inputLogSessionString);
      expect(loggerSpies.log.mock.calls).toEqual([['Auth: code sent'], ['Auth: authenticated']]);
      expect(countLogLines(loggerSpies)).toBe(loggerSpies.log.mock.calls.length);
      expectNoAuthSecretLogged();
    });

    it('logs a failed sign-in once at warn with the status and error code, and no secret', async () => {
      // Arrange
      await service.authenticate(inputPhoneNumber);
      const mockClient = mockCreatedClients[0];
      mockClient.session.save.mockReturnValue(inputLogSessionString);
      mockClient.invoke.mockRejectedValueOnce(
        Object.assign(new Error(`RPCError: 400: PHONE_CODE_INVALID for ${inputPhoneNumber}`), {
          errorMessage: 'PHONE_CODE_INVALID',
        }),
      );
      clearLoggerSpies(loggerSpies);

      // Act
      const actualResult = service.authenticate(inputPhoneNumber, inputPhoneCode);

      // Assert
      await expect(actualResult).rejects.toBeInstanceOf(BadRequestException);
      expect(countLogLines(loggerSpies)).toBe(1);
      expect(loggerSpies.warn).toHaveBeenCalledWith('Auth failed: 400 (PHONE_CODE_INVALID)');
      expect(loggerSpies.error).not.toHaveBeenCalled();
      expectNoAuthSecretLogged();
    });

    it('logs a failed 2FA check once at warn and never the password', async () => {
      // Arrange
      await service.authenticate(inputPhoneNumber);
      const mockClient = mockCreatedClients[0];
      mockClient.invoke
        .mockRejectedValueOnce(rpcError('SESSION_PASSWORD_NEEDED'))
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(rpcError('PASSWORD_HASH_INVALID'));
      clearLoggerSpies(loggerSpies);

      // Act
      const actualResult = service.authenticate(inputPhoneNumber, inputPhoneCode, inputPassword);

      // Assert
      await expect(actualResult).rejects.toBeInstanceOf(BadRequestException);
      expect(countLogLines(loggerSpies)).toBe(1);
      expect(loggerSpies.warn).toHaveBeenCalledWith(expect.stringContaining('Auth failed: 400'));
      expectNoAuthSecretLogged();
    });
  });

  describe('logging: getChannelPosts volume', () => {
    const inputPageCount = 3;
    let mockClient: MockTelegramClient;

    beforeEach(async () => {
      mockClient = await authenticateFully(service);
      jest.spyOn(Date, 'now').mockReturnValue(FAKE_NOW_MS);
      clearLoggerSpies(loggerSpies);
    });

    it('emits exactly one log line for a single page', async () => {
      // Arrange
      queuePages(mockClient, [buildPage(FIRST_MESSAGE_ID, SHORT_PAGE_SIZE)]);

      // Act
      await service.getChannelPosts(inputChannel, mockFakeSessionString, INPUT_HOURS_BACK);

      // Assert
      expect(countLogLines(loggerSpies)).toBe(1);
      expect(loggerSpies.log).toHaveBeenCalledWith(
        `Posts: @${inputChannel} ${INPUT_HOURS_BACK}h -> ${SHORT_PAGE_SIZE} posts, truncated=false`,
      );
      expect(loggedText(loggerSpies)).not.toContain(mockFakeSessionString);
    });

    it('emits the same single line for several pages: volume does not depend on message count', async () => {
      // Arrange
      const inputPages: FakeMessageFields[][] = [];
      let nextId = FIRST_MESSAGE_ID;
      for (let index = 0; index < inputPageCount; index += 1) {
        const size = index < inputPageCount - 1 ? POSTS_PAGE_SIZE : SHORT_PAGE_SIZE;
        const page = buildPage(nextId, size);
        inputPages.push(page);
        nextId = lastIdOf(page) - 1;
      }
      queuePages(mockClient, inputPages);
      const expectedCount = POSTS_PAGE_SIZE * (inputPageCount - 1) + SHORT_PAGE_SIZE;

      // Act
      const actualResult = await service.getChannelPosts(
        inputChannel,
        mockFakeSessionString,
        INPUT_HOURS_BACK,
      );

      // Assert
      expect(mockClient.getMessages).toHaveBeenCalledTimes(inputPageCount);
      expect(actualResult.count).toBe(expectedCount);
      expect(countLogLines(loggerSpies)).toBe(1);
      expect(loggerSpies.log).toHaveBeenCalledWith(
        `Posts: @${inputChannel} ${INPUT_HOURS_BACK}h -> ${expectedCount} posts, truncated=false`,
      );
    });

    it('emits one line reporting truncated=true when the walk hits the ceiling', async () => {
      // Arrange
      const inputPages = buildPagesUpToCeiling();
      queuePages(mockClient, [
        ...inputPages,
        [buildMessage(lastIdOf(inputPages[inputPages.length - 1]) - 1)],
      ]);

      // Act
      await service.getChannelPosts(inputChannel, mockFakeSessionString, INPUT_HOURS_BACK);

      // Assert
      expect(countLogLines(loggerSpies)).toBe(1);
      expect(loggerSpies.log).toHaveBeenCalledWith(expect.stringContaining('truncated=true'));
    });
  });

  describe('logging: failure level follows the mapped status', () => {
    let mockClient: MockTelegramClient;

    beforeEach(async () => {
      mockClient = await authenticateFully(service);
      clearLoggerSpies(loggerSpies);
    });

    it.each([
      ['CHANNEL_PRIVATE (404)', 'CHANNEL_PRIVATE', HttpStatus.NOT_FOUND],
      ['SESSION_REVOKED (401)', 'SESSION_REVOKED', HttpStatus.UNAUTHORIZED],
      [`FLOOD_WAIT (429)`, `FLOOD_WAIT_${INPUT_FLOOD_SECONDS}`, HttpStatus.TOO_MANY_REQUESTS],
    ])('logs a 4xx posts failure %s once at warn', async (_label, inputCode, expectedStatus) => {
      // Arrange
      mockClient.getMessages.mockRejectedValue(rpcError(inputCode));

      // Act
      const actualResult = service.getChannelPosts(inputChannel, mockFakeSessionString);

      // Assert
      await expect(actualResult).rejects.toBeInstanceOf(HttpException);
      expect(countLogLines(loggerSpies)).toBe(1);
      expect(loggerSpies.warn).toHaveBeenCalledWith(
        expect.stringContaining(`Posts: @${inputChannel} failed: ${expectedStatus}`),
      );
      expect(loggerSpies.error).not.toHaveBeenCalled();
      expect(loggedText(loggerSpies)).not.toContain(mockFakeSessionString);
    });

    it.each([
      ['connectivity (503)', 'fake ECONNRESET', HttpStatus.SERVICE_UNAVAILABLE],
      ['unknown RPC (502)', 'RPCError: 500: FAKE_UNKNOWN', HttpStatus.BAD_GATEWAY],
    ])(
      'logs a 5xx posts failure %s once at error',
      async (_label, inputMessage, expectedStatus) => {
        // Arrange
        mockClient.getMessages.mockRejectedValue(new Error(inputMessage));

        // Act
        const actualResult = service.getChannelPosts(inputChannel, mockFakeSessionString);

        // Assert
        await expect(actualResult).rejects.toBeInstanceOf(HttpException);
        expect(countLogLines(loggerSpies)).toBe(1);
        expect(loggerSpies.error).toHaveBeenCalledWith(
          `Posts: @${inputChannel} failed: ${expectedStatus} (Error: ${inputMessage})`,
        );
        expect(loggerSpies.warn).not.toHaveBeenCalled();
      },
    );

    it('logs a session-check connectivity failure once at error', async () => {
      // Arrange
      mockClient.invoke.mockRejectedValueOnce(new Error('fake ECONNRESET'));

      // Act
      const actualResult = service.checkSession(mockFakeSessionString);

      // Assert
      await expect(actualResult).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(countLogLines(loggerSpies)).toBe(1);
      expect(loggerSpies.error).toHaveBeenCalledWith(
        expect.stringContaining(`Session check failed: ${HttpStatus.SERVICE_UNAVAILABLE}`),
      );
    });

    it('logs a session-check flood wait once at warn', async () => {
      // Arrange
      mockClient.invoke.mockRejectedValueOnce(rpcError(`FLOOD_WAIT_${INPUT_FLOOD_SECONDS}`));

      // Act
      const actualResult = service.checkSession(mockFakeSessionString);

      // Assert
      await expect(actualResult).rejects.toBeInstanceOf(TooManyRequestsException);
      expect(countLogLines(loggerSpies)).toBe(1);
      expect(loggerSpies.warn).toHaveBeenCalledWith(
        expect.stringContaining(`Session check failed: ${HttpStatus.TOO_MANY_REQUESTS}`),
      );
    });
  });

  describe('logging: checkSession outcome', () => {
    it('logs "Session check: success" exactly once', async () => {
      // Arrange
      await authenticateFully(service);
      clearLoggerSpies(loggerSpies);

      // Act
      await service.checkSession(mockFakeSessionString);

      // Assert
      expect(countLogLines(loggerSpies)).toBe(1);
      expect(loggerSpies.log).toHaveBeenCalledWith('Session check: success');
    });

    it('logs "Session check: failed (...)" exactly once for a revoked session', async () => {
      // Arrange
      const mockClient = await authenticateFully(service);
      mockClient.invoke.mockRejectedValueOnce(rpcError('AUTH_KEY_UNREGISTERED'));
      clearLoggerSpies(loggerSpies);

      // Act
      const actualResult = await service.checkSession(mockFakeSessionString);

      // Assert
      expect(actualResult).toEqual({ status: 'failed' });
      expect(countLogLines(loggerSpies)).toBe(1);
      expect(loggerSpies.log).toHaveBeenCalledWith('Session check: failed (AUTH_KEY_UNREGISTERED)');
      expect(loggedText(loggerSpies)).not.toContain(mockFakeSessionString);
    });

    it('logs one failed line for an unknown session without echoing it', async () => {
      // Act
      const actualResult = await service.checkSession(mockFakeSessionString);

      // Assert
      expect(actualResult).toEqual({ status: 'failed' });
      expect(countLogLines(loggerSpies)).toBe(1);
      expect(loggerSpies.log).toHaveBeenCalledWith(
        expect.stringMatching(/^Session check: failed \(/),
      );
      expect(loggedText(loggerSpies)).not.toContain(mockFakeSessionString);
    });
  });

  describe('constructor', () => {
    it('constructs when the config loader throws, warns once and fails the first auth with 500', async () => {
      // Arrange
      mockConfigError = new Error('fake config loader failure');
      clearLoggerSpies(loggerSpies);

      // Act
      const { service: unconfiguredService } = buildService();

      try {
        // Assert
        expect(loggerSpies.warn).toHaveBeenCalledTimes(1);
        expect(loggerSpies.warn).toHaveBeenCalledWith(
          'Config not loaded, will fail on first use: Error: fake config loader failure',
        );
        await expectHttpError(
          unconfiguredService.authenticate(inputPhoneNumber),
          InternalServerErrorException,
          MISSING_CONFIG_MESSAGE,
        );
        expect(mockCreatedClients).toHaveLength(0);
      } finally {
        await unconfiguredService.onModuleDestroy();
      }
    });
  });

  describe('auth-state TTL sweep', () => {
    it('releases an expired pending client and drops its state, so step 2 answers 400', async () => {
      // Arrange
      await service.authenticate(inputPhoneNumber);
      const mockPendingClient = mockCreatedClients[0];

      // Act
      await jest.advanceTimersByTimeAsync(AUTH_STATE_TTL_MS + AUTH_STATE_SWEEP_INTERVAL_MS);

      // Assert
      expect(mockPendingClient.destroy).toHaveBeenCalledTimes(1);
      await expect(service.authenticate(inputPhoneNumber, inputPhoneCode)).rejects.toThrow(
        CODE_NOT_REQUESTED_PATTERN,
      );
      expect(mockPendingClient.invoke).not.toHaveBeenCalled();
      expect(mockCreatedClients).toHaveLength(1);
    });

    it('keeps a state aged exactly AUTH_STATE_TTL_MS and a younger one, sweeping only the older on the next pass', async () => {
      // Arrange
      await service.authenticate(inputPhoneNumber);
      const mockOlderClient = mockCreatedClients[0];
      await jest.advanceTimersByTimeAsync(AUTH_STATE_TTL_MS);
      const actualDestroyedAtTtl = mockOlderClient.destroy.mock.calls.length;
      await service.authenticate(inputOtherPhoneNumber);
      const mockYoungerClient = mockCreatedClients[1];

      // Act
      await jest.advanceTimersByTimeAsync(AUTH_STATE_SWEEP_INTERVAL_MS);

      // Assert
      expect(actualDestroyedAtTtl).toBe(0);
      expect(mockOlderClient.destroy).toHaveBeenCalledTimes(1);
      expect(mockYoungerClient.destroy).not.toHaveBeenCalled();
      const actualResult = await service.authenticate(inputOtherPhoneNumber, inputPhoneCode);
      expect(actualResult.sessionString).toBe(mockFakeSessionString);
      expect(mockYoungerClient.invoke).toHaveBeenCalledTimes(1);
    });
  });

  describe('empty cache after a restart (sessions live in memory only)', () => {
    let restarted: ServiceGraph;

    beforeEach(async () => {
      await authenticateFully(service);
      await service.authenticate(inputOtherPhoneNumber);
      await service.onModuleDestroy();
      mockCreatedClients.length = 0;
      restarted = buildService();
    });

    afterEach(async () => {
      await restarted.service.onModuleDestroy();
    });

    it('rejects posts for a session issued before the restart with 401 and creates no client', async () => {
      // Act
      const actualResult = restarted.service.getChannelPosts(inputChannel, mockFakeSessionString);

      // Assert
      await expectHttpError(actualResult, UnauthorizedException, INVALID_SESSION_MESSAGE);
      expect(mockCreatedClients).toHaveLength(0);
    });

    it('reports failed for a session issued before the restart and creates no client', async () => {
      // Act
      const actualResult = await restarted.service.checkSession(mockFakeSessionString);

      // Assert
      expect(actualResult).toEqual({ status: 'failed' });
      expect(mockCreatedClients).toHaveLength(0);
    });

    it('forgets a pending login from before the restart, so step 2 answers 400 without a client', async () => {
      // Act
      const actualResult = restarted.service.authenticate(inputOtherPhoneNumber, inputPhoneCode);

      // Assert
      await expect(actualResult).rejects.toThrow(CODE_NOT_REQUESTED_PATTERN);
      await expect(actualResult).rejects.toBeInstanceOf(BadRequestException);
      expect(mockCreatedClients).toHaveLength(0);
    });

    it('rejects a blank session string with 401 without creating a client', async () => {
      // Act
      const actualResult = restarted.service.getChannelPosts(inputChannel, '   ');

      // Assert
      await expectHttpError(actualResult, UnauthorizedException, INVALID_SESSION_MESSAGE);
      expect(mockCreatedClients).toHaveLength(0);
    });
  });

  describe('getChannelPosts media mapping', () => {
    let mockClient: MockTelegramClient;

    beforeEach(async () => {
      mockClient = await authenticateFully(service);
      jest.spyOn(Date, 'now').mockReturnValue(FAKE_NOW_MS);
    });

    it.each([
      ['a photo', { media: { fake: 'media' }, photo: { fake: 'photo' } }, [{ type: 'photo' }]],
      ['a video', { media: { fake: 'media' }, video: { fake: 'video' } }, [{ type: 'video' }]],
      [
        'a document',
        { media: { fake: 'media' }, document: { fake: 'document' } },
        [{ type: 'document' }],
      ],
      ['media of another kind', { media: { fake: 'media' } }, []],
      ['a photo but no media field', { photo: { fake: 'photo' } }, []],
    ])('maps a message with %s', async (_label, inputFields, expectedMedia) => {
      // Arrange
      queuePages(mockClient, [
        [new mockApi.Message({ id: FIRST_MESSAGE_ID, date: IN_WINDOW_DATE_S, ...inputFields })],
      ]);

      // Act
      const actualResult = await service.getChannelPosts(
        inputChannel,
        mockFakeSessionString,
        INPUT_HOURS_BACK,
      );

      // Assert
      expect(actualResult.posts).toHaveLength(1);
      expect(actualResult.posts[0].media).toEqual(expectedMedia);
      expect(actualResult.posts[0].text).toBe('');
    });
  });

  describe("authenticate: concurrent attempts for one phone never release each other's client", () => {
    /** A promise the test settles by hand, to hold a call open while another request runs. */
    function deferred<T>(): {
      promise: Promise<T>;
      resolve: (value: T) => void;
      reject: (error: unknown) => void;
    } {
      let resolve: (value: T) => void = () => undefined;
      let reject: (error: unknown) => void = () => undefined;
      const promise = new Promise<T>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
      });
      return { promise, resolve, reject };
    }

    it('keeps a newer attempt stored while step 2 was adopting its client, and signs in with it next', async () => {
      // Arrange
      await service.authenticate(inputPhoneNumber);
      const mockFirstClient = mockCreatedClients[0];
      const adoptGate = deferred<void>();
      const originalAdopt = sessions.adopt.bind(sessions);
      const mockAdopt = jest.spyOn(sessions, 'adopt').mockImplementationOnce(async (client) => {
        await adoptGate.promise;
        return originalAdopt(client);
      });
      const actualFirstLogin = service.authenticate(inputPhoneNumber, inputPhoneCode);
      await jest.advanceTimersByTimeAsync(0);
      expect(mockAdopt).toHaveBeenCalledTimes(1);
      await service.authenticate(inputPhoneNumber);
      const mockNewerClient = mockCreatedClients[1];

      // Act
      adoptGate.resolve();
      const actualFirstResult = await actualFirstLogin;
      const actualSecondResult = await service.authenticate(inputPhoneNumber, inputPhoneCode);

      // Assert
      expect(actualFirstResult.sessionString).toBe(mockFakeSessionString);
      expect(mockNewerClient.destroy).not.toHaveBeenCalled();
      expect(mockNewerClient.invoke).toHaveBeenCalledTimes(1);
      expect(mockFirstClient.invoke).toHaveBeenCalledTimes(1);
      expect(actualSecondResult.sessionString).toBe(mockFakeSessionString);
      expect(mockCreatedClients).toHaveLength(2);
    });

    it('does not destroy the client being adopted when step 1 for the same phone arrives meanwhile', async () => {
      // Arrange
      const inputAdoptedSession = 'fake-session-being-adopted';
      await service.authenticate(inputPhoneNumber);
      const mockAdoptedClient = mockCreatedClients[0];
      mockAdoptedClient.session.save.mockReturnValue(inputAdoptedSession);
      const adoptGate = deferred<void>();
      const originalAdopt = sessions.adopt.bind(sessions);
      jest.spyOn(sessions, 'adopt').mockImplementationOnce(async (client) => {
        await adoptGate.promise;
        return originalAdopt(client);
      });
      const actualLogin = service.authenticate(inputPhoneNumber, inputPhoneCode);
      await jest.advanceTimersByTimeAsync(0);
      await service.authenticate(inputPhoneNumber);
      const expectedConnectCount = mockAdoptedClient.connect.mock.calls.length;

      // Act
      adoptGate.resolve();
      const actualResult = await actualLogin;
      const actualCheck = await service.checkSession(inputAdoptedSession);

      // Assert
      expect(actualResult.sessionString).toBe(inputAdoptedSession);
      expect(mockAdoptedClient.destroy).not.toHaveBeenCalled();
      expect(actualCheck).toEqual({ status: 'success' });
      expect(mockAdoptedClient.connect).toHaveBeenCalledTimes(expectedConnectCount);
      expect(mockCreatedClients[1].destroy).not.toHaveBeenCalled();
    });

    it('does not destroy a newer pending client when an older step 2 fails afterwards', async () => {
      // Arrange
      await service.authenticate(inputPhoneNumber);
      const mockOlderClient = mockCreatedClients[0];
      const signInGate = deferred<unknown>();
      mockOlderClient.invoke.mockReturnValueOnce(signInGate.promise);
      const actualOlderLogin = service.authenticate(inputPhoneNumber, inputPhoneCode);
      await jest.advanceTimersByTimeAsync(0);
      await service.authenticate(inputPhoneNumber);
      const mockNewerClient = mockCreatedClients[1];

      // Act
      signInGate.reject(rpcError('PHONE_CODE_INVALID'));
      await expectHttpError(
        actualOlderLogin,
        BadRequestException,
        authInputMessageFor('PHONE_CODE_INVALID'),
      );
      const actualNewerResult = await service.authenticate(inputPhoneNumber, inputPhoneCode);

      // Assert
      expect(mockOlderClient.destroy).toHaveBeenCalled();
      expect(mockNewerClient.destroy).not.toHaveBeenCalled();
      expect(mockNewerClient.invoke).toHaveBeenCalledTimes(1);
      expect(actualNewerResult.sessionString).toBe(mockFakeSessionString);
    });

    it('releases only its own client when step 1 fails after a concurrent step 1 stored an attempt', async () => {
      // Arrange
      const sendCodeGates: Array<ReturnType<typeof deferred<{ phoneCodeHash: string }>>> = [];
      mockConfigureClient = (client) => {
        const gate = deferred<{ phoneCodeHash: string }>();
        sendCodeGates.push(gate);
        client.sendCode.mockReturnValueOnce(gate.promise);
      };
      const actualFailingRequest = service.authenticate(inputPhoneNumber);
      await jest.advanceTimersByTimeAsync(0);
      const actualWinningRequest = service.authenticate(inputPhoneNumber);
      await jest.advanceTimersByTimeAsync(0);
      expect(mockCreatedClients).toHaveLength(2);
      const [mockFailingClient, mockWinningClient] = mockCreatedClients;
      sendCodeGates[1].resolve({ phoneCodeHash: 'fake-code-hash-winning' });
      await actualWinningRequest;

      // Act
      sendCodeGates[0].reject(rpcError('PHONE_NUMBER_INVALID'));
      await expectHttpError(
        actualFailingRequest,
        BadRequestException,
        authInputMessageFor('PHONE_NUMBER_INVALID'),
      );
      const actualResult = await service.authenticate(inputPhoneNumber, inputPhoneCode);

      // Assert
      expect(mockFailingClient.destroy).toHaveBeenCalledTimes(1);
      expect(mockWinningClient.destroy).not.toHaveBeenCalled();
      expect(mockWinningClient.invoke).toHaveBeenCalledTimes(1);
      expect(actualResult.sessionString).toBe(mockFakeSessionString);
    });
  });

  describe('authenticate: client release on the remaining error branches', () => {
    it('maps a GetPassword timeout during 2FA to 503 and destroys the client', async () => {
      // Arrange
      await service.authenticate(inputPhoneNumber);
      const mockClient = mockCreatedClients[0];
      mockClient.invoke
        .mockRejectedValueOnce(rpcError('SESSION_PASSWORD_NEEDED'))
        .mockReturnValueOnce(new Promise(() => undefined));

      // Act
      const actualResult = service.authenticate(inputPhoneNumber, inputPhoneCode, inputPassword);
      const actualAssertion = expectHttpError(
        actualResult,
        ServiceUnavailableException,
        TELEGRAM_UNAVAILABLE_MESSAGE,
      );
      await jest.advanceTimersByTimeAsync(EXTERNAL_CALL_TIMEOUT_MS);

      // Assert
      await actualAssertion;
      expect(mockClient.destroy).toHaveBeenCalledTimes(1);
    });

    it('maps an unknown sign-in failure to 502 with the fixed message and destroys the client', async () => {
      // Arrange
      await service.authenticate(inputPhoneNumber);
      const mockClient = mockCreatedClients[0];
      mockClient.invoke.mockRejectedValueOnce(rpcError('FAKE_UNKNOWN_RPC'));

      // Act
      const actualResult = service.authenticate(inputPhoneNumber, inputPhoneCode);

      // Assert
      await expectHttpError(actualResult, BadGatewayException, TELEGRAM_FAILED_MESSAGE);
      expect(mockClient.destroy).toHaveBeenCalledTimes(1);
      await expect(service.authenticate(inputPhoneNumber, inputPhoneCode)).rejects.toThrow(
        CODE_NOT_REQUESTED_PATTERN,
      );
    });

    it('treats a non-Error rejection carrying SESSION_PASSWORD_NEEDED as a failure, not a 2FA prompt', async () => {
      // Arrange
      await service.authenticate(inputPhoneNumber);
      const mockClient = mockCreatedClients[0];
      mockClient.invoke.mockRejectedValueOnce({
        errorMessage: 'SESSION_PASSWORD_NEEDED',
        message: 'SESSION_PASSWORD_NEEDED',
      });

      // Act
      const actualResult = service.authenticate(inputPhoneNumber, inputPhoneCode);

      // Assert
      await expectHttpError(actualResult, BadGatewayException, TELEGRAM_FAILED_MESSAGE);
      expect(mockClient.destroy).toHaveBeenCalledTimes(1);
    });
  });
});
