import { useEffect, useState } from 'react';
import { demoCameras } from './demo';
import { Badge, EmptyState, Icon, PageHeading } from './ui';
import { CameraFeed } from './cameras';
import { AccessManager } from './access-management';
import { apiRequest, type ApiCamera, type ApiEvent, type ApiEventRule, type ApiSettings, type ApiRemoteStatus, type ApiCloudflareDnsPlan, type SessionUser } from './api';

type ApiRecording = { id: string; cameraId: string; startAt: string; endAt: string | null; state: 'ready' | 'writing' | 'failed' | 'deleting'; bytes: number };
type ExportResponse = { id: string; endpoint: string; expiresAt: string; bytes: number };

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}
function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(1) + ' GB';
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

function DemoRecordingsPage({ notify }: { notify: (text: string) => void }) {
  const [playing, setPlaying] = useState(false);
  const [minute, setMinute] = useState(868);
  const camera = demoCameras[0]!;
  return <div className="page-stack"><PageHeading eyebrow="DÒNG THỜI GIAN" title="Bản ghi" detail="Tìm lại khoảnh khắc trong ngày của bạn." action={<button className="secondary-btn" onClick={() => notify('Tải xuống sẽ khả dụng khi có bản ghi thật.')}><Icon name="arrow" size={17}/>Xuất đoạn mẫu</button>}/><section className="playback-layout"><div><div className="playback-stage"><CameraFeed camera={camera} notify={notify} large/><div className="playback-overlay"><span className="feed-label cyan"><span className="dot"/>BẢN GHI MẪU</span><span className="mono">05/09/2026 · {String(Math.floor(minute / 60)).padStart(2,'0')}:{String(minute % 60).padStart(2,'0')}</span></div><button className="play-toggle" aria-label={playing ? 'Tạm dừng bản ghi mẫu' : 'Phát bản ghi mẫu'} aria-pressed={playing} onClick={() => setPlaying(!playing)}><Icon name={playing ? 'pause' : 'play'} size={22}/></button></div><div className="timeline panel"><div className="timeline-head"><strong>Hôm nay, 05 tháng 09</strong><span className="mono">{playing ? 'ĐANG PHÁT MÔ PHỎNG' : 'CHỌN THỜI ĐIỂM'}</span></div><input type="range" min="0" max="1439" value={minute} onChange={event => setMinute(Number(event.target.value))} aria-label="Chọn thời điểm bản ghi minh họa"/><div className="timeline-scale"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div><div className="timeline-events"><span style={{left:'59%'}} title="Sự kiện mẫu: 14:10"/><span style={{left:'61%'}} title="Sự kiện mẫu: 14:28"/></div></div></div><aside className="side-card panel"><div className="section-heading"><div><span className="eyebrow">BỘ LỌC</span><h2>Camera</h2></div><Icon name="chevron" size={18}/></div><div className="recording-camera active"><span className="camera-thumb"><Icon name="camera"/></span><span><strong>{camera.name}</strong><small>Ghi liên tục · mẫu</small></span><Badge state="recording"/></div>{demoCameras.slice(1).map(item => <div className="recording-camera" key={item.id}><span className="camera-thumb"><Icon name="camera"/></span><span><strong>{item.name}</strong><small>{item.recording ? 'Ghi liên tục' : 'Chưa ghi'} · mẫu</small></span><span className={'rail-dot ' + item.state}/></div>)}<div className="notice">Chưa có bản ghi thật. Kết nối camera và bật ghi liên tục để bắt đầu.</div></aside></section></div>;
}

