import { randomBytes } from 'crypto';
import { SECRET_KEY_BYTES, decryptSecret, encryptSecret, hashSecret } from './secret-cipher';

const PAYLOAD_ENCODING = 'base64';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

const inputSecret = 'fake-cipher-session-string';
const inputKey = Buffer.alloc(SECRET_KEY_BYTES, 1);
const inputOtherKey = Buffer.alloc(SECRET_KEY_BYTES, 2);

describe('secret-cipher', () => {
  describe('encryptSecret / decryptSecret', () => {
    it('round-trips the secret under the same key', () => {
      // Act
      const actualPayload = encryptSecret(inputSecret, inputKey);
      const actualSecret = decryptSecret(actualPayload, inputKey);

      // Assert
      expect(actualSecret).toBe(inputSecret);
    });

    it('round-trips a non-ASCII secret and an empty secret', () => {
      // Arrange
      const inputUnicode = 'fake-секрет-\u{1F511}';

      // Act
      const actualUnicode = decryptSecret(encryptSecret(inputUnicode, inputKey), inputKey);
      const actualEmpty = decryptSecret(encryptSecret('', inputKey), inputKey);

      // Assert
      expect(actualUnicode).toBe(inputUnicode);
      expect(actualEmpty).toBe('');
    });

    it('produces base64 laid out as iv | tag | ciphertext without the plaintext in it', () => {
      // Act
      const actualPayload = encryptSecret(inputSecret, inputKey);
      const actualBytes = Buffer.from(actualPayload, PAYLOAD_ENCODING);

      // Assert
      expect(actualBytes.toString(PAYLOAD_ENCODING)).toBe(actualPayload);
      expect(actualBytes.length).toBe(IV_BYTES + AUTH_TAG_BYTES + Buffer.byteLength(inputSecret));
      expect(actualPayload).not.toContain(inputSecret);
      expect(actualBytes.toString('utf8')).not.toContain(inputSecret);
    });

    it('uses a fresh IV per call, so the same secret never encrypts to the same payload', () => {
      // Act
      const actualFirst = encryptSecret(inputSecret, inputKey);
      const actualSecond = encryptSecret(inputSecret, inputKey);

      // Assert
      expect(actualFirst).not.toBe(actualSecond);
      const actualFirstIv = Buffer.from(actualFirst, PAYLOAD_ENCODING).subarray(0, IV_BYTES);
      const actualSecondIv = Buffer.from(actualSecond, PAYLOAD_ENCODING).subarray(0, IV_BYTES);
      expect(actualFirstIv.equals(actualSecondIv)).toBe(false);
      expect(decryptSecret(actualFirst, inputKey)).toBe(inputSecret);
      expect(decryptSecret(actualSecond, inputKey)).toBe(inputSecret);
    });

    it('throws when decrypting under a different key', () => {
      // Arrange
      const inputPayload = encryptSecret(inputSecret, inputKey);

      // Act
      const actualDecrypt = (): string => decryptSecret(inputPayload, inputOtherKey);

      // Assert
      expect(actualDecrypt).toThrow();
    });

    it('throws when the auth tag was tampered with', () => {
      // Arrange
      const inputBytes = Buffer.from(encryptSecret(inputSecret, inputKey), PAYLOAD_ENCODING);
      inputBytes[IV_BYTES] ^= 1;
      const inputTampered = inputBytes.toString(PAYLOAD_ENCODING);

      // Act
      const actualDecrypt = (): string => decryptSecret(inputTampered, inputKey);

      // Assert
      expect(actualDecrypt).toThrow();
    });

    it('throws when the ciphertext was tampered with', () => {
      // Arrange
      const inputBytes = Buffer.from(encryptSecret(inputSecret, inputKey), PAYLOAD_ENCODING);
      inputBytes[inputBytes.length - 1] ^= 1;
      const inputTampered = inputBytes.toString(PAYLOAD_ENCODING);

      // Act
      const actualDecrypt = (): string => decryptSecret(inputTampered, inputKey);

      // Assert
      expect(actualDecrypt).toThrow();
    });

    it.each([
      ['an empty payload', ''],
      [
        'a payload shorter than iv + tag',
        randomBytes(IV_BYTES + AUTH_TAG_BYTES - 1).toString(PAYLOAD_ENCODING),
      ],
    ])('throws "too short" for %s', (_label, inputPayload) => {
      // Act
      const actualDecrypt = (): string => decryptSecret(inputPayload, inputKey);

      // Assert
      expect(actualDecrypt).toThrow('Encrypted payload is too short');
    });
  });

  describe('hashSecret', () => {
    it('is a stable sha256 hex digest that does not contain the secret', () => {
      // Act
      const actualFirst = hashSecret(inputSecret);
      const actualSecond = hashSecret(inputSecret);

      // Assert
      expect(actualFirst).toBe(actualSecond);
      expect(actualFirst).toMatch(SHA256_HEX_PATTERN);
      expect(actualFirst).not.toContain(inputSecret);
    });

    it('differs for different secrets', () => {
      // Act
      const actualFirst = hashSecret(inputSecret);
      const actualSecond = hashSecret(`${inputSecret}-other`);

      // Assert
      expect(actualFirst).not.toBe(actualSecond);
    });
  });
});
