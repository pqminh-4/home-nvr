import { useEffect, useRef, useState } from 'react';
import type Hls from 'hls.js';
import type { ApiCamera } from './api';
import { apiRequest, ApiRequestError } from './api';
import { Icon } from './ui';

type PlayerState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'fallback' | 'error';
interface LiveSession { id: string; endpoint: string; transport: 'webrtc' | 'll-hls'; state: string; expiresAt: string }

function waitForIceGathering(peer: RTCPeerConnection) {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise<void>(resolve => {
    const timeout = window.setTimeout(() => { peer.removeEventListener('icegatheringstatechange', done); resolve(); }, 2200);
    function done() { if (peer.iceGatheringState !== 'complete') return; window.clearTimeout(timeout); peer.removeEventListener('icegatheringstatechange', done); resolve(); }
    peer.addEventListener('icegatheringstatechange', done);
  });
}

function errorText(error: unknown) {
  return error instanceof ApiRequestError ? error.message : 'Không thể mở luồng camera.';
}

export function LivePlayer({ camera, notify, muted = true, compact = false }: { camera: ApiCamera; notify: (text: string) => void; muted?: boolean; compact?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const peer = useRef<RTCPeerConnection | null>(null);
  const hls = useRef<Hls | null>(null);
  const sessionId = useRef('');
  const stopped = useRef(false);
  const retryTimer = useRef<number | null>(null);
  const [state, setState] = useState<PlayerState>('idle');
  const [message, setMessage] = useState('Sẵn sàng mở luồng');
  const [audioMuted, setAudioMuted] = useState(muted);
  const [transport, setTransport] = useState<'webrtc' | 'll-hls'>('webrtc');
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => setAudioMuted(muted), [muted]);
  useEffect(() => {
    stopped.current = false;
    setState('connecting');
    setMessage(transport === 'webrtc' ? 'Đang thương lượng WebRTC…' : 'Đang tải LL-HLS…');
    const element = video.current;
    const close = async () => {
      stopped.current = true;
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
      peer.current?.close(); peer.current = null;
      hls.current?.destroy(); hls.current = null;
      if (element) { element.pause(); element.removeAttribute('src'); element.srcObject = null; }
      const id = sessionId.current; sessionId.current = '';
      if (id) await fetch('/api/v1/live-sessions/' + id, { method: 'DELETE', credentials: 'same-origin' }).catch(() => undefined);
    };
    const scheduleReconnect = () => {
      if (stopped.current) return;
      if (retryTimer.current !== null) return;
      if (retryCount >= 3) { setState('error'); setMessage('Không thể duy trì kết nối camera.'); return; }
      setState('reconnecting');
      setMessage('Mất tín hiệu · đang kết nối lại ' + (retryCount + 1) + '/3');
      retryTimer.current = window.setTimeout(() => { retryTimer.current = null; setRetryCount(value => value + 1); }, [1000, 2000, 5000][retryCount] ?? 5000);
    };
    const playFallback = async (session: LiveSession) => {
      if (!element || stopped.current) return;
      if (element.canPlayType('application/vnd.apple.mpegurl')) {
        element.src = session.endpoint;
        element.onloadedmetadata = () => { void element.play().catch(() => undefined); setState('live'); setMessage('LL-HLS · dự phòng'); };
        element.onerror = scheduleReconnect;
      } else {
        const { default: Hls } = await import('hls.js');
        if (!Hls.isSupported()) { setState('error'); setMessage('Trình duyệt không hỗ trợ LL-HLS.'); return; }
        const instance = new Hls({ lowLatencyMode: true, backBufferLength: 0, maxBufferLength: 4, liveSyncDurationCount: 2, liveMaxLatencyDurationCount: 5, enableWorker: true });
        hls.current = instance;
        instance.on(Hls.Events.MEDIA_ATTACHED, () => instance.loadSource(session.endpoint));
        instance.on(Hls.Events.MANIFEST_PARSED, () => { void element.play().catch(() => undefined); setState('live'); setMessage('LL-HLS · dự phòng'); });
        instance.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) { instance.destroy(); hls.current = null; scheduleReconnect(); } });
        instance.attachMedia(element);
      }
    };
    const start = async () => {
      try {
        const session = await apiRequest<LiveSession>('/api/v1/live-sessions', { method: 'POST', body: JSON.stringify({ cameraId: camera.id, profile: camera.capabilities.substream ? 'sub' : 'main', transport }) });
        if (stopped.current) { await fetch('/api/v1/live-sessions/' + session.id, { method: 'DELETE' }).catch(() => undefined); return; }
        sessionId.current = session.id;
        if (transport === 'll-hls') { await playFallback(session); return; }
        const connection = new RTCPeerConnection({ iceServers: [] });
        peer.current = connection;
        connection.addTransceiver('video', { direction: 'recvonly' });
        connection.addTransceiver('audio', { direction: 'recvonly' });
        connection.ontrack = event => { if (element && event.streams[0]) { element.srcObject = event.streams[0]; void element.play().catch(() => { setAudioMuted(true); void element.play().catch(() => undefined); }); } };
        connection.onconnectionstatechange = () => { if (connection.connectionState === 'connected') { setState('live'); setMessage('WebRTC · độ trễ thấp'); } else if (['disconnected', 'failed'].includes(connection.connectionState)) scheduleReconnect(); };
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        await waitForIceGathering(connection);
        const local = connection.localDescription?.sdp;
        if (!local) throw new Error('SDP_EMPTY');
        const response = await fetch(session.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/sdp', Accept: 'application/sdp' }, body: local, credentials: 'same-origin' });
        if (!response.ok) throw new Error('WHEP_' + response.status);
        const answer = await response.text();
        await connection.setRemoteDescription({ type: 'answer', sdp: answer });
        if (connection.connectionState === 'connecting') { setState('connecting'); setMessage('Đang nhận khung hình…'); }
      } catch (error) {
        if (stopped.current) return;
        if (transport === 'webrtc' && retryCount === 0) { setTransport('ll-hls'); setRetryCount(0); setState('fallback'); setMessage('WebRTC chưa sẵn sàng · chuyển LL-HLS…'); return; }
        setState('error'); setMessage(errorText(error));
      }
    };
    void start();
    return () => { void close(); };
  }, [camera.id, camera.capabilities.substream, retryCount, transport]);

  async function toggleAudio() {
    const next = !audioMuted; setAudioMuted(next);
    if (video.current) video.current.muted = next;
    notify(next ? 'Đã tắt âm thanh camera.' : 'Đã bật âm thanh camera.');
  }
  async function snapshot() {
    const element = video.current;
    if (!element || !element.videoWidth) { notify('Chưa có khung hình để chụp.'); return; }
    const canvas = document.createElement('canvas'); canvas.width = element.videoWidth; canvas.height = element.videoHeight;
    canvas.getContext('2d')?.drawImage(element, 0, 0);
    const link = document.createElement('a'); link.download = camera.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase() + '-' + Date.now() + '.jpg'; link.href = canvas.toDataURL('image/jpeg', .9); link.click();
    notify('Đã tải ảnh chụp hiện tại.');
  }
  async function fullscreen() { try { if (document.fullscreenElement) await document.exitFullscreen(); else await video.current?.requestFullscreen(); } catch { notify('Trình duyệt không cho phép mở toàn màn hình.'); } }
  return <article className={'live-player-shell ' + (compact ? 'compact' : '')} aria-label={'Luồng trực tiếp ' + camera.name}>
    <div className={'live-player-visual ' + state}>
      <video ref={video} className="live-video" autoPlay playsInline muted={audioMuted} aria-label={'Video trực tiếp ' + camera.name}/>
      {state !== 'live' && <div className="live-player-state"><span className="live-state-ring"/><strong>{message}</strong><small>{state === 'error' ? 'Kiểm tra nguồn RTSP hoặc trạng thái MediaMTX.' : 'Luồng được giữ trong mạng cục bộ.'}</small></div>}
      <div className="live-player-top"><span className={'feed-label ' + (state === 'live' ? 'cyan' : 'amber')}><span className="dot"/>{state === 'live' ? (transport === 'webrtc' ? 'WEBRTC · LIVE' : 'LL-HLS · LIVE') : 'LIVE VIEW'}</span><span className="live-latency">{transport === 'webrtc' ? 'LOW LATENCY' : 'FALLBACK'}</span></div>
      <span className="live-corner live-corner-tl"/><span className="live-corner live-corner-tr"/><span className="live-corner live-corner-bl"/><span className="live-corner live-corner-br"/>
    </div>
    <div className="live-player-controls"><span className="recording-indicator">{state === 'live' ? <><span className="dot"/>Đang nhận luồng</> : message}</span><button className="icon-btn" aria-label={audioMuted ? 'Bật âm thanh camera' : 'Tắt âm thanh camera'} aria-pressed={!audioMuted} onClick={() => void toggleAudio()}><Icon name={audioMuted ? 'mute' : 'volume'} size={17}/></button><button className="icon-btn" aria-label="Chụp ảnh hiện tại" onClick={() => void snapshot()}><Icon name="snapshot" size={17}/></button><button className="icon-btn" aria-label="Toàn màn hình" onClick={() => void fullscreen()}><Icon name="fullscreen" size={17}/></button><button className="icon-btn" aria-label="Dùng LL-HLS dự phòng" aria-pressed={transport === 'll-hls'} onClick={() => { setRetryCount(0); setTransport('ll-hls'); }}><Icon name="refresh" size={17}/></button></div>
  </article>;
}
