import { argon2Sync, createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

const argonParameters = { parallelism: 1, tagLength: 32, memory: 65536, passes: 3 } as const;

// Hash mật khẩu bằng Argon2id tích hợp Node; vẫn đọc hash scrypt cũ để nâng cấp khi đăng nhập.
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const digest = argon2Sync('argon2id', { message: password, nonce: salt, ...argonParameters });
  return `argon2id$v=19$m=65536,t=3,p=1$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}
export function verifyPassword(password: string, encoded: string): boolean {
  const parts = encoded.split('$');
  try {
    const expected = Buffer.from(parts.at(-1) ?? '', 'base64url');
    const salt = Buffer.from(parts.at(-2) ?? '', 'base64url');
    const actual = parts[0] === 'argon2id'
      ? argon2Sync('argon2id', { message: password, nonce: salt, ...argonParameters })
      : parts[0] === 'scrypt'
        ? scryptSync(password, salt, expected.length, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 })
        : Buffer.alloc(0);
    return expected.length > 0 && expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}
export function needsPasswordRehash(encoded: string): boolean { return !encoded.startsWith('argon2id$'); }
export function createSessionToken(): string { return randomUUID() + randomBytes(24).toString('base64url'); }
export function hashSessionToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }
