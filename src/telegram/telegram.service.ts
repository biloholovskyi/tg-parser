import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Api } from 'telegram/tl';
import { HOURS_BACK_DEFAULT } from './dto/messages.dto';
import { EXTERNAL_CALL_TIMEOUT_MS } from './constants';
import { AuthService } from './auth.service';
import { ChannelService } from './channel.service';
import type { AuthResult } from './interfaces/auth-result.interface';
import type { GetPostsResponse } from './interfaces/message.interface';
import { SessionStore } from './session-store';
import { describeError, failWith, isInvalidSessionError } from './utils/telegram-errors';
import { withTimeout } from './utils/with-timeout';

/**
 * The module's entry point for the controller: delegates to AuthService, ChannelService and
 * SessionStore, and owns the shutdown order so pending logins are released before the cache.
 */
@Injectable()
export class TelegramService implements OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    private readonly auth: AuthService,
    private readonly channels: ChannelService,
    private readonly sessions: SessionStore,
  ) {}

  /** Releases every pending and cached client and stops the background sweeps. */
  async onModuleDestroy(): Promise<void> {
    await this.auth.close();
    await this.sessions.close();
  }

  /** One step of the multi-step login; see AuthService.authenticate. */
  authenticate(phoneNumber: string, phoneCode?: string, password?: string): Promise<AuthResult> {
    return this.auth.authenticate(phoneNumber, phoneCode, password);
  }

  /** Posts of a channel inside the last `hoursBack` hours; see ChannelService.getChannelPosts. */
  getChannelPosts(
    channelUsername: string,
    sessionString: string,
    hoursBack: number = HOURS_BACK_DEFAULT,
  ): Promise<GetPostsResponse> {
    return this.channels.getChannelPosts(channelUsername, sessionString, hoursBack);
  }

  /**
   * Reports whether the session is usable: `failed` means the session itself is unknown or
   * rejected by Telegram. A transport failure or flood wait is not a verdict on the session
   * and is thrown as the mapped HTTP exception instead.
   */
  async checkSession(sessionString: string): Promise<{ status: 'success' | 'failed' }> {
    try {
      const client = await this.sessions.getConnected(sessionString);
      await withTimeout(
        client.invoke(new Api.users.GetUsers({ id: [new Api.InputUserSelf()] })),
        EXTERNAL_CALL_TIMEOUT_MS,
        'Get self',
      );
      this.logger.log('Session check: success');
      return { status: 'success' };
    } catch (error: unknown) {
      if (!isInvalidSessionError(error)) {
        throw failWith(this.logger, 'Session check', error);
      }
      await this.sessions.evictIfSessionInvalid(sessionString, error);
      this.logger.log(`Session check: failed (${describeError(error)})`);
      return { status: 'failed' };
    }
  }
}
