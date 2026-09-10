import { afterEach, describe, expect, it } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import { parseSource, probeRtsp } from '../src/probe.js';
import { parseDiscoveryPacket } from '../src/onvif.js';
import { probeOnvif } from '../src/onvif-probe.js';
const servers: Array<net.Server | http.Server> = [];
afterEach(() => { for (const server of servers) server.close(); servers.length = 0; });
describe('RTSP/ONVIF probe', () => {
  it('đọc DESCRIBE và SDP mà không trả credential', async () => {
    const server = net.createServer(socket => { socket.once('data', () => socket.end('RTSP/1.0 200 OK\r\nCSeq: 1\r\nContent-Type: application/sdp\r\nContent-Length: 39\r\n\r\nv=0\r\nm=video 0 RTP/AVP 96\r\nm=audio 0 RTP/AVP 0\r\n')); }); servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve())); const port = (server.address() as net.AddressInfo).port; const result = await probeRtsp(`rtsp://user:secret@127.0.0.1:${port}/live`); expect(result).toMatchObject({ ok: true, code: 'READY', video: true, audio: true }); expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('xác thực ONVIF UsernameToken và nhận capability từ SOAP', async () => {
    const server = http.createServer((request, response) => { let body = ''; request.on('data', chunk => { body += chunk; }); request.on('end', () => { expect(body).toContain('PasswordDigest'); const method = body.includes('GetCapabilities') ? 'GetCapabilities' : 'GetDeviceInformation'; const payload = method === 'GetCapabilities' ? '<tds:GetCapabilitiesResponse><tds:Capabilities><tt:Media/><tt:PTZ/></tds:Capabilities></tds:GetCapabilitiesResponse>' : '<tds:GetDeviceInformationResponse><tds:Manufacturer>Test</tds:Manufacturer></tds:GetDeviceInformationResponse>'; response.writeHead(200, { 'content-type': 'application/soap+xml' }); response.end('<s:Envelope><s:Body>' + payload + '</s:Body></s:Envelope>'); }); });
    servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const port = (server.address() as net.AddressInfo).port;
    expect(await probeOnvif(`http://127.0.0.1:${port}/onvif/device_service`, 'admin', 'secret')).toMatchObject({ ok: true, code: 'READY', deviceInfo: true, capabilities: ['Media', 'PTZ'] });
  });  it('lọc URL nguồn nguy hiểm và parse đúng ProbeMatches', () => { expect(() => parseSource('rtsp://a\r\n@camera/live')).toThrow(); const xml = '<Envelope><RelatesTo>uuid:req</RelatesTo><ProbeMatches><ProbeMatch><XAddrs>http://192.168.1.20/onvif/device_service https://evil.test/x</XAddrs></ProbeMatch></ProbeMatches></Envelope>'; expect(parseDiscoveryPacket(xml, 'uuid:req', '192.168.1.20')).toEqual({ address: '192.168.1.20', endpoints: ['http://192.168.1.20/onvif/device_service'] }); });
});
