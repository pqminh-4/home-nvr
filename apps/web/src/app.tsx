import { useEffect, useRef, useState } from 'react';
import { CameraGrid } from './cameras';
import { CamerasPage } from './camera-management';
import { demoEvents, navigation, type View } from './demo';
import { Icon, Modal } from './ui';
import { EventsPage, RecordingsPage, SettingsPage, AlertsPage } from './pages';
import { AccessScreen } from './auth';
import { apiRequest, type SessionUser } from './api';

function readView(): View {
  return navigation.find(item => item.id === window.location.hash.slice(1))?.id ?? 'dashboard';
}
export function App() {
  const [view, setView] = useState<View>(readView);
  const [system, setSystem] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [access, setAccess] = useState<'loading' | 'setup' | 'login' | 'locked' | 'offline' | 'ready'>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [toast, setToast] = useState('');
  const [event, setEvent] = useState<(typeof demoEvents)[number] | null>(null);
  const main = useRef<HTMLElement>(null);
  const previousView = useRef(view);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 8000);
    void fetch('/api/v1/system/status', { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(() => { if (active) setSystem('ready'); })
      .catch(() => { if (active) setSystem('failed'); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, []);
  useEffect(() => {
    const navigate = () => setView(readView());
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  useEffect(() => {
    document.title = (navigation.find(item => item.id === view)?.label ?? 'Tổng quan') + ' · Home NVR';
    if (previousView.current !== view) {
      main.current?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
      previousView.current = view;
    }
  }, [view]);
  // Hiệu ứng giới thiệu chỉ chạy khi mở ứng dụng, không trì hoãn thao tác bàn phím.
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animations = [...(main.current?.querySelectorAll('.welcome-copy, .home-summary, .feeds-section') ?? [])].map((element, index) =>
      element.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 240, delay: index * 35, easing: 'cubic-bezier(.23,1,.32,1)' }));
    return () => animations.forEach(animation => animation.cancel());
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(''), 7000);
    return () => clearTimeout(timeout);
  }, [toast]);
  async function refreshAccess() {
    setAccess('loading');
    try {
      const status = await apiRequest<{ configured: boolean; setupAvailable: boolean; authenticated: boolean }>('/api/v1/auth/status');
      if (!status.configured) {
        setAccess(status.setupAvailable ? 'setup' : 'locked');
        setUser(null);
        return;
      }
      if (!status.authenticated) {
        setUser(null);
        setAccess('login');
        return;
      }
      try {
        const current = await apiRequest<SessionUser>('/api/v1/auth/me');
        setUser(current);
        setAccess('ready');
      } catch {
        setUser(null);
        setAccess('login');
      }
    } catch {
      setUser(null);
      setAccess('offline');
    }
  }
  useEffect(() => { void refreshAccess(); }, []);
  function notify(message: string) { setToast(message); }
  if (access === 'loading') return <main className="access-loading"><span className="brand-symbol"><Icon name="camera" size={23}/></span><span className="button-spinner"/><p>Đang mở Home NVR…</p></main>;
  if (access !== 'ready' || !user) return <AccessScreen mode={access === 'ready' ? 'login' : access} onRetry={() => void refreshAccess()} onAuthenticated={authenticated => { setUser(authenticated); setAccess('ready'); }}/>;

  async function logout() {
    try { await apiRequest<void>('/api/v1/auth/logout', { method: 'POST' }); }
    finally { setUser(null); setAccess('login'); }
  }
  const links = navigation.map(item => <a key={item.id} href={'#' + item.id} aria-current={view === item.id ? 'page' : undefined} aria-label={item.id === 'cameras' ? 'Camera' : undefined}><Icon name={item.icon} size={18}/><span>{item.label}</span></a>);
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={e => { e.preventDefault(); main.current?.focus(); }}>Đến nội dung chính</a>
    <header className="site-header">
      <a className="brand" href="#dashboard" aria-label="Home NVR — Tổng quan"><span className="brand-symbol"><Icon name="camera" size={23}/></span><span>home<span className="brand-light">nvr.</span></span></a>
      <nav className="desktop-nav" aria-label="Điều hướng chính">{links}</nav>      <div className="zone-tree" aria-label="Camera zones">
        <div className="zone-title"><span>CAMERA ZONES</span><small>8 ACTIVE</small></div>
        <div className="zone-group"><b>PERIMETER</b><button onClick={() => notify("Đã chọn Cổng trước")}>Cổng trước <small>2.4M</small></button><button onClick={() => notify("Đã chọn Sân sau")}>Sân sau <small>2.4M</small></button></div>
        <div className="zone-group"><b>GROUND FLOOR</b><button onClick={() => notify("Đã chọn Phòng khách")}>Phòng khách <small>4K</small></button><button onClick={() => notify("Đã chọn Bếp")}>Bếp <small>1080P</small></button></div>
      </div>
      <div className="header-tools"><a className="icon-btn" href="#alerts" aria-label="Xem cảnh báo"><Icon name="bell"/></a><a className="avatar" href="#settings" aria-label="Cài đặt cá nhân">{user.username.slice(0, 2).toUpperCase()}</a><button className="icon-btn logout-btn" aria-label="Đăng xuất" title="Đăng xuất" onClick={() => void logout()}><Icon name="logout"/></button></div>
    </header>
    <main id="main-content" ref={main} tabIndex={-1}>      <div className="telemetry-bar" aria-label="Trạng thái hệ thống"><span>CPU <b>24%</b> · 45°C</span><span>RAM <b>5.8GB / 16GB</b></span><span className="cyan">NPU <b>68% · 14ms</b></span><span>NVME <b>4.2 / 8.0 TB</b></span><span className="green">8/8 CAM · 30D RET</span></div>
      <div className="preview-banner"><Icon name="info" size={16}/><p><strong>Phần 7 đang hoạt động</strong> · Cloudflare Tunnel, bảo mật truy cập ngoài mạng và backup/restore đã nối vào nền tảng.</p><span className="preview-tag">{user.role === 'owner' ? 'OWNER' : 'GUEST'}</span></div>
      {system === 'failed' && <p role="status" className="api-error">API chưa sẵn sàng. Kiểm tra dịch vụ rồi tải lại trang; bạn vẫn có thể duyệt giao diện mẫu.</p>}
      {view === 'dashboard' && <div className="page-stack dashboard">
        <section className="welcome-row">
          <div className="welcome-copy"><span className="eyebrow"><span className="dot green"/> NHÀ CỦA TÔI / TỔNG QUAN</span><h1>Live Matrix</h1><p className="matrix-tagline">Một góc nhìn · trọn ngôi nhà · local core</p><p>Theo dõi không gian thân thuộc, từ bất cứ đâu bạn ở.</p><a className="primary-btn" href="#cameras"><Icon name="plus" size={18}/>Quản lý camera<Icon name="arrow" size={18}/></a></div>
          <aside className="home-summary"><div className="summary-heading"><span><Icon name="shield" size={20}/>Không gian của bạn</span><span className="summary-tag">MẪU</span></div><div className="summary-main"><strong>02<span>/ 04</span></strong><div><b>camera trực tuyến</b><p>1 kết nối lại · 1 mất kết nối</p></div></div><div className="summary-bottom"><span><span className="dot green"/>2 camera ghi hình mẫu</span><Icon name="camera" size={18}/></div></aside>
        </section>
        <CameraGrid notify={notify}/>
        <section className="overview-bottom">
          <div className="activity-panel panel"><div className="section-heading"><div><span className="eyebrow">NHỊP SỐNG NGÔI NHÀ</span><h2>Hoạt động gần đây</h2></div><a className="text-link" href="#events">Xem tất cả<Icon name="arrow" size={17}/></a></div><EventList onSelect={setEvent}/></div>
          <aside className="storage-summary panel"><span className="empty-icon"><Icon name="disk" size={22}/></span><span className="eyebrow">LƯU TRỮ · MINH HỌA</span><h2>Luôn có chỗ<br/>cho khoảnh khắc mới.</h2><div className="storage-value"><strong>320 <small>GB còn trống</small></strong><span>68% đã dùng</span></div><meter min="0" max="100" value="68" aria-label="Dung lượng đã dùng minh họa">68%</meter><p>680 GB / 1 TB · Số liệu mẫu</p><a href="#settings" className="text-link">Quản lý lưu trữ<Icon name="arrow" size={17}/></a></aside>
        </section>
      </div>}
      {view === 'cameras' && <CamerasPage notify={notify} user={user}/>}
      {view === 'recordings' && <RecordingsPage notify={notify} user={user}/>}
      {view === 'events' && <EventsPage notify={notify} user={user}/>}
      {view === 'alerts' && <AlertsPage notify={notify} user={user}/>}
      {view === 'settings' && <SettingsPage notify={notify} system={system} user={user}/>}
      <footer className="page-footer"><span><Icon name="shield" size={15}/> Riêng tư từ ngôi nhà của bạn.</span><span>{system === 'ready' ? 'API đã kết nối' : system === 'failed' ? 'API chưa sẵn sàng' : 'Đang kiểm tra API'} · Home NVR</span></footer>
    </main>
    <nav className="mobile-nav" aria-label="Điều hướng di động">{links}</nav>
    <div className="toast-region" aria-live="polite" aria-atomic="true">{toast && <div className="toast"><Icon name="info"/><p>{toast}</p><button className="icon-btn" aria-label="Đóng thông báo" onClick={() => setToast('')}><Icon name="close" size={18}/></button></div>}</div>
    {event && <Modal title={event.title} onClose={() => setEvent(null)}><div className="event-detail"><span className={'event-symbol ' + event.tone}><Icon name="activity" size={28}/></span><p className="mono">{event.time} · 05/09/2026</p><h3>{event.camera}</h3><p>{event.detail}</p><p className="notice">Sự kiện minh họa. Chưa có tệp ghi hình thật.</p><a className="primary-btn" href="#recordings" onClick={() => setEvent(null)}>Xem bản ghi mẫu<Icon name="arrow" size={17}/></a></div></Modal>}
  </div>;
}
export function EventList({ onSelect, events = demoEvents }: { onSelect: (event: (typeof demoEvents)[number]) => void; events?: typeof demoEvents }) {
  return <ol className="event-list">{events.map(event => <li key={event.id}><button className="event-button" onClick={() => onSelect(event)}><span className={'event-symbol ' + event.tone}><Icon name={event.tone === 'red' ? 'camera' : event.tone === 'green' ? 'check' : 'activity'} size={19}/></span><span><strong>{event.title}</strong><span className="event-camera">{event.camera} · mẫu</span></span><time className="mono">{event.time}</time><Icon name="arrow" size={16}/></button></li>)}</ol>;
}
