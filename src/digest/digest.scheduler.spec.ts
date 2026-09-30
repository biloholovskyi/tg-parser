import { Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { DigestConfig } from '../config/digest.config';
import { DIGEST_JOB_NAME } from './constants';
import { DigestScheduler } from './digest.scheduler';
import type { DigestService } from './digest.service';

/** The real service pulls in the collector and, through it, GramJS. */
jest.mock('./digest.service', () => ({ DigestService: class {} }));

const LOGGER_LEVELS = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;
const INPUT_CRON = '0 23 * * *';
const INPUT_TIMEZONE = 'Europe/Kyiv';
/** 12:00 UTC on 01.06.2026; Kyiv is UTC+3 in summer, so 23:00 there is 20:00 UTC. */
const INPUT_NOW_MS = Date.UTC(2026, 5, 1, 12, 0);
const EXPECTED_NEXT_TICK_MS = Date.UTC(2026, 5, 1, 20, 0);

function buildConfig(overrides: Partial<DigestConfig> = {}): DigestConfig {
  return {
    channels: ['fake_channel'],
    cron: INPUT_CRON,
    timezone: INPUT_TIMEZONE,
    grokApiKey: 'fake-grok-key',
    grokModel: 'fake-model',
    botToken: 'fake-bot-token',
    botChatId: '-100000',
    isConfigured: true,
    ...overrides,
  };
}

describe('DigestScheduler', () => {
  let registry: SchedulerRegistry;
  let mockRunScheduled: jest.Mock<Promise<void>, []>;
  let loggerSpies: Record<(typeof LOGGER_LEVELS)[number], jest.SpyInstance>;

  function createScheduler(config: DigestConfig): DigestScheduler {
    return new DigestScheduler(config, registry, {
      runScheduled: mockRunScheduled,
    } as unknown as DigestService);
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: INPUT_NOW_MS });
    registry = new SchedulerRegistry();
    mockRunScheduled = jest.fn(async () => undefined);
    loggerSpies = Object.fromEntries(
      LOGGER_LEVELS.map((level) => [
        level,
        jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
      ]),
    ) as Record<(typeof LOGGER_LEVELS)[number], jest.SpyInstance>;
  });

  afterEach(() => {
    for (const [name, job] of registry.getCronJobs()) {
      job.stop();
      registry.deleteCronJob(name);
    }
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('registers and starts the job with the configured schedule and time zone', () => {
    // Arrange
    const scheduler = createScheduler(buildConfig());

    // Act
    scheduler.onApplicationBootstrap();

    // Assert
    expect(registry.doesExist('cron', DIGEST_JOB_NAME)).toBe(true);
    const actualJob = registry.getCronJob(DIGEST_JOB_NAME);
    expect(actualJob.running).toBe(true);
    expect(actualJob.nextDate().toMillis()).toBe(EXPECTED_NEXT_TICK_MS);
    expect(actualJob.nextDate().zoneName).toBe(INPUT_TIMEZONE);
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    expect(loggerSpies.log).toHaveBeenCalledWith(
      `Digest scheduled: "${INPUT_CRON}" ${INPUT_TIMEZONE}`,
    );
  });

  it('follows a different time zone from the config', () => {
    // Arrange
    const scheduler = createScheduler(buildConfig({ timezone: 'UTC' }));

    // Act
    scheduler.onApplicationBootstrap();

    // Assert
    expect(registry.getCronJob(DIGEST_JOB_NAME).nextDate().toMillis()).toBe(
      Date.UTC(2026, 5, 1, 23, 0),
    );
  });

  it('registers nothing and arms no timer when the digest is not configured', () => {
    // Arrange
    const scheduler = createScheduler(buildConfig({ isConfigured: false }));

    // Act
    scheduler.onApplicationBootstrap();

    // Assert
    expect(registry.getCronJobs().size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([
    ['an invalid schedule', { cron: 'not a cron' }],
    ['an invalid time zone', { timezone: 'Fake/Nowhere' }],
  ])('logs one error and does not throw for %s', (_label, inputOverrides) => {
    // Arrange
    const scheduler = createScheduler(buildConfig(inputOverrides));

    // Act
    const actualAct = (): void => scheduler.onApplicationBootstrap();

    // Assert
    expect(actualAct).not.toThrow();
    expect(registry.getCronJobs().size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    expect(loggerSpies.error).toHaveBeenCalledTimes(1);
    expect(String(loggerSpies.error.mock.calls[0][0])).toMatch(/^Digest not scheduled: /);
  });

  it('calls runScheduled on a tick', () => {
    // Arrange
    const scheduler = createScheduler(buildConfig());
    scheduler.onApplicationBootstrap();

    // Act
    registry.getCronJob(DIGEST_JOB_NAME).fireOnTick();

    // Assert
    expect(mockRunScheduled).toHaveBeenCalledTimes(1);
  });

  it('fires runScheduled when the fake clock reaches the scheduled time', async () => {
    // Arrange
    const scheduler = createScheduler(buildConfig());
    scheduler.onApplicationBootstrap();

    // Act
    await jest.advanceTimersByTimeAsync(EXPECTED_NEXT_TICK_MS - INPUT_NOW_MS);

    // Assert
    expect(mockRunScheduled).toHaveBeenCalledTimes(1);
  });

  it('stops and removes the job on destroy, leaving no timer behind', () => {
    // Arrange
    const scheduler = createScheduler(buildConfig());
    scheduler.onApplicationBootstrap();
    const actualJob = registry.getCronJob(DIGEST_JOB_NAME);

    // Act
    scheduler.onModuleDestroy();

    // Assert
    expect(registry.doesExist('cron', DIGEST_JOB_NAME)).toBe(false);
    expect(actualJob.running).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does nothing on destroy when no job was registered', () => {
    // Arrange
    const scheduler = createScheduler(buildConfig({ isConfigured: false }));
    scheduler.onApplicationBootstrap();

    // Act
    const actualAct = (): void => scheduler.onModuleDestroy();

    // Assert
    expect(actualAct).not.toThrow();
    expect(registry.getCronJobs().size).toBe(0);
  });
});
