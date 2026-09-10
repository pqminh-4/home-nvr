import { useEffect, useRef, useState } from 'react';
import { Badge, EmptyState, Icon, Modal, PageHeading } from './ui';
import { demoCameras, stateLabels, type DemoCamera, type DemoState } from './demo';
import { apiRequest, type ApiCamera } from './api';
import { LivePlayer } from './live';

// Ảnh sơ đồ chỉ minh họa khung hình; không tạo yêu cầu RTSP hoặc giả lập video thật.
function CameraIllustration({ outdoor }: { outdoor: boolean }) {
  return <svg className="camera-illustration" aria-hidden="true" viewBox="0 0 600 340" preserveAspectRatio="xMidYMid slice"><rect width="600" height="340" fill="#c9cfbd" />{outdoor ? <><path d="M0 240 300 160 600 240V340H0Z" fill="#b3bf91"/><path d="M0 130 180 120 260 185 0 240Z" fill="#829b66"/><path d="M370 120h185v145H370Z" fill="#ddd0b6"/><path d="m350 120 105-72 110 72" fill="#968873"/><path d="M420 160h72v105h-72Z" fill="#57694d"/><path d="M175 340 365 206h90L360 340Z" fill="#b9ac93"/><path d="M40 130V250M70 130V245M100 130V235M130 130V227M30 180H155" stroke="#777154" strokeWidth="7"/><circle cx="80" cy="85" r="60" fill="#718c54"/><path d="M82 120v77" stroke="#596a45" strokeWidth="12"/></> : <><path d="M0 0h600v250L300 200 0 250Z" fill="#d8d4bf"/><path d="M0 250 300 200 600 250v90H0Z" fill="#aa9b7e"/><path d="M80 60h128v122H80Z" fill="#9bb3a3" stroke="#f4eee0" strokeWidth="8"/><path d="M144 60v122M80 120h128" stroke="#f4eee0" strokeWidth="5"/><path d="M348 155h162v62H348Z" fill="#6e8466"/><path d="M330 195h198v61H330Z" fill="#859577"/><path d="M330 256v18M520 256v18" stroke="#1b2931" strokeWidth="10"/><ellipse cx="274" cy="277" rx="112" ry="31" fill="#c2b28f"/><path d="M220 229h119v29H220Z" fill="#725c43"/><path d="M230 257v20M329 257v20" stroke="#3b5158" strokeWidth="8"/><path d="M559 153v-55M560 117l-22-19M560 139l27-24" stroke="#477565" strokeWidth="8"/><path d="M540 156h40l-7 49h-27Z" fill="#68706b"/></>}<rect width="600" height="340" fill="#564735" opacity=".18" /></svg>;
}

export function CameraFeed({ camera, notify, large = false, aiBoxes = true }: { camera: DemoCamera; notify: (text: string) => void; large?: boolean; aiBoxes?: boolean }) {
  const [muted, setMuted] = useState(true);
  const [state, setState] = useState(camera.state);
  useEffect(() => setState(camera.state), [camera.state]);
  useEffect(() => setState(camera.state), [camera.state]);
  const frame = useRef<HTMLElement>(null);
  const online = state === 'online';
  async function fullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await frame.current?.requestFullscreen(); }
    catch { notify('Trình duyệt không cho phép mở toàn màn hình.'); }
  }
  return <article ref={frame} className={'feed-card ' + (large ? 'large-feed' : '')} aria-label={'Camera ' + camera.name}>
    <div className={'feed-visual ' + state}>
      {online && <CameraIllustration outdoor={camera.id !== 'living'} />}{aiBoxes && <div className="ai-overlay" aria-label="AI bounding box minh họa"><span className="ai-bracket"/><span className="ai-label">PERSON · 98%</span></div>}
      <div className="feed-top"><span className={'feed-label ' + (online ? 'cyan' : 'amber')}><span className="dot" />{online ? 'KHUNG HÌNH MẪU' : stateLabels[state]}</span><span className="feed-resolution mono">{camera.resolution}</span></div>
      {!online && <div className={'feed-message ' + (state === 'loading' ? 'skeleton' : '')}><Icon name={state === 'denied' ? 'lock' : state === 'offline' ? 'camera' : 'refresh'} size={30} /><strong>{stateLabels[state]}</strong><p>{state === 'denied' ? 'Ví dụ trạng thái khi chưa được cấp quyền xem.' : 'Trạng thái minh họa để duyệt giao diện.'}</p>{state === 'offline' && <button className="secondary-btn" onClick={() => setState('reconnecting')}><Icon name="refresh" size={16}/>Thử lại minh họa</button>}</div>}
      <div className="feed-timestamp"><span>05/09/2026 · 14:32:45</span><span>{camera.bitrate}</span></div>
    </div>
    <div className="feed-info"><div><h3>{camera.name}</h3><p>{camera.location}</p></div><Badge state={state} /></div>
    <div className="feed-controls"><span className="recording-indicator">{camera.recording ? <><span className="dot"/>Ghi liên tục · mẫu</> : 'Chưa ghi · mẫu'}</span><button className="icon-btn" aria-label={(muted ? 'Bật' : 'Tắt') + ' tiếng minh họa ' + camera.name} aria-pressed={!muted} onClick={() => { setMuted(!muted); notify('Đã đổi trạng thái nút âm thanh minh họa; chưa có luồng audio.'); }}><Icon name={muted ? 'mute' : 'volume'} size={18}/></button><button className="icon-btn" aria-label={'Chụp ảnh ' + camera.name} onClick={() => notify('Chụp ảnh sẽ khả dụng khi có luồng camera thật ở Phần 4.')}><Icon name="snapshot" size={18}/></button><button className="icon-btn" aria-label={'Toàn màn hình ' + camera.name} onClick={() => void fullscreen()}><Icon name="fullscreen" size={18}/></button></div>
  </article>;
}

