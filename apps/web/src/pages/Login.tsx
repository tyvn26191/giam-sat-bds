import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth';
import { useEmulator } from '../firebase';

const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'Email hoặc mật khẩu không đúng',
  'auth/invalid-email': 'Email không hợp lệ',
  'auth/email-already-in-use': 'Email đã được đăng ký',
  'auth/weak-password': 'Mật khẩu cần ít nhất 8 ký tự',
  'auth/too-many-requests': 'Thử quá nhiều lần, hãy đợi một lúc',
  'auth/popup-closed-by-user': 'Đã đóng cửa sổ đăng nhập Google',
  'auth/operation-not-allowed': 'Phương thức đăng nhập này chưa được bật',
};

const msg = (e: unknown) => MESSAGES[(e as { code?: string }).code ?? ''] ?? (e as Error).message;

export function LoginPage() {
  const { signIn, signUp, signInGoogle, resetPassword } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'signup' && password.length < 8) {
      setError('Mật khẩu cần ít nhất 8 ký tự');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signin') await signIn(email.trim(), password);
      else await signUp(email.trim(), password);
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <div className="auth-brand">
          <img src="/favicon.svg" alt="" width={44} height={44} />
          <div>
            <h1>PROPERTY WATCH</h1>
            <p className="muted">Giám sát giá bất động sản Nhật Bản — SUUMO · HOME'S · at home</p>
          </div>
        </div>
        {useEmulator && <p className="notice notice-warn">Chế độ emulator: dữ liệu thử nghiệm, không phải dữ liệu thật.</p>}
        <form onSubmit={submit} className="stack">
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Mật khẩu</span>
            <input
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'signup' ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p className="notice notice-error">{error}</p>}
          {info && <p className="notice notice-ok">{info}</p>}
          <button className="btn btn-primary" disabled={busy}>
            {mode === 'signin' ? 'Đăng nhập' : 'Tạo tài khoản'}
          </button>
        </form>
        <div className="divider">hoặc</div>
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            setError(null);
            try {
              await signInGoogle();
            } catch (err) {
              setError(msg(err));
            }
          }}
        >
          Đăng nhập với Google
        </button>
        <div className="auth-links">
          <button className="link" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
            {mode === 'signin' ? 'Chưa có tài khoản? Đăng ký' : 'Đã có tài khoản? Đăng nhập'}
          </button>
          {mode === 'signin' && (
            <button
              className="link"
              onClick={async () => {
                if (!email) {
                  setError('Nhập email trước');
                  return;
                }
                await resetPassword(email.trim()).catch(() => undefined);
                setInfo('Nếu email tồn tại, thư đặt lại mật khẩu đã được gửi.');
              }}
            >
              Quên mật khẩu?
            </button>
          )}
        </div>
        <p className="muted small">Tài khoản mới cần được admin cấp quyền trước khi sử dụng.</p>
      </div>
    </div>
  );
}

export function PendingPage() {
  const { session, refresh, resendVerification, signOut } = useAuth();
  if (session.status !== 'signedIn') return null;
  const verified = session.user.emailVerified;
  return (
    <div className="auth-page">
      <div className="auth-card card stack">
        <h1>Chờ cấp quyền</h1>
        <p>
          Tài khoản <strong>{session.user.email}</strong> đã đăng nhập nhưng chưa được admin cấp quyền sử dụng.
        </p>
        {!verified && (
          <p className="notice notice-warn">
            Email chưa được xác minh. Hãy mở thư xác minh trong hộp thư (chỉ email đã xác minh mới được cấp quyền tự động).
          </p>
        )}
        {session.apiError && <p className="notice notice-error">Không gọi được máy chủ giám sát: {session.apiError}</p>}
        <p className="muted small">
          Admin: thêm email vào <code>MEMBER_EMAILS</code> của worker, hoặc chạy <code>node deploy/set-role.mjs {session.user.email} member</code>.
        </p>
        <div className="row">
          <button className="btn btn-primary" onClick={() => void refresh()}>
            Kiểm tra lại
          </button>
          {!verified && (
            <button className="btn" onClick={() => void resendVerification()}>
              Gửi lại thư xác minh
            </button>
          )}
          <button className="btn" onClick={() => void signOut()}>
            Đăng xuất
          </button>
        </div>
      </div>
    </div>
  );
}
