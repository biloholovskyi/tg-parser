import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { DigestConfig } from '../config/digest.config';
import { BotNotifier } from './bot-notifier';
import { DIGEST_CONFIG, DIGEST_MAX_POSTS, DIGEST_WINDOW_HOURS } from './constants';
import type {
  DigestReport,
  DigestRunResponse,
  DigestTrigger,
} from './interfaces/digest-run.interface';
import { PostCollector } from './post-collector';
import { SummaryService } from './summary.service';
import { TranslationService } from './translation.service';
import { formatDigest, formatFailure } from './utils/digest-formatter';
import { limitPosts, postsAsTopics } from './utils/post-selection';

export const DIGEST_NOT_CONFIGURED_MESSAGE = 'Digest is not configured';
export const DIGEST_ALREADY_RUNNING_MESSAGE = 'A digest run is already in progress';

/** Caller-facing reasons for a run that produced no digest, by HTTP status of the failure. */
const FAILURE_REASONS: ReadonlyMap<number, string> = new Map([
  [
    HttpStatus.UNAUTHORIZED,
    'Сессия дайджеста не задана или отозвана: авторизуйтесь и вызовите PUT /digest/session.',
  ],
  [
    HttpStatus.TOO_MANY_REQUESTS,
    'Telegram ограничил частоту запросов для аккаунта. Повторите позже.',
  ],
  [HttpStatus.SERVICE_UNAVAILABLE, 'Telegram или хранилище сессий недоступны. Повторите позже.'],
]);
const GENERIC_FAILURE_REASON = 'Внутренняя ошибка, подробности в логах сервиса.';

/**
 * Runs the digest end to end: collect, translate, summarize, format, send. One run at a time;
 * the running flag is released in `finally`, whatever happens inside.
 */
@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);
  private isRunning = false;

  constructor(
    @Inject(DIGEST_CONFIG) private readonly config: DigestConfig,
    private readonly collector: PostCollector,
    private readonly translation: TranslationService,
    private readonly summary: SummaryService,
    private readonly notifier: BotNotifier,
  ) {}

  /** Starts a run in the background for `POST /digest/run`: 503 when unconfigured, 409 when busy. */
  start(): DigestRunResponse {
    if (!this.config.isConfigured) {
      throw new ServiceUnavailableException(DIGEST_NOT_CONFIGURED_MESSAGE);
    }
    if (this.isRunning) {
      throw new ConflictException(DIGEST_ALREADY_RUNNING_MESSAGE);
    }
    void this.execute('manual');
    return { status: 'started' };
  }

  /** The scheduled run: skipped with one log line when a run is already in progress. */
  async runScheduled(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Scheduled digest skipped: a run is already in progress');
      return;
    }
    await this.execute('scheduled');
  }

  /** Never rejects: every failure is logged and, when possible, reported to the bot chat. */
  private async execute(trigger: DigestTrigger): Promise<void> {
    this.isRunning = true;
    const startedAt = Date.now();
    try {
      const report = await this.buildReport(new Date(startedAt));
      const messages = formatDigest(report);
      await this.notifier.send(messages);
      this.logger.log(
        `Digest ${trigger}: ${report.posts.length} posts, ${report.topics.length} topics, ` +
          `${report.collected.channelCount} channels, ${messages.length} messages, ` +
          `${Date.now() - startedAt} ms`,
      );
    } catch (error: unknown) {
      await this.reportFailure(trigger, error);
    } finally {
      this.isRunning = false;
    }
  }

  private async buildReport(runAt: Date): Promise<DigestReport> {
    const collected = await this.collector.collect(this.config.channels, DIGEST_WINDOW_HOURS);
    const { kept, skippedCount } = limitPosts(collected.posts, DIGEST_MAX_POSTS);
    this.logger.log(`Digest: collected ${kept.length} posts, translating`);
    const { posts, untranslatedCount } = await this.translation.translate(kept);
    this.logger.log('Digest: summarizing');
    const base = { runAt, timezone: this.config.timezone, collected, posts, untranslatedCount };
    try {
      const { topics, fallbackTopicCount } = await this.summary.summarize(posts);
      return {
        ...base,
        topics,
        fallbackTopicCount,
        skippedPostCount: skippedCount,
        isSummaryFallback: false,
      };
    } catch {
      // SummaryService's Grok client has logged why; the posts still go out, one block each.
      const topics = postsAsTopics(posts);
      return {
        ...base,
        topics,
        fallbackTopicCount: topics.length,
        skippedPostCount: skippedCount,
        isSummaryFallback: true,
      };
    }
  }

  private async reportFailure(trigger: DigestTrigger, error: unknown): Promise<void> {
    const status = error instanceof HttpException ? error.getStatus() : undefined;
    this.logger.error(
      `Digest ${trigger} failed: ${status ?? (error instanceof Error ? error.name : 'unknown')}` +
        `${error instanceof Error && !(error instanceof HttpException) ? ` (${error.message})` : ''}`,
    );
    const reason = (status !== undefined && FAILURE_REASONS.get(status)) || GENERIC_FAILURE_REASON;
    try {
      await this.notifier.send([formatFailure(reason)]);
    } catch {
      this.logger.error('Digest failure notice not delivered');
    }
  }
}