export function RecordingsPage({ notify, user }: { notify: (text: string) => void; user: SessionUser }) {
  const [cameras, setCameras] = useState<ApiCamera[]>([]);
  const [records, setRecords] = useState<ApiRecording[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (user.role !== 'owner') { setLoading(false); return; }
    void Promise.all([apiRequest<ApiCamera[]>('/api/v1/cameras'), apiRequest<ApiRecording[]>('/api/v1/recordings?limit=100')]).then(([cameraItems, recordingItems]) => {
      setCameras(cameraItems); setRecords(recordingItems); setSelectedCameraId(recordingItems[0]?.cameraId ?? cameraItems[0]?.id ?? ''); setSelectedId(recordingItems[0]?.id ?? '');
    }).catch(() => setError('Không tải được kho bản ghi.')).finally(() => setLoading(false));
  }, [user.role]);
  if (user.role !== 'owner') return <div className="page-stack"><PageHeading eyebrow="DÒNG THỜI GIAN" title="Bản ghi" detail="Kho bản ghi chỉ dành cho tài khoản chủ nhà."/><section className="panel"><EmptyState title="Bạn chưa có quyền xem bản ghi" detail="Tài khoản khách chỉ có thể xem trực tiếp các camera được cấp."/></section></div>;
  if (!loading && !records.length) return <DemoRecordingsPage notify={notify}/>;
  const visible = records.filter(item => !selectedCameraId || item.cameraId === selectedCameraId);
  const selected = visible.find(item => item.id === selectedId) ?? visible[0];
  async function exportSelected() {
    if (!selected) return;
    try {
      const result = await apiRequest<ExportResponse>('/api/v1/recordings/export', { method: 'POST', body: JSON.stringify({ recordingIds: [selected.id] }) });
      const link = document.createElement('a'); link.href = result.endpoint + '/' + selected.id + '.mp4'; link.download = selected.id + '.mp4'; document.body.append(link); link.click(); link.remove(); notify('Đã chuẩn bị tệp xuất ' + formatBytes(result.bytes) + '.');
    } catch { notify('Không thể xuất bản ghi đã chọn.'); }
  }
  return <div className="page-stack"><PageHeading eyebrow="DÒNG THỜI GIAN · PHẦN 5" title="Bản ghi" detail="Tìm, phát lại và xuất các đoạn ghi hình cục bộ." action={<button className="secondary-btn" disabled={!selected} onClick={() => void exportSelected()}><Icon name="arrow" size={17}/>Xuất đoạn</button>}/>{error && <p className="api-error" role="alert">{error}</p>}<section className="playback-layout"><div>{selected ? <><div className="playback-stage recording-real-stage"><video key={selected.id} controls preload="metadata" src={'/api/v1/recordings/' + selected.id + '/playback'} aria-label="Phát lại bản ghi"/><div className="playback-overlay"><span className="feed-label cyan"><span className="dot"/>BẢN GHI · READY</span><span className="mono">{formatTime(selected.startAt)} — {selected.endAt ? formatTime(selected.endAt) : 'ĐANG GHI'}</span></div></div><div className="timeline panel"><div className="timeline-head"><strong>{new Date(selected.startAt).toLocaleDateString('vi-VN', { day: '2-digit', month: 'long', year: 'numeric' })}</strong><span className="mono">{formatBytes(selected.bytes)} · fMP4</span></div><input type="range" min="0" max={Math.max(0, visible.length - 1)} value={Math.max(0, visible.findIndex(item => item.id === selected.id))} onChange={event => setSelectedId(visible[Number(event.target.value)]?.id ?? selected.id)} aria-label="Chọn đoạn bản ghi"/><div className="timeline-scale"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div><div className="timeline-events"><span style={{left:'38%'}} title="Đoạn ghi đã lưu"/></div></div></> : <div className="panel empty-inline">Chưa chọn đoạn bản ghi.</div>}</div><aside className="side-card panel"><div className="section-heading"><div><span className="eyebrow">BỘ LỌC · LOCAL</span><h2>Camera</h2></div><Icon name="chevron" size={18}/></div>{cameras.map(camera => <button className={'recording-camera ' + (selectedCameraId === camera.id ? 'active' : '')} key={camera.id} onClick={() => { setSelectedCameraId(camera.id); setSelectedId(records.find(item => item.cameraId === camera.id)?.id ?? ''); }}><span className="camera-thumb"><Icon name="camera"/></span><span><strong>{camera.name}</strong><small>{records.filter(item => item.cameraId === camera.id).length} đoạn · {camera.recordingMode === 'continuous' ? 'Ghi liên tục' : 'Theo sự kiện'}</small></span><span className="rail-dot online"/></button>)}<div className="notice">Retention được áp dụng tự động theo cấu hình hệ thống. Tệp đang ghi sẽ chỉ xuất hiện sau khi segment hoàn tất.</div></aside></section></div>;
}
export function EventsPage({ notify, user }: { notify: (text: string) => void; user: SessionUser }) {
  const [events, setEvents] = useState<ApiEvent[]>([]); const [cameras, setCameras] = useState<ApiCamera[]>([]); const [filter, setFilter] = useState('all'); const [query, setQuery] = useState('');
  useEffect(() => { if (user.role !== 'owner') return; void Promise.all([apiRequest<ApiEvent[]>('/api/v1/events'), apiRequest<ApiCamera[]>('/api/v1/cameras')]).then(([items, cameraItems]) => { setEvents(items); setCameras(cameraItems); }).catch(() => notify('Không tải được nhật ký sự kiện.')); }, [user.role]);
  if (user.role !== 'owner') return <div className="page-stack"><PageHeading eyebrow="NHẬT KÝ NGÔI NHÀ" title="Sự kiện" detail="Nhật ký sự kiện chỉ dành cho tài khoản chủ nhà."/><section className="panel"><EmptyState title="Bạn chưa có quyền xem sự kiện" detail="Tài khoản khách vẫn có thể xem live camera được cấp."/></section></div>;
  const cameraName = (id: string) => cameras.find(camera => camera.id === id)?.name ?? 'Camera';
  const visible = events.filter(item => (filter === 'all' || item.type === filter) && (cameraName(item.cameraId) + item.type).toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi')));
  return <div className="page-stack"><PageHeading eyebrow="NHẬT KÝ NGÔI NHÀ · PHẦN 6" title="Sự kiện" detail="Tín hiệu chuyển động được gộp thành những khoảng thời gian dễ xem lại." action={<label className="search-box compact-search"><Icon name="search"/><span className="sr-only">Tìm sự kiện</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm theo camera…"/></label>}/><section className="panel events-page"><div className="event-filters"><button className={'filter-chip ' + (filter === 'all' ? 'active' : '')} onClick={() => setFilter('all')}>Tất cả <span>{events.length}</span></button><button className={'filter-chip ' + (filter === 'motion' ? 'active' : '')} onClick={() => setFilter('motion')}>Chuyển động <span>{events.filter(item => item.type === 'motion').length}</span></button><button className={'filter-chip ' + (filter === 'camera-offline' ? 'active' : '')} onClick={() => setFilter('camera-offline')}>Mất kết nối</button></div>{visible.length ? <ol className="event-list">{visible.map(item => <li key={item.id}><a className="event-button" href={item.recordingIds.length ? '#recordings' : '#events'} onClick={() => !item.recordingIds.length && notify('Sự kiện này chưa có segment sẵn sàng.')}><span className="event-symbol cyan"><Icon name="activity" size={19}/></span><span><strong>{item.type === 'motion' ? 'Phát hiện chuyển động' : item.type === 'camera-offline' ? 'Camera mất kết nối' : 'Camera trực tuyến'}</strong><span className="event-camera">{cameraName(item.cameraId)} · {item.confidence === null ? 'hệ thống' : Math.round(item.confidence * 100) + '% tin cậy'}</span></span><time className="mono">{new Date(item.startAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</time><Icon name="arrow" size={16}/></a></li>)}</ol> : <EmptyState title="Chưa có sự kiện phù hợp" detail="Bật rule chuyển động trong Cảnh báo hoặc thay đổi bộ lọc."/>}</section></div>;
}
export function AlertsPage({ notify, user }: { notify: (text: string) => void; user: SessionUser }) {
  const [cameras, setCameras] = useState<ApiCamera[]>([]); const [cameraId, setCameraId] = useState(''); const [rule, setRule] = useState<ApiEventRule | null>(null); const [webhookUrl, setWebhookUrl] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (user.role !== 'owner') return; void apiRequest<ApiCamera[]>('/api/v1/cameras').then(items => { setCameras(items); setCameraId(items[0]?.id ?? ''); }); }, [user.role]);
  useEffect(() => { if (!cameraId) return; void apiRequest<ApiEventRule>('/api/v1/cameras/' + cameraId + '/event-rule').then(setRule).catch(() => notify('Không tải được rule chuyển động.')); }, [cameraId]);
  async function save() { if (!rule || !cameraId) return; setBusy(true); try { const payload: Record<string, unknown> = { ...rule, webhookEnabled: undefined }; if (webhookUrl) payload.webhookUrl = webhookUrl; setRule(await apiRequest<ApiEventRule>('/api/v1/cameras/' + cameraId + '/event-rule', { method: 'PATCH', body: JSON.stringify(payload) })); setWebhookUrl(''); notify('Đã lưu rule chuyển động và lịch hoạt động.'); } catch { notify('Không thể lưu rule chuyển động.'); } finally { setBusy(false); } }
  if (user.role !== 'owner') return <div className="page-stack"><PageHeading eyebrow="LUÔN ĐỂ Ý" title="Cảnh báo" detail="Chỉ chủ nhà có thể cấu hình phát hiện chuyển động."/></div>;
  return <div className="page-stack"><PageHeading eyebrow="LUÔN ĐỂ Ý · PHẦN 6" title="Cảnh báo" detail="Điều chỉnh chuyển động, vùng thời gian và webhook cho từng camera." action={<button className="primary-btn" disabled={!rule || busy} onClick={() => void save()}><Icon name="check" size={18}/>{busy ? 'Đang lưu…' : 'Lưu rule'}</button>}/><section className="settings-grid"><div className="panel settings-card"><div className="section-heading"><div><span className="eyebrow">MOTION RULE</span><h2>Phát hiện</h2></div><Icon name="activity"/></div><label className="form-field">Camera<select value={cameraId} onChange={event => setCameraId(event.target.value)}>{cameras.map(camera => <option key={camera.id} value={camera.id}>{camera.name}</option>)}</select></label>{rule && <><label className="toggle-row"><span><strong>Bật phát hiện chuyển động</strong><small>Chỉ tạo sự kiện trong lịch đã chọn.</small></span><input type="checkbox" checked={rule.enabled} onChange={event => setRule({ ...rule, enabled: event.target.checked })}/><span className="toggle-ui"/></label><label className="form-field">Độ nhạy · {rule.sensitivity}%<input type="range" min="1" max="100" value={rule.sensitivity} onChange={event => setRule({ ...rule, sensitivity: Number(event.target.value) })}/></label><div className="form-pair"><label className="form-field">Pre-buffer<select value={rule.preSeconds} onChange={event => setRule({ ...rule, preSeconds: Number(event.target.value) })}><option value="5">5 giây</option><option value="10">10 giây</option><option value="30">30 giây</option></select></label><label className="form-field">Post-buffer<select value={rule.postSeconds} onChange={event => setRule({ ...rule, postSeconds: Number(event.target.value) })}><option value="10">10 giây</option><option value="20">20 giây</option><option value="60">60 giây</option></select></label></div></>}</div><div className="panel settings-card"><div className="section-heading"><div><span className="eyebrow">LỊCH & WEBHOOK</span><h2>Tự động hóa</h2></div><Icon name="bell"/></div>{rule && <><div className="event-filters" aria-label="Ngày hoạt động">{['CN','T2','T3','T4','T5','T6','T7'].map((label, day) => <button type="button" key={label} className={'filter-chip ' + (rule.schedule.days.includes(day) ? 'active' : '')} onClick={() => { const days = rule.schedule.days.includes(day) ? rule.schedule.days.filter(item => item !== day) : [...rule.schedule.days, day].sort(); if (days.length) setRule({ ...rule, schedule: { ...rule.schedule, days } }); }}>{label}</button>)}</div><div className="form-pair"><label className="form-field">Bắt đầu<input type="time" value={rule.schedule.start} onChange={event => setRule({ ...rule, schedule: { ...rule.schedule, start: event.target.value } })}/></label><label className="form-field">Kết thúc<input type="time" value={rule.schedule.end === '24:00' ? '23:59' : rule.schedule.end} onChange={event => setRule({ ...rule, schedule: { ...rule.schedule, end: event.target.value } })}/></label></div><label className="form-field">Webhook URL<input type="url" value={webhookUrl} onChange={event => setWebhookUrl(event.target.value)} placeholder={rule.webhookEnabled ? 'Webhook đang được mã hóa · nhập URL để thay' : 'https://example.com/home-nvr'}/></label><p className="notice">Webhook thất bại được retry theo exponential backoff, tối đa 5 lần. URL không được trả lại trình duyệt.</p></>}</div></section></div>;
}
export function SettingsPage({ notify, system, user }: { notify: (text: string) => void; system: 'loading' | 'ready' | 'failed'; user: SessionUser }) {
  const [tab, setTab] = useState<'general' | 'storage' | 'remote' | 'access'>('general');
  const [settings, setSettings] = useState<ApiSettings | null>(null);
  const [remote, setRemote] = useState<ApiRemoteStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [dnsBusy, setDnsBusy] = useState(false);
  const [dnsZone, setDnsZone] = useState('');
  const [dnsHostname, setDnsHostname] = useState('');
  const [dnsTarget, setDnsTarget] = useState('');
  const [dnsToken, setDnsToken] = useState('');
  const [dnsProxied, setDnsProxied] = useState(false);
  const [dnsPlan, setDnsPlan] = useState<ApiCloudflareDnsPlan | null>(null);

  const refreshRemote = () => apiRequest<ApiRemoteStatus>('/api/v1/remote/status').then(setRemote).catch(() => setRemote(null));
  useEffect(() => {
    if (user.role !== 'owner') return;
    void apiRequest<ApiSettings>('/api/v1/settings').then(setSettings).catch(() => notify('Không tải được cài đặt hệ thống.'));
    void refreshRemote();
  }, [user.role]);

  async function save() {
    if (!settings) return;
    setBusy(true);
    try {
      setSettings(await apiRequest<ApiSettings>('/api/v1/settings', { method: 'PATCH', body: JSON.stringify(settings) }));
      await refreshRemote();
      notify('Đã lưu cài đặt hệ thống.');
    } catch { notify('Không thể lưu cài đặt hệ thống.'); }
    finally { setBusy(false); }
  }

  const dnsPayload = () => ({ zoneName: dnsZone.trim(), hostname: dnsHostname.trim(), tunnelTarget: dnsTarget.trim(), proxied: dnsProxied, apiToken: dnsToken });
  async function previewDns() {
    setDnsBusy(true);
    try {
      setDnsPlan(await apiRequest<ApiCloudflareDnsPlan>('/api/v1/remote/cloudflare/dns/preview', { method: 'POST', body: JSON.stringify(dnsPayload()) }));
      notify('Đã kiểm tra bản ghi DNS dự kiến.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Không thể kiểm tra DNS Cloudflare.'); }
    finally { setDnsBusy(false); }
  }
  async function applyDns() {
    if (!dnsPlan) return;
    setDnsBusy(true);
    try {
      const plan = await apiRequest<ApiCloudflareDnsPlan>('/api/v1/remote/cloudflare/dns/apply', { method: 'POST', body: JSON.stringify(dnsPayload()) });
      setDnsPlan(plan);
      setDnsToken('');
      notify(plan.action === 'unchanged' ? 'DNS đã đúng cấu hình.' : 'Đã cập nhật DNS Cloudflare.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Không thể cập nhật DNS Cloudflare.'); }
    finally { setDnsBusy(false); }
  }

  const remoteText = remote?.state === 'ready' ? 'Đang hoạt động' : remote?.state === 'starting' ? 'Đang kết nối' : remote?.state === 'configured' ? 'Đã cấu hình' : remote?.state === 'error' ? 'Cần kiểm tra' : 'Chưa cấu hình';
  const remoteBadge = remote?.state === 'ready' ? 'online' : remote?.state === 'starting' ? 'loading' : 'offline';
  const dnsAction = dnsPlan?.action === 'create' ? 'Sẽ tạo mới' : dnsPlan?.action === 'update' ? 'Sẽ cập nhật' : dnsPlan ? 'Đã đúng cấu hình' : '';

  return <div className="page-stack">
    <PageHeading eyebrow="KHÔNG GIAN CỦA BẠN · PHẦN 7" title="Cài đặt" detail="Kiểm soát lưu trữ, truy cập từ xa và quyền người dùng."/>
    <div className="settings-tabs" role="tablist" aria-label="Nhóm cài đặt">
      {([['general','Chung'],['storage','Lưu trữ'],['remote','Truy cập từ xa'],['access','Quyền truy cập']] as const).map(([id,label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
    </div>
    <section className="panel settings-card">
      {tab === 'general' && <>
        <div className="section-heading"><div><span className="eyebrow">THIẾT LẬP CƠ BẢN</span><h2>Nhà của tôi</h2></div><Icon name="settings"/></div>
        {settings && <label className="form-field">Múi giờ<select value={settings.timezone} onChange={event => setSettings({ ...settings, timezone: event.target.value })}><option value="Asia/Ho_Chi_Minh">GMT+07:00 · Hồ Chí Minh</option><option value="UTC">UTC</option></select></label>}
        <div className="status-row"><span><strong>API cục bộ</strong><small>Trạng thái hệ thống</small></span><Badge state={system === 'ready' ? 'online' : system === 'failed' ? 'offline' : 'loading'}>{system === 'ready' ? 'Đã kết nối' : system === 'failed' ? 'Chưa sẵn sàng' : 'Đang kiểm tra'}</Badge></div>
      </>}
      {tab === 'storage' && <>
        <div className="section-heading"><div><span className="eyebrow">DUNG LƯỢNG</span><h2>Retention cục bộ</h2></div><Icon name="disk"/></div>
        {settings && <><label className="form-field">Thời gian lưu bản ghi<select value={settings.retentionDays} onChange={event => setSettings({ ...settings, retentionDays: Number(event.target.value) })}><option value="7">7 ngày</option><option value="14">14 ngày</option><option value="30">30 ngày</option><option value="90">90 ngày</option></select></label><label className="form-field">Giới hạn dung lượng (GB)<input type="number" min="1" value={settings.storageLimitBytes === null ? '' : Math.round(settings.storageLimitBytes / 1024 ** 3)} placeholder="Không giới hạn" onChange={event => setSettings({ ...settings, storageLimitBytes: event.target.value ? Number(event.target.value) * 1024 ** 3 : null })}/></label><p className="notice">Retention chỉ xóa segment ready; file đang ghi và segment liên kết với sự kiện đang hoạt động được bảo vệ.</p></>}
        {!settings && <p className="empty-inline">Đang tải cấu hình…</p>}
      </>}
      {tab === 'remote' && <>
        <div className="section-heading"><div><span className="eyebrow">CLOUDFLARE TUNNEL</span><h2>Kết nối ngoài mạng</h2></div><Icon name="shield"/></div>
        <div className="remote-hero" data-state={remote?.state ?? 'disabled'}>
          <span className="remote-orbit" aria-hidden="true"><span/></span>
          <div><small>TRẠNG THÁI TUNNEL</small><strong>{remoteText}</strong><p>{remote?.publicOrigin ?? 'Chưa khai báo NVR_PUBLIC_ORIGIN'}</p></div>
          <Badge state={remoteBadge}>{remoteText}</Badge>
        </div>
        {settings && <label className="toggle-row"><span><strong>Bật truy cập từ xa</strong><small>Cloudflare kết nối ra ngoài; Home NVR vẫn chỉ nghe tại 127.0.0.1.</small></span><input type="checkbox" checked={settings.remoteEnabled} onChange={event => setSettings({ ...settings, remoteEnabled: event.target.checked })}/><span className="toggle-ui"/></label>}
        <p className="notice">Cần hostname HTTPS, token file quyền 0600 và chính sách Cloudflare Access giới hạn đúng người dùng. Khi Internet gián đoạn, xem camera trong LAN vẫn hoạt động.</p>
        <div className="dns-setup">
          <div className="section-heading"><div><span className="eyebrow">DNS-ONLY</span><h3>Cấu hình domain Cloudflare</h3></div><Icon name="globe"/></div>
          <p className="dns-help">Ứng dụng chỉ quản lý CNAME tới Tunnel hiện có. API token chỉ dùng trong request và không được lưu lại.</p>
          <div className="form-pair"><label className="form-field">Zone domain<input value={dnsZone} onChange={event => { setDnsZone(event.target.value); setDnsPlan(null); }} placeholder="example.com" autoComplete="off"/></label><label className="form-field">Hostname<input value={dnsHostname} onChange={event => { setDnsHostname(event.target.value); setDnsPlan(null); }} placeholder="nvr.example.com" autoComplete="off"/></label></div>
          <label className="form-field">Tunnel target<input value={dnsTarget} onChange={event => { setDnsTarget(event.target.value); setDnsPlan(null); }} placeholder="xxxxxxxx.cfargotunnel.com" autoComplete="off"/></label>
          <label className="form-field">Cloudflare API token<input type="password" value={dnsToken} onChange={event => setDnsToken(event.target.value)} placeholder="Chỉ dùng một lần, không lưu" autoComplete="new-password"/></label>
          <label className="toggle-row"><span><strong>Proxy qua Cloudflare</strong><small>Khuyến nghị bật để hostname đi qua edge Cloudflare.</small></span><input type="checkbox" checked={dnsProxied} onChange={event => { setDnsProxied(event.target.checked); setDnsPlan(null); }}/><span className="toggle-ui"/></label>
          <div className="row-actions"><button className="secondary-btn" disabled={dnsBusy || !dnsZone || !dnsHostname || !dnsTarget || !dnsToken} onClick={() => void previewDns()}>{dnsBusy ? 'Đang kiểm tra…' : 'Xem trước DNS'}</button>{dnsPlan && <button className="primary-btn" disabled={dnsBusy || dnsPlan.action === 'unchanged'} onClick={() => void applyDns()}>{dnsPlan.action === 'unchanged' ? 'Đã đúng cấu hình' : dnsBusy ? 'Đang cập nhật…' : 'Xác nhận cập nhật DNS'}</button>}</div>
          {dnsPlan && <div className="dns-plan" role="status"><strong>{dnsAction}</strong><span>{dnsPlan.hostname} → {dnsPlan.tunnelTarget}</span><small>{dnsPlan.proxied ? 'Proxy bật' : 'DNS only'} · {dnsPlan.recordId ? 'sẽ dùng bản ghi hiện có' : 'chưa có bản ghi'}</small></div>}
        </div>
        <div className="status-row"><span><strong>Backup & restore</strong><small>Dùng npm run backup và npm run restore; backup mặc định không chứa khóa bí mật.</small></span><Badge state="online">Sẵn sàng</Badge></div>
      </>}
      {tab === 'access' && <><div className="section-heading"><div><span className="eyebrow">AN TOÀN TRƯỚC TIÊN</span><h2>Quyền truy cập</h2></div><Icon name="shield"/></div><AccessManager user={user} notify={notify}/></>}
      {tab !== 'access' && user.role === 'owner' && <div className="modal-footer"><button className="primary-btn" disabled={!settings || busy} onClick={() => void save()}><Icon name="check" size={17}/>{busy ? 'Đang lưu…' : 'Lưu cài đặt'}</button></div>}
    </section>
  </div>;
}