export function AddCameraModal({ onClose, onAdd }: { onClose: () => void; onAdd: (camera: DemoCamera) => void }) {
  const [tab, setTab] = useState<'rtsp' | 'onvif'>('rtsp');
  const [error, setError] = useState('');
  const [discovery, setDiscovery] = useState(false);
  return <Modal title="Thêm camera minh họa" onClose={onClose}><p className="notice">Biểu mẫu chỉ để duyệt giao diện. Không nhập thông tin camera thật; dữ liệu không gửi tới API và không lưu sau khi tải lại.</p><div className="segmented" aria-label="Phương thức thêm"><button aria-pressed={tab === 'rtsp'} onClick={() => setTab('rtsp')}>Thủ công · RTSP</button><button aria-pressed={tab === 'onvif'} onClick={() => setTab('onvif')}>Tự động · ONVIF</button></div>{tab === 'rtsp' ? <form onSubmit={event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name') ?? '').trim();
    const source = String(data.get('source') ?? '');
    try { const url = new URL(source); if (!['rtsp:', 'rtsps:'].includes(url.protocol) || !url.hostname) throw new Error(); }
    catch { setError('Địa chỉ cần bắt đầu bằng rtsp:// hoặc rtsps:// và có tên máy.'); return; }
    if (!name) { setError('Vui lòng nhập tên camera.'); return; }
    onAdd({ id: crypto.randomUUID(), name, location: 'Camera mới · minh họa', state: 'loading', recording: false, bitrate: '—', resolution: '1080p' }); onClose();
  }}><label className="form-field">Tên camera<input name="name" required maxLength={120} placeholder="Ví dụ: Ban công" autoComplete="off" /></label><label className="form-field">Địa chỉ RTSP mẫu<input name="source" required placeholder="rtsp://camera.example/stream" aria-invalid={!!error} aria-describedby={error ? 'source-error' : undefined} autoComplete="off" /></label>{error && <p id="source-error" className="inline-error" role="alert">{error}</p>}<div className="modal-footer"><button type="button" className="secondary-btn" onClick={onClose}>Hủy</button><button className="primary-btn" type="submit">Thêm vào bản xem trước</button></div></form> : <div className="discovery"><Icon name="search" size={32}/><h3>Tìm camera trong mạng</h3><p>ONVIF discovery được tích hợp ở Phần 3. Hiện chưa thực hiện quét mạng.</p><button className="secondary-btn" onClick={() => setDiscovery(true)}>Xem trạng thái tìm kiếm</button>{discovery && <p role="status" className="notice">Chưa kết nối dịch vụ ONVIF. Không có thiết bị thật được tìm thấy.</p>}</div>}</Modal>;
}

