export type DnsAction = 'create' | 'update' | 'unchanged';

export interface CloudflareDnsInput {
  zoneName: string;
  hostname: string;
  tunnelTarget: string;
  proxied: boolean;
  apiToken: string;
}

export interface CloudflareDnsPlan {
  zoneName: string;
  hostname: string;
  tunnelTarget: string;
  proxied: boolean;
  action: DnsAction;
  recordId: string | null;
}

interface CloudflareResponse<T> { success: boolean; result: T; errors?: { code?: number; message?: string }[]; }

type FetchLike = typeof fetch;

const apiRoot = 'https://api.cloudflare.com/client/v4';
const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function assertDomain(value: string, field: string) {
  const normalized = value.trim().toLocaleLowerCase('en-US').replace(/\.$/, '');
  if (!domainPattern.test(normalized)) throw new Error(field + ' không hợp lệ.');
  return normalized;
}

function assertTarget(value: string) {
  const normalized = value.trim().toLocaleLowerCase('en-US').replace(/\.$/, '');
  if (!domainPattern.test(normalized) || !normalized.endsWith('.cfargotunnel.com')) throw new Error('Tunnel target phải là hostname cfargotunnel.com.');
  return normalized;
}

function requestError(response: Response, body: CloudflareResponse<unknown>) {
  const message = body.errors?.[0]?.message;
  return new Error(response.status === 403 ? 'Cloudflare từ chối token hoặc quyền Zone DNS.' : message ? 'Cloudflare trả về lỗi cấu hình.' : 'Cloudflare không phản hồi hợp lệ.');
}

export class CloudflareDnsService {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  private async call<T>(path: string, init: RequestInit = {}) {
    const response = await this.fetchImpl(apiRoot + path, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(8_000),
      headers: { Authorization: 'Bearer ' + String((init.headers ? new Headers(init.headers).get('Authorization')?.replace(/^Bearer\s+/i, '') : '') ?? ''), 'Content-Type': 'application/json' },
    });
    const body = await response.json().catch(() => null) as CloudflareResponse<T> | null;
    if (!response.ok || !body?.success) throw requestError(response, body ?? { success: false, result: [] });
    return body.result;
  }

  private async validateToken(token: string) {
    if (token.trim().length < 20) throw new Error('Cloudflare API token không hợp lệ.');
    await this.call('/user/tokens/verify', { headers: { Authorization: 'Bearer ' + token } });
  }

  async plan(input: CloudflareDnsInput): Promise<CloudflareDnsPlan> {
    const zoneName = assertDomain(input.zoneName, 'Zone domain');
    const hostname = assertDomain(input.hostname, 'Hostname');
    const tunnelTarget = assertTarget(input.tunnelTarget);
    if (hostname !== zoneName && !hostname.endsWith('.' + zoneName)) throw new Error('Hostname phải nằm trong zone domain đã chọn.');
    await this.validateToken(input.apiToken);
    const zones = await this.call<{ id: string; name: string }[]>('/zones?name=' + encodeURIComponent(zoneName) + '&status=active&per_page=1', { headers: { Authorization: 'Bearer ' + input.apiToken } });
    const zone = zones[0];
    if (!zone) throw new Error('Không tìm thấy zone Cloudflare hoặc token không có quyền đọc zone.');
    const records = await this.call<{ id: string; name: string; content: string; proxied: boolean }[]>('/zones/' + encodeURIComponent(zone.id) + '/dns_records?type=CNAME&name=' + encodeURIComponent(hostname) + '&per_page=100', { headers: { Authorization: 'Bearer ' + input.apiToken } });
    const current = records.find(record => record.name.toLocaleLowerCase('en-US') === hostname);
    return { zoneName, hostname, tunnelTarget, proxied: input.proxied, action: current && current.content.toLocaleLowerCase('en-US') === tunnelTarget && current.proxied === input.proxied ? 'unchanged' : current ? 'update' : 'create', recordId: current?.id ?? null };
  }

  async apply(input: CloudflareDnsInput, plan?: CloudflareDnsPlan) {
    const resolvedPlan = plan ?? await this.plan(input);
    if (resolvedPlan.action === 'unchanged') return resolvedPlan;
    const zones = await this.call<{ id: string; name: string }[]>('/zones?name=' + encodeURIComponent(resolvedPlan.zoneName) + '&status=active&per_page=1', { headers: { Authorization: 'Bearer ' + input.apiToken } });
    const zone = zones[0];
    if (!zone) throw new Error('Không tìm thấy zone Cloudflare.');
    const body = JSON.stringify({ type: 'CNAME', name: resolvedPlan.hostname, content: resolvedPlan.tunnelTarget, ttl: 1, proxied: resolvedPlan.proxied });
    const path = '/zones/' + encodeURIComponent(zone.id) + '/dns_records' + (resolvedPlan.recordId ? '/' + encodeURIComponent(resolvedPlan.recordId) : '');
    const result = await this.call<{ id: string }>(path, { method: resolvedPlan.recordId ? 'PUT' : 'POST', headers: { Authorization: 'Bearer ' + input.apiToken }, body });
    return { ...resolvedPlan, action: 'unchanged' as const, recordId: result.id };
  }
}
