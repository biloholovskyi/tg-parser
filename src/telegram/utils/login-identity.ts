import { Api } from 'telegram/tl';

/** Who signed in, as far as an alert may tell: never the phone number or the name. */
export interface LoginIdentity {
  userId: string | null;
  username: string | null;
}

/**
 * Reads the account id and username from the result of `auth.SignIn` or `auth.CheckPassword`.
 * Any other shape (sign-up required, an unexpected answer) gives nulls instead of failing.
 */
export function toLoginIdentity(authorization: unknown): LoginIdentity {
  if (!(authorization instanceof Api.auth.Authorization)) {
    return { userId: null, username: null };
  }
  const { user } = authorization;
  if (!(user instanceof Api.User)) {
    return { userId: user ? user.id.toString() : null, username: null };
  }
  return { userId: user.id.toString(), username: user.username ?? null };
}
