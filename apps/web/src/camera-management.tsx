import { useEffect, useState, type FormEvent } from 'react';
import { apiRequest, ApiRequestError, type ApiCamera, type SessionUser } from './api';
import { LivePlayer } from './live';
import { Badge, EmptyState, Icon, Modal, PageHeading } from './ui';
import type { DemoCamera, DemoState } from './demo';

function requestMessage(error: unknown) {
  return error instanceof ApiRequestError ? error.message : 'Không thể kết nối API camera.';
}

interface ProbeResult {
  ok: boolean;
  code: string;
  latencyMs: number;
  audio?: boolean;
  deviceInfo?: { manufacturer?: string; model?: string };
  capabilities?: string[];
}
interface OnvifDevice { address: string; endpoints: string[] }

function cameraView(camera: ApiCamera): DemoCamera {
  const state: DemoState = camera.state === 'online' ? 'online' : 'offline';
  return {
    id: camera.id,
    name: camera.name,
    location: camera.location || 'Chưa đặt khu vực',
    state,
    recording: camera.recordingMode !== 'off',
    bitrate: camera.lastProbe ? camera.lastProbe.latencyMs + ' ms' : '—',
    resolution: camera.capabilities.audio ? 'VIDEO + AUDIO' : 'VIDEO',
  };
}

