import net from 'node:net';
import tls from 'node:tls';
import { createHash, randomBytes } from 'node:crypto';

export type ProbeCode = 'READY' | 'INVALID_URL' | 'TIMEOUT' | 'UNREACHABLE' | 'TLS_ERROR' | 'AUTH_FAILED' | 'AUTH_UNSUPPORTED' | 'NOT_FOUND' | 'INVALID_RESPONSE' | 'NO_VIDEO';
export interface ProbeResult { ok: boolean; code: ProbeCode; latencyMs: number; video: boolean; audio: boolean }

// URL chỉ được giải mã trong bộ nhớ, không đưa vào response hoặc exception công khai.
export function parseSource(source: string): URL {
  if (source.length > 4096 || /[\u0000-\u0020\u007f]/.test(source)) throw new Error('INVALID_URL');
  const url = new URL(source);
  if (!['rtsp:', 'rtsps:'].includes(url.protocol) || !url.hostname || url.hash || url.port === '0') throw new Error('INVALID_URL');
  for (const part of [url.username, url.password]) if (/[\r\n\u0000]/.test(decodeURIComponent(part))) throw new Error('INVALID_URL');
  return url;
}

function authorization(challenge: string, user: string, password: string, uri: string): string | null {
  if (/^Basic /i.test(challenge)) return 'Basic ' + Buffer.from(user + ':' + password).toString('base64');
  if (!/^Digest /i.test(challenge)) return null;
  const parts = Object.fromEntries([...challenge.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)].map(m => [m[1]!.toLowerCase(), m[2] ?? m[3]!]));
  if (!parts.realm || !parts.nonce || /[\r\n]/.test(challenge)) return null;
  const algorithm = (parts.algorithm ?? 'MD5').toUpperCase();
  if (!['MD5', 'SHA-256'].includes(algorithm)) return null;
  const qop = parts.qop?.split(',').map(x => x.trim());
  if (qop && !qop.includes('auth')) return null;
  const hash = (text: string) => createHash(algorithm === 'MD5' ? 'md5' : 'sha256').update(text).digest('hex');
  const cnonce = randomBytes(16).toString('hex');
  const ha1 = hash(user + ':' + parts.realm + ':' + password);
  const ha2 = hash('DESCRIBE:' + uri);
  const response = hash(ha1 + ':' + parts.nonce + ':' + (qop ? '00000001:' + cnonce + ':auth:' : '') + ha2);
  const quote = (value: string) => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  return 'Digest username=' + quote(user) + ', realm=' + quote(parts.realm) + ', nonce=' + quote(parts.nonce) +
    ', uri=' + quote(uri) + ', response=' + quote(response) + ', algorithm=' + algorithm +
    (parts.opaque ? ', opaque=' + quote(parts.opaque) : '') + (qop ? ', qop=auth, nc=00000001, cnonce=' + quote(cnonce) : '');
}

interface Response { status: number; headers: Record<string, string>; body: string }
// Một lần DESCRIBE có ngân sách thời gian tuyệt đối, kể cả DNS/TLS và phản hồi nhỏ giọt.
function describe(url: URL, timeout: number, auth = ''): Promise<Response> {
  return new Promise((resolve, reject) => {
    let socket: net.Socket | undefined;
    let done = false;
    let buffer = Buffer.alloc(0);
    const finish = (error?: string, response?: Response) => {
      if (done) return;
      done = true; clearTimeout(timer); socket?.destroy();
      if (error) reject(new Error(error)); else resolve(response!);
    };
    const timer = setTimeout(() => finish('TIMEOUT'), Math.max(1, timeout));
    const uri = new URL(url); uri.username = ''; uri.password = '';
    const send = () => socket!.write('DESCRIBE ' + uri.href + ' RTSP/1.0\r\nCSeq: 1\r\nAccept: application/sdp\r\nUser-Agent: Home-NVR\r\n' + (auth ? 'Authorization: ' + auth + '\r\n' : '') + '\r\n');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const port = Number(url.port || (url.protocol === 'rtsps:' ? 322 : 554));
    try {
      socket = url.protocol === 'rtsps:' ? tls.connect({ host, port, ...(net.isIP(host) ? {} : { servername: host }), rejectUnauthorized: true }, send) : net.createConnection({ host, port }, send);
    } catch { finish('UNREACHABLE'); return; }
    socket.on('error', (error: NodeJS.ErrnoException) => finish(url.protocol === 'rtsps:' && /CERT|TLS|SSL|SELF_SIGNED/.test(error.code ?? '') ? 'TLS_ERROR' : 'UNREACHABLE'));
    socket.on('end', () => finish('INVALID_RESPONSE'));
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 131072) { finish('INVALID_RESPONSE'); return; }
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) { if (buffer.length > 16384) finish('INVALID_RESPONSE'); return; }
      const lines = buffer.subarray(0, end).toString('utf8').split('\r\n');
      const match = /^RTSP\/1\.0 (\d{3})(?: |$)/.exec(lines.shift() ?? '');
      if (!match) { finish('INVALID_RESPONSE'); return; }
      const headers: Record<string, string> = {};
      for (const line of lines) {
        const at = line.indexOf(':');
        if (at < 1) { finish('INVALID_RESPONSE'); return; }
        headers[line.slice(0, at).toLowerCase()] = line.slice(at + 1).trim();
      }
      const size = headers['content-length'] ?? '0';
      if (!/^\d+$/.test(size) || Number(size) > 114688 || headers.cseq !== '1') { finish('INVALID_RESPONSE'); return; }
      if (buffer.length < end + 4 + Number(size)) return;
      finish(undefined, { status: Number(match[1]), headers, body: buffer.subarray(end + 4, end + 4 + Number(size)).toString('utf8') });
    });
  });
}

export async function probeRtsp(source: string, timeoutMs = 5000): Promise<ProbeResult> {
  const started = Date.now();
  const result = (code: ProbeCode, video = false, audio = false): ProbeResult => ({ ok: code === 'READY', code, latencyMs: Date.now() - started, video, audio });
  let url: URL;
  try { url = parseSource(source); } catch { return result('INVALID_URL'); }
  try {
    let response = await describe(url, timeoutMs);
    if (response.status === 401) {
      if (!url.username) return result('AUTH_FAILED');
      const uri = new URL(url); uri.username = ''; uri.password = '';
      const auth = authorization(response.headers['www-authenticate'] ?? '', decodeURIComponent(url.username), decodeURIComponent(url.password), uri.href);
      if (!auth) return result('AUTH_UNSUPPORTED');
      if (Date.now() - started >= timeoutMs) return result('TIMEOUT');
      response = await describe(url, timeoutMs - (Date.now() - started), auth);
    }
    if ([401, 403].includes(response.status)) return result('AUTH_FAILED');
    if (response.status === 404) return result('NOT_FOUND');
    if (response.status !== 200 || !/^application\/sdp(?:;|$)/i.test(response.headers['content-type'] ?? '') || !/^v=0\r?$/m.test(response.body)) return result('INVALID_RESPONSE');
    const video = /^m=video\s/m.test(response.body);
    return result(video ? 'READY' : 'NO_VIDEO', video, /^m=audio\s/m.test(response.body));
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    return result(['TIMEOUT', 'TLS_ERROR', 'UNREACHABLE'].includes(code) ? code as ProbeCode : 'INVALID_RESPONSE');
  }
}
