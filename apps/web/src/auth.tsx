import { useState, type FormEvent } from 'react';
import { apiRequest, ApiRequestError, type SessionUser } from './api';
import { Icon } from './ui';

interface AccessScreenProps {
  mode: 'setup' | 'login' | 'locked' | 'offline';
  onAuthenticated: (user: SessionUser) => void;
  onRetry: () => void;
}

function messageOf(error: unknown) {
  return error instanceof ApiRequestError ? error.message : 'Không thể kết nối Home NVR.';
}

export function AccessScreen({ mode, onAuthenticated, onRetry }: AccessScreenProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get('password') ?? '');
    const confirmation = String(data.get('confirmation') ?? '');
    if (mode === 'setup' && password !== confirmation) {
      setError('Mật khẩu xác nhận chưa khớp.');
      return;
    }

    setBusy(true);
    try {
      const body = mode === 'setup'
        ? { username: data.get('username'), password, setupToken: data.get('setupToken') }
        : { username: data.get('username'), password };
      const user = await apiRequest<SessionUser>(`/api/v1/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      form.reset();
      onAuthenticated(user);
    } catch (requestError) {
      setError(messageOf(requestError));
    } finally {
      setBusy(false);
    }
  }

  const unavailable = mode === 'locked' || mode === 'offline';
  return <main className="access-shell">
    <section className="access-visual" aria-label="Home NVR">
      <div className="access-grid" aria-hidden="true"/>
      <div className="access-radar" aria-hidden="true"><span/><span/><span/></div>
      <div className="access-copy">
        <span className="eyebrow"><span className="dot green"/> LOCAL CORE · PRIVATE BY DESIGN</span>
        <h1>Quan sát ngôi nhà.<br/><em>Giữ dữ liệu ở nhà.</em></h1>
        <p>Camera, quyền truy cập và thông tin kết nối được quản lý ngay trên máy Ubuntu của bạn.</p>
        <div className="access-signals"><span><Icon name="shield" size={17}/>Mã hóa bí mật</span><span><Icon name="activity" size={17}/>ONVIF + RTSP</span><span><Icon name="camera" size={17}/>Phân quyền từng camera</span></div>
      </div>
    </section>
    <section className="access-panel">
      <a className="brand access-brand" href="/" aria-label="Home NVR"><span className="brand-symbol"><Icon name="camera" size={23}/></span><span>home<span className="brand-light">nvr.</span></span></a>
      <div className="access-form-wrap">
        <span className="access-kicker">{mode === 'setup' ? 'KHỞI TẠO AN TOÀN' : 'BẢNG ĐIỀU KHIỂN CỤC BỘ'}</span>
        <h2>{mode === 'setup' ? 'Tạo tài khoản chủ nhà' : mode === 'login' ? 'Chào mừng trở lại' : mode === 'locked' ? 'Chưa thể khởi tạo' : 'API chưa sẵn sàng'}</h2>
        <p>{mode === 'setup' ? 'Tài khoản đầu tiên có toàn quyền quản trị thiết bị và khách.' : mode === 'login' ? 'Đăng nhập để truy cập camera được cấp cho bạn.' : mode === 'locked' ? 'Máy chủ chưa có setup token. Hãy cấu hình NVR_SETUP_TOKEN rồi khởi động lại.' : 'Không kết nối được dịch vụ Home NVR trên máy này.'}</p>
        {unavailable ? <button className="primary-btn access-submit" onClick={onRetry}><Icon name="refresh" size={17}/>Kiểm tra lại</button> :
          <form className="access-form" onSubmit={submit}>
            {mode === 'setup' && <label className="form-field">Setup token<input name="setupToken" type="password" minLength={32} required autoComplete="off" placeholder="Token từ cấu hình máy chủ"/></label>}
            <label className="form-field">Tên đăng nhập<input name="username" required minLength={3} maxLength={80} autoComplete="username" placeholder="Ví dụ: owner"/></label>
            <label className="form-field">Mật khẩu<input name="password" type="password" required minLength={mode === 'setup' ? 12 : 1} maxLength={128} autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} placeholder={mode === 'setup' ? 'Ít nhất 12 ký tự' : 'Mật khẩu của bạn'}/></label>
            {mode === 'setup' && <label className="form-field">Xác nhận mật khẩu<input name="confirmation" type="password" required minLength={12} maxLength={128} autoComplete="new-password" placeholder="Nhập lại mật khẩu"/></label>}
            {error && <p className="inline-error" role="alert">{error}</p>}
            <button className="primary-btn access-submit" disabled={busy}>{busy ? <><span className="button-spinner"/>Đang xử lý…</> : <>{mode === 'setup' ? 'Khởi tạo Home NVR' : 'Đăng nhập'}<Icon name="arrow" size={17}/></>}</button>
          </form>}
      </div>
      <p className="access-foot"><Icon name="shield" size={14}/> Phiên đăng nhập được bảo vệ bằng cookie HttpOnly.</p>
    </section>
  </main>;
}