function AddCameraModal({ onClose, onAdded }: { onClose: () => void; onAdded: (camera: ApiCamera) => void }) {
  const [tab, setTab] = useState<'rtsp' | 'onvif'>('rtsp');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<OnvifDevice[]>([]);
  const [onvifResult, setOnvifResult] = useState<ProbeResult | null>(null);
  const [endpoint, setEndpoint] = useState('');

  async function addCamera(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const source = new URL(String(data.get('source') ?? ''));
      if (!['rtsp:', 'rtsps:'].includes(source.protocol) || !source.hostname) throw new Error('invalid');
      const username = String(data.get('username') ?? '');
      const password = String(data.get('password') ?? '');
      if (username) source.username = username;
      if (password) source.password = password;
      const camera = await apiRequest<ApiCamera>('/api/v1/cameras', {
        method: 'POST',
        body: JSON.stringify({
          name: String(data.get('name') ?? '').trim(),
          location: String(data.get('location') ?? '').trim(),
          mainSourceUrl: source.href,
        }),
      });
      const probe = await apiRequest<ProbeResult>('/api/v1/cameras/' + camera.id + '/probe', { method: 'POST' });
      onAdded({ ...camera, state: probe.ok ? 'online' : 'error', capabilities: { ...camera.capabilities, audio: Boolean(probe.audio) }, lastProbe: { code: probe.code, at: new Date().toISOString(), latencyMs: probe.latencyMs } });
      form.reset();
      onClose();
    } catch (requestError) {
      const invalidUrl = requestError instanceof TypeError || (requestError instanceof Error && requestError.message === 'invalid');
      setError(invalidUrl ? 'Địa chỉ cần bắt đầu bằng rtsp:// hoặc rtsps:// và có tên máy.' : requestMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function discover() {
    setError('');
    setBusy(true);
    setOnvifResult(null);
    try {
      const result = await apiRequest<{ devices: OnvifDevice[] }>('/api/v1/cameras/discovery', { method: 'POST' });
      setDevices(result.devices);
      if (!result.devices.length) setError('Không tìm thấy thiết bị qua multicast. Bạn vẫn có thể nhập endpoint ONVIF trực tiếp.');
    } catch (requestError) {
      setError(requestMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function testOnvif(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    setOnvifResult(null);
    const data = new FormData(event.currentTarget);
    try {
      const result = await apiRequest<ProbeResult>('/api/v1/cameras/onvif-probe', {
        method: 'POST',
        body: JSON.stringify({ endpoint: data.get('endpoint'), username: data.get('username'), password: data.get('password') }),
      });
      setOnvifResult(result);
      if (!result.ok) setError('ONVIF chưa sẵn sàng: ' + result.code);
    } catch (requestError) {
      setError(requestMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  return <Modal title="Kết nối camera" onClose={onClose}>
    <p className="notice">Thông tin kết nối chỉ gửi tới API cục bộ. URL RTSP được mã hóa trước khi lưu; mật khẩu ONVIF chỉ dùng cho lần kiểm tra này.</p>
    <div className="segmented" aria-label="Phương thức thêm">
      <button aria-pressed={tab === 'rtsp'} onClick={() => { setTab('rtsp'); setError(''); }}>Luồng RTSP</button>
      <button aria-pressed={tab === 'onvif'} onClick={() => { setTab('onvif'); setError(''); }}>Kiểm tra ONVIF</button>
    </div>
    {tab === 'rtsp' ? <form className="camera-connect-form" onSubmit={addCamera}>
      <div className="form-pair"><label className="form-field">Tên camera<input name="name" required maxLength={120} placeholder="Ví dụ: Cổng trước" autoComplete="off"/></label><label className="form-field">Khu vực<input name="location" maxLength={120} placeholder="Ví dụ: Sân trước" autoComplete="off"/></label></div>
      <label className="form-field">Địa chỉ luồng<input name="source" required placeholder="rtsp://192.168.1.20/Streaming/Channels/101" autoComplete="off" spellCheck={false}/></label>
      <div className="form-pair"><label className="form-field">Tên đăng nhập<input name="username" maxLength={80} autoComplete="username"/></label><label className="form-field">Mật khẩu<input name="password" type="password" maxLength={128} autoComplete="current-password"/></label></div>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="modal-footer"><button type="button" className="secondary-btn" onClick={onClose}>Hủy</button><button className="primary-btn" disabled={busy}>{busy ? <><span className="button-spinner"/>Đang kết nối…</> : <><Icon name="plus" size={17}/>Lưu và kiểm tra</>}</button></div>
    </form> : <div className="onvif-panel">
      <div className="discovery-head"><div><span className="eyebrow">WS-DISCOVERY · LAN</span><h3>Tìm hoặc nhập thiết bị</h3></div><button className="secondary-btn" disabled={busy} onClick={() => void discover()}><Icon name="search" size={16}/>Quét mạng</button></div>
      {devices.length > 0 && <div className="discovered-list">{devices.map(device => <button key={device.address} type="button" onClick={() => setEndpoint(device.endpoints[0] ?? '')}><span className="dot green"/><span><strong>{device.address}</strong><small>{device.endpoints[0]}</small></span><Icon name="arrow" size={15}/></button>)}</div>}
      <form onSubmit={testOnvif}>
        <label className="form-field">Endpoint ONVIF<input name="endpoint" value={endpoint} onChange={event => setEndpoint(event.target.value)} required type="url" placeholder="http://192.168.1.20/onvif/device_service" autoComplete="off" spellCheck={false}/></label>
        <div className="form-pair"><label className="form-field">Tên đăng nhập<input name="username" required maxLength={80} autoComplete="username"/></label><label className="form-field">Mật khẩu<input name="password" type="password" required maxLength={128} autoComplete="current-password"/></label></div>
        {error && <p className="inline-error" role="alert">{error}</p>}
        {onvifResult?.ok && <div className="probe-success" role="status"><Icon name="check" size={19}/><span><strong>{onvifResult.deviceInfo?.manufacturer ?? 'Camera ONVIF'} {onvifResult.deviceInfo?.model ?? ''}</strong><small>{onvifResult.latencyMs} ms · {(onvifResult.capabilities ?? []).join(' · ')}</small></span></div>}
        <div className="modal-footer"><button type="button" className="secondary-btn" onClick={onClose}>Đóng</button><button className="primary-btn" disabled={busy}>{busy ? <><span className="button-spinner"/>Đang kiểm tra…</> : <><Icon name="activity" size={17}/>Kiểm tra ONVIF</>}</button></div>
      </form>
    </div>}
  </Modal>;
}

export function CamerasPage({ notify, user }: { notify: (text: string) => void; user: SessionUser }) {
  const [items, setItems] = useState<ApiCamera[]>([]);
  const [backendState, setBackendState] = useState<'checking' | 'connected' | 'offline'>('checking');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState(false);
  const [detail, setDetail] = useState<ApiCamera | null>(null);
  const [workingId, setWorkingId] = useState('');

  async function loadCameras() {
    setBackendState('checking');
    try {
      setItems(await apiRequest<ApiCamera[]>('/api/v1/cameras'));
      setBackendState('connected');
    } catch {
      setBackendState('offline');
    }
  }

  useEffect(() => { void loadCameras(); }, []);
  const visible = items.filter(item => (filter === 'all' || filter === item.state) && (item.name + item.location).toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi')));

  async function probe(camera: ApiCamera) {
    setWorkingId(camera.id);
    try {
      const result = await apiRequest<ProbeResult>('/api/v1/cameras/' + camera.id + '/probe', { method: 'POST' });
      await loadCameras();
      notify(result.ok ? 'Kết nối ' + camera.name + ' ổn định trong ' + result.latencyMs + ' ms.' : camera.name + ': ' + result.code + '.');
    } catch (error) {
      notify(requestMessage(error));
    } finally {
      setWorkingId('');
    }
  }

  async function setRecording(camera: ApiCamera) {
    const mode = camera.recordingMode === 'continuous' ? 'off' : 'continuous';
    setWorkingId(camera.id);
    try {
      const updated = await apiRequest<ApiCamera>('/api/v1/cameras/' + camera.id, { method: 'PATCH', body: JSON.stringify({ recordingMode: mode }) });
      setItems(current => current.map(item => item.id === updated.id ? updated : item));
      setDetail(updated);
      notify(mode === 'continuous' ? 'Đã bật ghi liên tục cho ' + camera.name + '.' : 'Đã dừng ghi liên tục cho ' + camera.name + '.');
    } catch (error) { notify(requestMessage(error)); }
    finally { setWorkingId(''); }
  }
  async function remove(camera: ApiCamera) {
    if (!window.confirm('Xóa camera “' + camera.name + '” khỏi Home NVR?')) return;
    setWorkingId(camera.id);
    try {
      await apiRequest<void>('/api/v1/cameras/' + camera.id, { method: 'DELETE' });
      setItems(current => current.filter(item => item.id !== camera.id));
      setDetail(null);
      notify('Đã xóa camera.');
    } catch (error) {
      notify(requestMessage(error));
    } finally {
      setWorkingId('');
    }
  }

  return <div className="page-stack">
    <PageHeading eyebrow="THIẾT BỊ CỦA BẠN" title="Camera" detail={user.role === 'owner' ? 'Thêm, xác minh và theo dõi trạng thái nguồn camera cục bộ.' : 'Các camera chủ nhà đã cấp quyền cho bạn.'} action={user.role === 'owner' ? <button className="primary-btn" onClick={() => setModal(true)}><Icon name="plus" size={18}/>Kết nối camera</button> : undefined}/>
    <div className={'api-inline-status ' + backendState} role="status">{backendState === 'connected' ? items.length + ' camera đã đồng bộ từ API cục bộ.' : backendState === 'offline' ? 'Không tải được danh sách camera.' : 'Đang đồng bộ camera…'}</div>
    <div className="toolbar"><label className="search-box"><Icon name="search"/><span className="sr-only">Tìm camera</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm tên hoặc khu vực…"/></label><label className="filter-label"><span className="sr-only">Lọc trạng thái</span><select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Tất cả trạng thái</option><option value="online">Trực tuyến</option><option value="offline">Chưa kiểm tra</option><option value="error">Lỗi kết nối</option><option value="disabled">Đã tắt</option></select></label><button className="secondary-btn" onClick={() => void loadCameras()}><Icon name="refresh" size={16}/>Làm mới</button></div>
    <section className="panel camera-list">{visible.length ? visible.map(camera => <article className="camera-row" key={camera.id}><span className="camera-thumb"><Icon name="camera" size={24}/></span><div className="camera-name"><h3>{camera.name}</h3><p>{camera.location || 'Chưa đặt khu vực'}</p><span className="mobile-only"><Badge state={cameraView(camera).state}/></span></div><div className="desktop-only"><Badge state={cameraView(camera).state}>{camera.state === 'error' ? 'Lỗi kết nối' : camera.state === 'disabled' ? 'Đã tắt' : undefined}</Badge></div><span className="camera-mode">{camera.recordingMode === 'continuous' ? 'Ghi liên tục' : camera.recordingMode === 'event' ? 'Theo sự kiện' : 'Chưa ghi'}<small>{camera.lastProbe ? camera.lastProbe.code + ' · ' + camera.lastProbe.latencyMs + ' ms' : 'Chưa kiểm tra nguồn'}</small></span><div className="row-actions">{user.role === 'owner' && <button className="icon-btn" disabled={workingId === camera.id} aria-label={'Kiểm tra ' + camera.name} onClick={() => void probe(camera)}><Icon name="refresh"/></button>}<button className="icon-btn" aria-label={'Chi tiết ' + camera.name} onClick={() => setDetail(camera)}><Icon name="arrow"/></button></div></article>) : <EmptyState title={backendState === 'checking' ? 'Đang tải camera' : query || filter !== 'all' ? 'Không tìm thấy camera' : 'Chưa có camera nào'} detail={query || filter !== 'all' ? 'Thử tên khác hoặc thay đổi bộ lọc.' : user.role === 'owner' ? 'Kết nối luồng RTSP đầu tiên để bắt đầu.' : 'Chủ nhà chưa cấp camera cho tài khoản này.'} action={user.role === 'owner' && !query && filter === 'all' ? <button className="primary-btn" onClick={() => setModal(true)}>Kết nối camera đầu tiên</button> : undefined}/>}</section>
    {modal && <AddCameraModal onClose={() => setModal(false)} onAdded={camera => { setItems(current => [...current, camera]); notify(camera.state === 'online' ? 'Camera đã kết nối và kiểm tra thành công.' : 'Đã lưu camera; kiểm tra nguồn chưa thành công.'); }}/>}
    {detail && <Modal title={detail.name} onClose={() => setDetail(null)}><LivePlayer camera={detail} notify={notify} muted={false}/><div className="capability-grid"><span className={detail.capabilities.audio ? 'active' : ''}><Icon name="volume" size={16}/>Audio</span><span className={detail.capabilities.ptz ? 'active' : ''}><Icon name="activity" size={16}/>PTZ</span><span className={detail.capabilities.talk ? 'active' : ''}><Icon name="bell" size={16}/>Đàm thoại</span><span className={detail.capabilities.substream ? 'active' : ''}><Icon name="camera" size={16}/>Luồng phụ</span></div>{detail.lastProbe && <p className="notice">Lần kiểm tra: {new Date(detail.lastProbe.at).toLocaleString('vi-VN')} · {detail.lastProbe.code} · {detail.lastProbe.latencyMs} ms.</p>}<div className="modal-footer">{user.role === 'owner' && <><button className="danger-btn" disabled={workingId === detail.id} onClick={() => void remove(detail)}>Xóa camera</button><button className='secondary-btn' disabled={workingId === detail.id} onClick={() => void setRecording(detail)}><Icon name={detail.recordingMode === 'continuous' ? 'pause' : 'record'} size={16}/>{detail.recordingMode === 'continuous' ? 'Dừng ghi liên tục' : 'Bật ghi liên tục'}</button><button className='primary-btn' disabled={workingId === detail.id} onClick={() => void probe(detail)}><Icon name='refresh' size={16}/>Kiểm tra lại</button></>}</div></Modal>}
  </div>;
}
