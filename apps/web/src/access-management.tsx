import { useEffect, useState, type FormEvent } from 'react';
import { apiRequest, ApiRequestError, type ApiCamera, type SessionUser } from './api';
import { Badge, Icon } from './ui';

function errorMessage(error: unknown) {
  return error instanceof ApiRequestError ? error.message : 'Không thể cập nhật quyền truy cập.';
}

function defaultExpiry() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export function AccessManager({ user, notify }: { user: SessionUser; notify: (text: string) => void }) {
  const [guests, setGuests] = useState<SessionUser[]>([]);
  const [cameras, setCameras] = useState<ApiCamera[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    if (user.role !== 'owner') return;
    try {
      const [users, availableCameras] = await Promise.all([
        apiRequest<SessionUser[]>('/api/v1/users'),
        apiRequest<ApiCamera[]>('/api/v1/cameras'),
      ]);
      setGuests(users.filter(item => item.role === 'guest'));
      setCameras(availableCameras);
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  }

  useEffect(() => { void load(); }, [user.id, user.role]);

  async function createGuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = event.currentTarget;
    const data = new FormData(form);
    const cameraIds = data.getAll('cameraIds').map(String);
    try {
      const guest = await apiRequest<SessionUser>('/api/v1/users', {
        method: 'POST',
        body: JSON.stringify({
          username: data.get('username'),
          password: data.get('password'),
          expiresAt: new Date(String(data.get('expiresAt'))).toISOString(),
          cameraIds,
        }),
      });
      setGuests(current => [...current, guest]);
      form.reset();
      const expiry = form.elements.namedItem('expiresAt') as HTMLInputElement | null;
      if (expiry) expiry.value = defaultExpiry();
      notify('Đã tạo quyền truy cập có thời hạn cho ' + guest.username + '.');
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(guest: SessionUser) {
    if (!window.confirm('Thu hồi quyền của “' + guest.username + '” ngay bây giờ?')) return;
    setBusy(true);
    try {
      await apiRequest<void>('/api/v1/users/' + guest.id, { method: 'DELETE' });
      setGuests(current => current.filter(item => item.id !== guest.id));
      notify('Đã thu hồi quyền và mọi phiên của ' + guest.username + '.');
    } catch (requestError) {
      notify(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  if (user.role !== 'owner') return <div className="access-summary">
    <div className="status-row"><span><strong>Tài khoản khách</strong><small>Chỉ xem camera đã được chủ nhà cấp.</small></span><Badge state="online">Đang hoạt động</Badge></div>
    <div className="status-row"><span><strong>Hết hạn</strong><small>{user.expiresAt ? new Date(user.expiresAt).toLocaleString('vi-VN') : 'Không đặt'}</small></span><Icon name="lock" size={18}/></div>
  </div>;

  return <div className="guest-layout">
    <div className="guest-column">
      <div className="section-heading"><div><span className="eyebrow">TÀI KHOẢN CÓ THỜI HẠN</span><h2>Khách đang được cấp quyền</h2></div><span className="count-pill">{guests.length}</span></div>
      <div className="guest-list">{guests.length ? guests.map(guest => <article className="guest-row" key={guest.id}><span className="guest-avatar">{guest.username.slice(0, 2).toUpperCase()}</span><span><strong>{guest.username}</strong><small>{guest.cameraIds.length} camera · hết hạn {guest.expiresAt ? new Date(guest.expiresAt).toLocaleString('vi-VN') : '—'}</small></span><button className="danger-btn compact" disabled={busy} onClick={() => void revoke(guest)}>Thu hồi</button></article>) : <p className="empty-inline">Chưa có tài khoản khách.</p>}</div>
    </div>
    <form className="guest-form" onSubmit={createGuest}>
      <span className="eyebrow">CẤP QUYỀN MỚI</span><h2>Mời người thân</h2>
      <div className="form-pair"><label className="form-field">Tên đăng nhập<input name="username" required minLength={3} maxLength={80} autoComplete="off"/></label><label className="form-field">Mật khẩu tạm<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label></div>
      <label className="form-field">Tự động hết hạn<input name="expiresAt" type="datetime-local" required defaultValue={defaultExpiry()} min={new Date().toISOString().slice(0, 16)}/></label>
      <fieldset className="camera-grants"><legend>Camera được phép xem</legend>{cameras.length ? cameras.map(camera => <label key={camera.id}><input type="checkbox" name="cameraIds" value={camera.id}/><span><Icon name="camera" size={16}/>{camera.name}<small>{camera.location || 'Chưa đặt khu vực'}</small></span></label>) : <p>Hãy thêm camera trước khi tạo khách.</p>}</fieldset>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <button className="primary-btn" disabled={busy || !cameras.length}>{busy ? <><span className="button-spinner"/>Đang lưu…</> : <><Icon name="plus" size={17}/>Tạo tài khoản khách</>}</button>
    </form>
  </div>;
}