export function CamerasPage({ notify }: { notify: (text: string) => void }) {
  const [items, setItems] = useState(demoCameras);
  const [backendState, setBackendState] = useState<'checking' | 'connected' | 'guest' | 'offline'>('checking');
  // Tải camera thật khi có session; nếu chưa đăng nhập vẫn giữ dữ liệu preview an toàn.
  useEffect(() => { let active = true; void fetch('/api/v1/cameras', { credentials: 'same-origin' }).then(async response => { if (response.status === 401) { if (active) setBackendState('guest'); return; } if (!response.ok) throw new Error(); const data = await response.json(); if (active && data.length) { setItems(data.map((camera: any) => ({ id: camera.id, name: camera.name, location: camera.location, state: camera.state === 'disabled' ? 'offline' : camera.state, recording: camera.recordingMode === 'continuous', bitrate: 'API', resolution: '—' }))); setBackendState('connected'); } else if (active) setBackendState('connected'); }).catch(() => { if (active) setBackendState('offline'); }); return () => { active = false; }; }, []);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [empty, setEmpty] = useState(false);
  const [modal, setModal] = useState(false);
  const [detail, setDetail] = useState<DemoCamera | null>(null);
  const visible = (empty ? [] : items).filter(item => (filter === 'all' || filter === item.state) && (item.name + item.location).toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi')));
  return <div className="page-stack"><PageHeading eyebrow="THIẾT BỊ CỦA BẠN" title="Camera" detail="Một nơi cho mọi góc nhìn trong ngôi nhà." action={<button className="primary-btn" onClick={() => setModal(true)}><Icon name="plus" size={18}/>Thêm camera</button>}/><div className="api-inline-status" role="status">{backendState === 'connected' ? 'Đã đồng bộ camera từ API cục bộ.' : backendState === 'guest' ? 'Chưa đăng nhập · đang hiển thị dữ liệu mẫu.' : backendState === 'offline' ? 'API camera chưa sẵn sàng · đang hiển thị dữ liệu mẫu.' : 'Đang kiểm tra API camera…'}</div><div className="toolbar"><label className="search-box"><Icon name="search"/><span className="sr-only">Tìm camera</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm tên hoặc khu vực…"/></label><label className="filter-label"><span className="sr-only">Lọc trạng thái</span><select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Tất cả trạng thái</option><option value="online">Trực tuyến</option><option value="offline">Mất kết nối</option><option value="reconnecting">Kết nối lại</option></select></label><button className="secondary-btn" aria-pressed={empty} onClick={() => setEmpty(!empty)}>{empty ? 'Hiện dữ liệu mẫu' : 'Xem trạng thái trống'}</button></div><section className="panel camera-list">{visible.length ? visible.map(camera => <article className="camera-row" key={camera.id}><span className="camera-thumb"><Icon name="camera" size={24}/></span><div className="camera-name"><h3>{camera.name}</h3><p>{camera.location}</p><span className="mobile-only"><Badge state={camera.state}/></span></div><div className="desktop-only"><Badge state={camera.state}/></div><span className="camera-mode">{camera.recording ? 'Ghi liên tục' : 'Không ghi'}<small>{camera.resolution} · mẫu</small></span><button className="icon-btn" aria-label={'Chi tiết ' + camera.name} onClick={() => setDetail(camera)}><Icon name="arrow"/></button></article>) : <EmptyState title={empty ? 'Chưa có camera nào' : 'Không tìm thấy camera'} detail={empty ? 'Bắt đầu với một camera để xem trước quy trình thiết lập.' : 'Thử tên khác hoặc thay đổi bộ lọc.'} action={<button className="primary-btn" onClick={() => empty ? setModal(true) : (setFilter('all'), setQuery(''))}>{empty ? 'Thêm camera đầu tiên' : 'Xóa bộ lọc'}</button>}/>}</section>{modal && <AddCameraModal onClose={() => setModal(false)} onAdd={camera => { setItems(current => [...current, camera]); setEmpty(false); setQuery(''); setFilter('all'); notify('Đã thêm camera minh họa trong phiên xem trước.'); }}/ >}{detail && <Modal title={detail.name} onClose={() => setDetail(null)}><CameraFeed camera={detail} notify={notify}/><p className="notice">Cấu hình nguồn, PTZ và quyền truy cập được kết nối với backend ở các phần sau.</p></Modal>}</div>;
}

export function CameraGrid({ notify }: { notify: (text: string) => void }) {
  const [selected, setSelected] = useState(demoCameras[0]!);
  const [layout, setLayout] = useState(4);
  const [scenario, setScenario] = useState<DemoState | 'default'>('default');
  const [guard, setGuard] = useState('Night Guard');
  const [aiBoxes, setAiBoxes] = useState(true);
  const [muted, setMuted] = useState(false);
  const [realCameras, setRealCameras] = useState<ApiCamera[]>([]);
  useEffect(() => { let active = true; void apiRequest<ApiCamera[]>('/api/v1/cameras').then(data => { if (active) setRealCameras(data); }).catch(() => undefined); return () => { active = false; }; }, []);
  const selectedCamera = scenario === 'default' ? selected : { ...selected, state: scenario };
  function chooseGuard(mode: string) { setGuard(mode); notify('Đã đổi Guard Mode sang ' + mode + ' trong phiên xem trước.'); }
  return <section className="feeds-section">
    <div className="matrix-header"><div><span className="eyebrow">LIVE MATRIX · LOCAL CORE ONLINE</span><h2>Live Matrix</h2><p>{realCameras.length ? realCameras.length + " camera thật · WebRTC ưu tiên · LL-HLS dự phòng" : "8 kênh mẫu · mã hóa nội bộ · 30D RET"}</p></div><div className="matrix-header-actions"><div className="guard-mode" aria-label="Guard Mode">{['Home','Away','Night Guard'].map(mode => <button key={mode} aria-pressed={guard === mode} onClick={() => chooseGuard(mode)}>{mode}</button>)}</div><div className="segmented grid-picker" aria-label="Bố cục camera">{[1,4,9].map(count => <button key={count} aria-label={'Bố cục ' + count + ' ô'} aria-pressed={layout === count} onClick={() => setLayout(count)}>{count}</button>)}</div></div></div>
    <div className="matrix-tools"><span className="camera-zone-label">Camera Zones · 8 active</span><div className="matrix-switches"><button aria-pressed={aiBoxes} onClick={() => { setAiBoxes(!aiBoxes); notify(aiBoxes ? 'Đã ẩn AI Bounding Boxes.' : 'Đã bật AI Bounding Boxes minh họa.'); }}><span className={'switch-dot ' + (aiBoxes ? 'on' : '')}/><Icon name="activity" size={15}/>AI Bounding Boxes</button><button aria-pressed={muted} onClick={() => { setMuted(!muted); notify(muted ? 'Đã bật âm thanh mẫu.' : 'Đã tắt toàn bộ âm thanh mẫu.'); }}><span className={'switch-dot ' + (!muted ? 'on' : '')}/><Icon name={muted ? 'mute' : 'volume'} size={15}/>Mute All</button></div></div>
    <div className="camera-rail" aria-label="Chọn camera">{(realCameras.length ? realCameras : demoCameras).map(camera => <button key={camera.id} aria-pressed={selected.id === camera.id} onClick={() => { if (!realCameras.length) setSelected(camera as DemoCamera); }}><Icon name="camera" size={17}/><span>{camera.name}</span><span className={'rail-dot ' + ('state' in camera ? camera.state : 'offline')}/></button>)}</div>
    <div className="desktop-feeds" data-layout={layout}>{realCameras.length ? (layout === 1 ? realCameras.slice(0, 1) : realCameras.slice(0, layout)).map(camera => <LivePlayer key={camera.id} camera={camera} notify={notify} muted={muted} compact/>) : ((layout === 1 ? [selectedCamera] : demoCameras).map(camera => <CameraFeed key={camera.id + camera.state} camera={camera} notify={notify} aiBoxes={aiBoxes}/>))}{!realCameras.length && layout === 9 && Array.from({ length: 5 }, (_, index) => <div className="vacant-feed" key={index}><Icon name="plus"/><span>Ô camera trống</span></div>)}</div>
    <div className="mobile-feed">{realCameras.length ? <LivePlayer camera={realCameras[0]!} notify={notify} muted={muted}/> : <CameraFeed key={selectedCamera.id + selectedCamera.state} camera={selectedCamera} notify={notify} aiBoxes={aiBoxes}/>}</div>
    <div className="ai-event-strip"><span className="eyebrow"><span className="dot cyan"/> RECENT AI DETECTION EVENTS</span><button onClick={() => notify('Đã mở nhanh Playback & Timeline cho event AI gần nhất.')}>14:28 · PERSON · Cổng trước <Icon name="arrow" size={14}/></button><button onClick={() => notify('Đã chọn event mẫu lúc 13:42.')}>13:42 · MOTION · Phòng khách <Icon name="arrow" size={14}/></button></div>
    <label className="scenario-picker">Xem trạng thái giao diện<select value={scenario} onChange={event => setScenario(event.target.value as DemoState | 'default')}><option value="default">Theo dữ liệu mẫu</option><option value="loading">Đang tải</option><option value="denied">Không có quyền</option><option value="offline">Mất kết nối</option></select><small>Áp dụng cho camera chọn ở chế độ 1 ô / di động.</small></label>
  </section>;
}
