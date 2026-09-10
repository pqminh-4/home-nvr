import { describe, expect, it } from 'vitest';
import { decryptSecret, deriveSecretKey, encryptSecret } from '../src/secrets.js';

describe('mã hóa secret camera', () => {
  it('mã hóa và giải mã được URL nguồn', () => {
    const key = deriveSecretKey('local-development-secret-key-please-change');
    const source = 'rtsp://admin:password@example.local:554/live';
    const ciphertext = encryptSecret(source, key);
    expect(ciphertext).not.toContain('password');
    expect(decryptSecret(ciphertext, key)).toBe(source);
  });
  it('từ chối khóa yếu và ciphertext bị sửa', () => {
    expect(() => deriveSecretKey('short')).toThrow();
    const key = deriveSecretKey('local-development-secret-key-please-change');
    const cipher = encryptSecret('rtsp://camera/live', key);
    expect(() => decryptSecret(cipher.slice(0, 12) + (cipher[12] === 'A' ? 'B' : 'A') + cipher.slice(13), key)).toThrow();
  });
});
