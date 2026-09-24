import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { TelegramClient } from 'telegram';
import { computeCheck } from 'telegram/Password';
import { Api } from 'telegram/tl';
import {
  AUTH_STATE_SWEEP_INTERVAL_MS,
  AUTH_STATE_TTL_MS,
  EXTERNAL_CALL_TIMEOUT_MS,
  PASSWORD_NEEDED_ERROR,
} from './constants';
import type { AuthResult } from './interfaces/auth-result.interface';
import { SessionStore } from './session-store';
import { TelegramClientFactory } from './telegram-client.factory';
import { failWith, missingConfigException } from './utils/telegram-errors';
import { withTimeout } from './utils/with-timeout';

const CODE_NOT_REQUESTED_MESSAGE = 'Request a code first by sending phoneNumber without a code';

/** A login between "code sent" and "signed in", held in memory only and keyed by phone number. */
interface AuthState {
  client: TelegramClient;
  phoneCodeHash: string;
  createdAt: number;
}

interface SignInStep {
  phoneNumber: string;
  phoneCode: string;
  password?: string;
}

/**
 * Multi-step login: request a code, sign in with it, then check the 2FA password when asked.
 * Pending attempts expire after AUTH_STATE_TTL_MS; their clients are released through SessionStore.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly authStates = new Map<string, AuthState>();
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(
    private readonly factory: TelegramClientFactory,
    private readonly sessions: SessionStore,
  ) {
    this.sweepTimer = setInterval(() => this.sweepExpired(), AUTH_STATE_SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  /**
   * Runs one auth step: without a code it sends one, with a code it signs in, and with a
   * password it completes 2FA. A failed step releases only the client it used itself.
   */
  async authenticate(
    phoneNumber: string,
    phoneCode?: string,
    password?: string,
  ): Promise<AuthResult> {
    if (!this.factory.hasCredentials) {
      throw missingConfigException();
    }
    try {
      return phoneCode
        ? await this.signIn({ phoneNumber, phoneCode, password })
        : await this.requestCode(phoneNumber);
    } catch (error: unknown) {
      throw failWith(this.logger, 'Auth', error);
    }
  }

  /** Stops the expiry sweep and releases every pending login client. */
  async close(): Promise<void> {
    clearInterval(this.sweepTimer);
    const pending = [...this.authStates.values()].map(({ client }) =>
      this.sessions.release(client),
    );
    this.authStates.clear();
    await Promise.all(pending);
  }

  private async requestCode(phoneNumber: string): Promise<AuthResult> {
    await this.dropAuthState(phoneNumber);
    const client = await this.sessions.openLoginClient();
    const phoneCodeHash = await this.sendCode(client, phoneNumber);
    await this.storeAuthState(phoneNumber, { client, phoneCodeHash, createdAt: Date.now() });
    this.logger.log('Auth: code sent');
    return {
      needsCode: true,
      message: 'Phone code has been sent to your phone. Please provide the code.',
    };
  }

  /** Sends the login code, releasing the client when Telegram refuses. */
  private async sendCode(client: TelegramClient, phoneNumber: string): Promise<string> {
    try {
      const { apiId, apiHash } = this.factory.credentials;
      const result = await withTimeout(
        client.sendCode({ apiId, apiHash }, phoneNumber),
        EXTERNAL_CALL_TIMEOUT_MS,
        'Send code',
      );
      return result.phoneCodeHash;
    } catch (error: unknown) {
      await this.sessions.release(client);
      throw error;
    }
  }

  private async signIn(step: SignInStep): Promise<AuthResult> {
    const state = this.authStates.get(step.phoneNumber);
    if (!state) {
      throw new BadRequestException(CODE_NOT_REQUESTED_MESSAGE);
    }
    try {
      return await this.continueLogin(state, step);
    } catch (error: unknown) {
      await this.dropAuthState(step.phoneNumber, state);
      throw error;
    }
  }

  private async continueLogin(state: AuthState, step: SignInStep): Promise<AuthResult> {
    const needsPassword = await this.submitCode(state, step);
    if (!needsPassword) {
      return this.completeLogin(step.phoneNumber, state, 'Auth: authenticated');
    }
    if (!step.password) {
      this.logger.log('Auth: 2FA password required');
      return { needsPassword: true, message: '2FA password is required.' };
    }
    await this.checkPassword(state.client, step.password);
    return this.completeLogin(step.phoneNumber, state, 'Auth: authenticated with 2FA');
  }

  /** Signs in with the code; true when Telegram asks for the 2FA password instead. */
  private async submitCode(state: AuthState, step: SignInStep): Promise<boolean> {
    try {
      const request = new Api.auth.SignIn({
        phoneNumber: step.phoneNumber,
        phoneCodeHash: state.phoneCodeHash,
        phoneCode: step.phoneCode,
      });
      await withTimeout(state.client.invoke(request), EXTERNAL_CALL_TIMEOUT_MS, 'Sign in');
      return false;
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes(PASSWORD_NEEDED_ERROR)) {
        return true;
      }
      throw error;
    }
  }

  private async checkPassword(client: TelegramClient, password: string): Promise<void> {
    const passwordInfo = await withTimeout(
      client.invoke(new Api.account.GetPassword()),
      EXTERNAL_CALL_TIMEOUT_MS,
      'Get password',
    );
    const passwordSrp = await computeCheck(passwordInfo, password);
    await withTimeout(
      client.invoke(new Api.auth.CheckPassword({ password: passwordSrp })),
      EXTERNAL_CALL_TIMEOUT_MS,
      'Check password',
    );
  }

  /** Hands the signed-in client to SessionStore and forgets the pending attempt. */
  private async completeLogin(
    phoneNumber: string,
    state: AuthState,
    outcome: string,
  ): Promise<AuthResult> {
    // Claim the attempt before the await, so a concurrent step 1 cannot release this client;
    // a newer attempt stored for the phone meanwhile is left in place.
    if (this.authStates.get(phoneNumber) === state) {
      this.authStates.delete(phoneNumber);
    }
    const sessionString = await this.sessions.adopt(state.client);
    this.logger.log(outcome);
    return { sessionString, message: 'Successfully authenticated' };
  }

  /** A concurrent request may have stored its own pending client meanwhile; release it first. */
  private async storeAuthState(phoneNumber: string, state: AuthState): Promise<void> {
    const replaced = this.authStates.get(phoneNumber);
    if (replaced && replaced.client !== state.client) {
      await this.sessions.release(replaced.client);
    }
    this.authStates.set(phoneNumber, state);
  }

  /** Drops the pending attempt for the phone; with `owned`, only when it is still that attempt. */
  private async dropAuthState(phoneNumber: string, owned?: AuthState): Promise<void> {
    const state = this.authStates.get(phoneNumber);
    if (state && (!owned || state === owned)) {
      this.authStates.delete(phoneNumber);
    }
    const released = owned ?? state;
    if (released) {
      await this.sessions.release(released.client);
    }
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [phoneNumber, state] of this.authStates) {
      if (now - state.createdAt > AUTH_STATE_TTL_MS) {
        this.authStates.delete(phoneNumber);
        void this.sessions.release(state.client);
      }
    }
  }
}
