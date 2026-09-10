import dgram from 'node:dgram';
import { randomUUID } from 'node:crypto';

export interface OnvifDevice { address: string; endpoints: string[] }
export interface DiscoveryResult { ok: boolean; code: 'COMPLETE' | 'NETWORK_ERROR'; devices: OnvifDevice[]; latencyMs: number }

// Chỉ lấy XAddrs của phản hồi ProbeMatches tương ứng request; không thu các URL namespace.
export function parseDiscoveryPacket(xml: string, requestId: string, remote: string): OnvifDevice | null {
  if (xml.length > 65507 || /<!DOCTYPE|<!ENTITY/i.test(xml)) return null;
  const element = (name: string) => new RegExp('<(?:[\\w.-]+:)?' + name + '(?:\\s[^>]*)?>([^<]*)<\\/(?:[\\w.-]+:)?' + name + '\\s*>', 'i').exec(xml)?.[1]?.trim();
  if (element('RelatesTo') !== requestId || !/<(?:[\w.-]+:)?ProbeMatches(?:\s|>)/.test(xml)) return null;
  const raw = element('XAddrs');
  if (!raw) return null;
  const endpoints: string[] = [];
  for (const value of raw.split(/\s+/).slice(0, 8)) {
    try {
      const url = new URL(value.replace(/&amp;/g, '&'));
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hostname !== remote || url.hash) continue;
      endpoints.push(url.href);
    } catch { /* Bỏ qua endpoint sai định dạng từ thiết bị. */ }
  }
  return endpoints.length ? { address: remote, endpoints: [...new Set(endpoints)] } : null;
}

// Chỉ gửi discovery khi owner yêu cầu; TTL=1 giới hạn multicast trong mạng cục bộ.
export function discoverOnvif(timeoutMs = 2500, target = { host: '239.255.255.250', port: 3702 }): Promise<DiscoveryResult> {
  const started = Date.now();
  const id = 'uuid:' + randomUUID();
  const message = '<?xml version="1.0" encoding="UTF-8"?><e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl"><e:Header><w:MessageID>' + id + '</w:MessageID><w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To><w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header><e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body></e:Envelope>';
  return new Promise(resolve => {
    const socket = dgram.createSocket('udp4');
    const devices = new Map<string, OnvifDevice>();
    let done = false;
    const finish = (code: DiscoveryResult['code']) => {
      if (done) return; done = true; clearTimeout(timer);
      try { socket.close(); } catch { /* Socket chưa bind vẫn có thể được kết thúc an toàn. */ }
      resolve({ ok: code === 'COMPLETE', code, devices: [...devices.values()], latencyMs: Date.now() - started });
    };
    const timer = setTimeout(() => finish('COMPLETE'), timeoutMs);
    socket.on('error', () => finish('NETWORK_ERROR'));
    socket.on('message', (data, remote) => {
      if (done || devices.size >= 64) return;
      const device = parseDiscoveryPacket(data.toString('utf8'), id, remote.address);
      if (device) devices.set(device.address, device);
    });
    socket.bind(0, () => {
      if (done) return;
      try { socket.setMulticastTTL(1); socket.send(message, target.port, target.host, error => { if (error) finish('NETWORK_ERROR'); }); }
      catch { finish('NETWORK_ERROR'); }
    });
  });
}
