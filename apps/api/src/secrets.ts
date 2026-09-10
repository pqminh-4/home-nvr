import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Mã hóa URL nguồn bằng AES-256-GCM; ciphertext không chứa URL hoặc credential dạng rõ.
export function deriveSecretKey(value: string): Buffer {
  if (!value || value.length < 32) throw new Error('NVR_SECRET_KEY phải có ít nhất 32 ký tự.');
  return createHash('sha256').update(value, 'utf8').digest();
}
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}
export function decryptSecret(payload: string, key: Buffer): string {
  const data = Buffer.from(payload, 'base64url');
  if (data.length < 28) throw new Error('Ciphertext không hợp lệ.');
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}
