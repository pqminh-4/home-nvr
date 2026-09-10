import { describe, expect, it } from 'vitest';
import { createOpenApiDocument, plannedOperations, publicSchemas } from '../src/index.js';

describe('Ranh giới hợp đồng dữ liệu', () => {
  it('không công bố trường secret hoặc đường dẫn lưu trữ trong DTO', () => {
    const schemaText = JSON.stringify(publicSchemas).toLowerCase();
    for (const key of ['password', 'ciphertext', 'sourceurl', 'rtspurl', 'relative_path', 'token_hash', 'password_hash']) expect(schemaText).not.toContain(key);
  });
  it('mỗi operation duy nhất và có phạm vi quyền rõ ràng', () => {
    expect(new Set(plannedOperations.map(item => `${item.method} ${item.path}`)).size).toBe(plannedOperations.length);
    expect(createOpenApiDocument().servers).toEqual([{ url: '/api/v1' }]);
    for (const operation of plannedOperations) expect(operation.access.length).toBeGreaterThan(0);
  });
});
