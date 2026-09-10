import { describe, expect, it, vi } from 'vitest';
import { CloudflareDnsService } from '../src/cloudflare.js';

describe('Cloudflare DNS-only', () => {
  it('lập kế hoạch tạo CNAME mà không lưu token', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const authorization = init?.headers instanceof Headers
        ? init.headers.get('Authorization')
        : (init?.headers as Record<string, string> | undefined)?.Authorization;
      expect(authorization).toContain('Bearer token-value-123456789');
      if (url.endsWith('/user/tokens/verify')) return new Response(JSON.stringify({ success: true, result: { status: 'active' } }), { status: 200 });
      if (url.includes('/zones?')) return new Response(JSON.stringify({ success: true, result: [{ id: 'zone-1', name: 'example.com' }] }), { status: 200 });
      return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
    });
    const service = new CloudflareDnsService(fetchImpl as typeof fetch);
    const plan = await service.plan({ zoneName: 'example.com', hostname: 'nvr.example.com', tunnelTarget: 'abc.cfargotunnel.com', proxied: true, apiToken: 'token-value-123456789' });
    expect(plan).toMatchObject({ action: 'create', zoneName: 'example.com', hostname: 'nvr.example.com', tunnelTarget: 'abc.cfargotunnel.com' });
  });
});
