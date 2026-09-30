import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/** AES-256 key length; a key of any other length is rejected by the config loader. */
export const SECRET_KEY_BYTES = 32;

const CIPHER_ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const PAYLOAD_ENCODING = 'base64';

/**
 * Encrypts a secret with AES-256-GCM under a fresh random IV.
 * The result is `iv | tag | ciphertext`, base64-encoded, so it can be stored as one string.
 */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(PAYLOAD_ENCODING);
}

/** Reverses `encryptSecret`; throws when the key is wrong or the payload was altered. */
export function decryptSecret(payload: string, key: Buffer): string {
  const bytes = Buffer.from(payload, PAYLOAD_ENCODING);
  if (bytes.length < IV_BYTES + AUTH_TAG_BYTES) {
    throw new Error('Encrypted payload is too short');
  }
  const iv = bytes.subarray(0, IV_BYTES);
  const tag = bytes.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv(CIPHER_ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const ciphertext = bytes.subarray(IV_BYTES + AUTH_TAG_BYTES);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** SHA-256 hex digest: a stable lookup key that does not reveal the secret. */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}
