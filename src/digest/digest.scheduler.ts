import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import type { DigestConfig } from '../config/digest.config';
import { DIGEST_CONFIG, DIGEST_JOB_NAME } from './constants';
import { DigestService } from './digest.service';

/**
 * Registers the daily run with the schedule and time zone from the config. An unconfigured
 * digest or an invalid schedule registers nothing and never fails the boot.
 */
@Injectable()
export class DigestScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DigestScheduler.name);

  constructor(
    @Inject(DIGEST_CONFIG) private readonly config: DigestConfig,
    private readonly registry: SchedulerRegistry,
    private readonly digest: DigestService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.isConfigured) {
      return;
    }
    try {
      const job = CronJob.from({
        cronTime: this.config.cron,
        onTick: () => this.digest.runScheduled(),
        timeZone: this.config.timezone,
      });
      this.registry.addCronJob(DIGEST_JOB_NAME, job);
      job.start();
      this.logger.log(`Digest scheduled: "${this.config.cron}" ${this.config.timezone}`);
    } catch (error: unknown) {
      this.logger.error(
        `Digest not scheduled: ${error instanceof Error ? error.message : 'invalid schedule'}`,
      );
    }
  }

  /** Stops and removes the job, so no tick fires while the application shuts down. */
  onModuleDestroy(): void {
    if (this.registry.doesExist('cron', DIGEST_JOB_NAME)) {
      this.registry.getCronJob(DIGEST_JOB_NAME).stop();
      this.registry.deleteCronJob(DIGEST_JOB_NAME);
    }
  }
}
