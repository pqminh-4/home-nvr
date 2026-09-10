import { createHash, randomBytes } from 'node:crypto';

export interface OnvifProbeResult { ok: boolean; code: 'READY' | 'AUTH_FAILED' | 'TIMEOUT' | 'UNREACHABLE' | 'INVALID_RESPONSE'; latencyMs: number; deviceInfo: boolean; capabilities: string[] }

const xmlEscape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const envelope = (user: string, password: string, method: 'GetDeviceInformation' | 'GetCapabilities') => {
  const nonce = randomBytes(16); const created = new Date().toISOString();
  const digest = createHash('sha1').update(Buffer.concat([nonce, Buffer.from(created), Buffer.from(password)])).digest('base64');
  const security = '<wsse:Security><wsse:UsernameToken><wsse:Username>' + xmlEscape(user) + '</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.1#PasswordDigest">' + digest + '</wsse:Password><wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">' + nonce.toString('base64') + '</wsse:Nonce><wsu:Created>' + created + '</wsu:Created></wsse:UsernameToken></wsse:Security>';
  return '<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"><s:Header>' + security + '</s:Header><s:Body><tds:' + method + '/></s:Body></s:Envelope>';
};

// Giới hạn phản hồi SOAP để camera lỗi không thể làm đầy bộ nhớ tiến trình.
async function readLimited(response: Response, maximum = 256 * 1024) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      throw new Error('ONVIF_RESPONSE_TOO_LARGE');
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export async function probeOnvif(endpoint: string, user: string, password: string, timeoutMs = 5000): Promise<OnvifProbeResult> {
  const started = Date.now(); let url: URL;
  try { url = new URL(endpoint); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error(); } catch { return { ok: false, code: 'INVALID_RESPONSE', latencyMs: 0, deviceInfo: false, capabilities: [] }; }
  const request = async (method: 'GetDeviceInformation' | 'GetCapabilities') => fetch(url, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/soap+xml; charset=utf-8' }, body: envelope(user, password, method), signal: AbortSignal.timeout(Math.max(1, timeoutMs - (Date.now() - started))) });
  try {
    const info = await request('GetDeviceInformation'); const infoText = await readLimited(info);
    if (info.status === 401 || /NotAuthorized|NotAuthenticated|ter:NotAuthorized/i.test(infoText)) return { ok: false, code: 'AUTH_FAILED', latencyMs: Date.now() - started, deviceInfo: false, capabilities: [] };
    if (!info.ok || !/<(?:[\w.-]+:)?GetDeviceInformationResponse/i.test(infoText)) return { ok: false, code: 'INVALID_RESPONSE', latencyMs: Date.now() - started, deviceInfo: false, capabilities: [] };
    const caps = await request('GetCapabilities'); const capsText = await readLimited(caps);
    const capabilities = ['Media', 'PTZ', 'Imaging', 'Events', 'DeviceIO'].filter(name => new RegExp('<(?:[\\w.-]+:)?' + name + '(?:\\s|/?>)', 'i').test(capsText));
    return { ok: true, code: 'READY', latencyMs: Date.now() - started, deviceInfo: true, capabilities };
  } catch (error) { return { ok: false, code: error instanceof DOMException && error.name === 'TimeoutError' ? 'TIMEOUT' : 'UNREACHABLE', latencyMs: Date.now() - started, deviceInfo: false, capabilities: [] }; }
}
