import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AlertService } from '../alerts/alert.service';
import type { DigestConfig } from '../config/digest.config';
import { describeError } from '../shared/utils/process-handlers';
import { BotNotifier } from './bot-notifier';
import { DIGEST_CONFIG, DIGEST_MAX_POSTS, DIGEST_WINDOW_HOURS } from './constants';
import type { DigestPost } from './interfaces/digest-post.interface';
import type {
  DigestReport,
  DigestRunResponse,
  DigestTrigger,
} from './interfaces/digest-run.interface';
import type {
  DigestTopic,
  ThesisTranslationResult,
  TranslatedPost,
  TranslationResult,
} from './interfaces/digest-topic.interface';
import { PostCollector } from './post-collector';
import { SummaryService } from './summary.service';
import { TranslationService } from './translation.service';
import { DigestCancelledError } from './utils/cancellable-delay';
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

interface SummaryOutcome {
  topics: DigestTopic[];
  fallbackTopicCount: number;
  isSummaryFallback: boolean;
}

/** A post the summary reads in its original language; nothing was asked to translate it. */
function asOriginal(post: DigestPost): TranslatedPost {
  return { ...post, translated: post.text, isUntranslated: false };
}

/**
 * Runs the digest end to end: collect, translate, summarize, format, send. One run at a time;
 * the running flag is released in `finally`, whatever happens inside.
 */
@Injectable()
export class DigestService implements OnModuleDestroy {
  private readonly logger = new Logger(DigestService.name);
  private isRunning = false;
  /** Aborts the run in progress; a run waiting on a Telegram flood limit stops at once. */
  private runAbort: AbortController | undefined;

  constructor(
    @Inject(DIGEST_CONFIG) private readonly config: DigestConfig,
    private readonly collector: PostCollector,
    private readonly translation: TranslationService,
    private readonly summary: SummaryService,
    private readonly notifier: BotNotifier,
    private readonly alerts: AlertService,
  ) {}

  /** Stops a run in progress on shutdown; it ends without sending anything. */
  onModuleDestroy(): void {
    this.runAbort?.abort();
  }

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
      this.alerts.warning('Scheduled digest skipped: a run is already in progress');
      return;
    }
    await this.execute('scheduled');
  }

  /** Never rejects: every failure is logged and, when possible, reported to the bot chat. */
  private async execute(trigger: DigestTrigger): Promise<void> {
    this.isRunning = true;
    const runAbort = new AbortController();
    this.runAbort = runAbort;
    const startedAt = Date.now();
    try {
      const report = await this.buildReport(new Date(startedAt), runAbort.signal);
      const messages = formatDigest(report);
      await this.notifier.send(messages);
      this.logger.log(
        `Digest ${trigger}: ${report.posts.length} posts, ${report.topics.length} topics, ` +
          `${report.collected.channelCount} channels, ${messages.length} messages, ` +
          `${Date.now() - startedAt} ms`,
      );
      this.reportGaps(trigger, report);
    } catch (error: unknown) {
      if (error instanceof DigestCancelledError) {
        this.logger.warn(`Digest ${trigger} cancelled: the application is shutting down`);
        return;
      }
      await this.reportFailure(trigger, error);
    } finally {
      this.isRunning = false;
      this.runAbort = undefined;
    }
  }

  private async buildReport(runAt: Date, signal: AbortSignal): Promise<DigestReport> {
    const collected = await this.collector.collect(
      this.config.channels,
      DIGEST_WINDOW_HOURS,
      signal,
    );
    const { kept, skippedCount } = limitPosts(collected.posts, DIGEST_MAX_POSTS);
    const { posts, untranslatedCount } = await this.prepareTexts(kept);
    const summary = await this.summarizeOrList(posts);
    const theses = await this.translateFallbackTheses(summary.topics);
    return {
      runAt,
      timezone: this.config.timezone,
      collected,
      posts,
      topics: theses.topics,
      untranslatedCount: untranslatedCount + theses.untranslatedCount,
      fallbackTopicCount: summary.fallbackTopicCount,
      skippedPostCount: skippedCount,
      isSummaryFallback: summary.isSummaryFallback,
    };
  }

  /** The texts the summary reads: translations with DIGEST_TRANSLATION=on, originals otherwise. */
  private async prepareTexts(posts: DigestPost[]): Promise<TranslationResult> {
    if (this.config.translationMode === 'on') {
      this.logger.log(`Digest: collected ${posts.length} posts, translating`);
      return this.translation.translate(posts);
    }
    this.logger.log(`Digest: collected ${posts.length} posts, summarizing the originals`);
    return { posts: posts.map(asOriginal), untranslatedCount: 0 };
  }

  private async summarizeOrList(posts: TranslatedPost[]): Promise<SummaryOutcome> {
    this.logger.log('Digest: summarizing');
    try {
      const { topics, fallbackTopicCount } = await this.summary.summarize(posts);
      return { topics, fallbackTopicCount, isSummaryFallback: false };
    } catch {
      // SummaryService's Grok client has logged why; the posts still go out, one block each.
      const topics = postsAsTopics(posts);
      return { topics, fallbackTopicCount: topics.length, isSummaryFallback: true };
    }
  }

  /** With DIGEST_TRANSLATION=off the fallback theses are cut from originals and translated here. */
  private async translateFallbackTheses(topics: DigestTopic[]): Promise<ThesisTranslationResult> {
    if (this.config.translationMode === 'on') {
      return { topics, untranslatedCount: 0 };
    }
    return this.translation.translateTheses(topics);
  }

  /** One warning per delivered run that lost something: a channel, posts, a translation, the summary. */
  private reportGaps(trigger: DigestTrigger, report: DigestReport): void {
    const { unavailableChannels, truncatedChannels } = report.collected;
    const hasGaps =
      report.isSummaryFallback ||
      unavailableChannels.length > 0 ||
      truncatedChannels.length > 0 ||
      report.untranslatedCount > 0 ||
      report.skippedPostCount > 0;
    if (!hasGaps) {
      return;
    }
    this.alerts.warning('Digest delivered with gaps', {
      trigger,
      isSummaryFallback: report.isSummaryFallback,
      unavailableChannels,
      truncatedChannels,
      untranslatedCount: report.untranslatedCount,
      skippedPostCount: report.skippedPostCount,
      fallbackTopicCount: report.fallbackTopicCount,
    });
  }

  private async reportFailure(trigger: DigestTrigger, error: unknown): Promise<void> {
    const status = error instanceof HttpException ? error.getStatus() : undefined;
    const cause =
      `${status ?? (error instanceof Error ? error.name : 'unknown')}` +
      `${error instanceof Error && !(error instanceof HttpException) ? ` (${error.message})` : ''}`;
    this.logger.error(`Digest ${trigger} failed: ${cause}`);
    const reason = (status !== undefined && FAILURE_REASONS.get(status)) || GENERIC_FAILURE_REASON;
    this.alerts.error('Digest run failed', {
      trigger,
      cause: status !== undefined ? String(status) : describeError(error),
      reason,
    });
    try {
      await this.notifier.send([formatFailure(reason)]);
    } catch (notifyError: unknown) {
      this.logger.error('Digest failure notice not delivered');
      this.alerts.error('Digest failure notice not delivered', {
        trigger,
        cause: describeError(notifyError),
      });
    }
  }
}
