import type { INestApplication } from '@nestjs/common';
import { AuthService } from '../src/telegram/auth.service';
import { SessionStore } from '../src/telegram/session-store';

/**
 * The E2E specs override only the TelegramService facade, so the real AuthService and
 * SessionStore are still constructed and each starts a background sweep. Their shutdown is
 * owned by the facade's onModuleDestroy, which the mock does not have, so a spec closes them
 * here before `app.close()` to leave no interval behind.
 */
export async function closeLifecycleProviders(app: INestApplication): Promise<void> {
  await app.get(AuthService).close();
  await app.get(SessionStore).close();
}
