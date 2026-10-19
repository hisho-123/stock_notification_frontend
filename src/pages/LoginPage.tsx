import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../auth';
import { ApiError, errorMessage } from '../api';
import { Alert, Header, Status } from '../components';
import { validateLogin } from '../validation';

export function LoginPage() {
  const { state, login } = useAuth();
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const idInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    document.title = 'ログイン | 下落通知';
  }, []);
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  if (state.status === 'authenticated') return <Navigate to="/assets" replace />;
  const wait = Math.max(0, Math.ceil((retryAt - now) / 1000));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || wait) return;
    const invalid = validateLogin(id, password);
    setFields(invalid);
    setError('');
    if (Object.keys(invalid).length) {
      (invalid.login_id ? idInput : passwordInput).current?.focus();
      return;
    }
    setBusy(true);
    try {
      await login(id, password);
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
      if (err instanceof ApiError) {
        setFields(err.fields);
        if (err.status === 429) {
          const timestamp = Date.now();
          setNow(timestamp);
          setRetryAt(timestamp + err.retryAfter * 1000);
        }
      }
      window.requestAnimationFrame(() => passwordInput.current?.focus());
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Header />
      <main id="main" className="login-container">
        <div className="login-hero">
          <p className="eyebrow">WELCOME BACK</p>
          <h1>ログイン</h1>
          <p className="description">監視対象と通知の設定を管理します。</p>
        </div>
        <section className="card login-card" aria-label="ユーザーログイン">
          <form id="login-form" onSubmit={(event) => void submit(event)} noValidate>
            <div className="field">
              <label htmlFor="login-id">ID</label>
              <input
                ref={idInput}
                id="login-id"
                name="login_id"
                autoComplete="username"
                required
                placeholder="ログインID"
                disabled={busy}
                value={id}
                onChange={(event) => setId(event.target.value)}
                aria-invalid={!!fields.login_id}
                aria-describedby={fields.login_id ? 'id-error' : undefined}
              />
              {fields.login_id && (
                <div className="field-error" id="id-error" role="alert">
                  {fields.login_id}
                </div>
              )}
            </div>
            <div className="field">
              <label htmlFor="password">パスワード</label>
              <input
                ref={passwordInput}
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="パスワードを入力"
                disabled={busy}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={!!fields.password}
                aria-describedby={fields.password ? 'password-error' : undefined}
              />
              {fields.password && (
                <div className="field-error" id="password-error" role="alert">
                  {fields.password}
                </div>
              )}
            </div>
            <div id="login-error">
              <Alert>
                {wait
                  ? `ログインの試行回数が上限に達しました。あと${wait}秒で再試行できます。`
                  : error}
              </Alert>
            </div>
            <button
              id="login-button"
              className="primary login-submit"
              type="submit"
              disabled={busy || wait > 0}
            >
              {busy ? 'ログイン中…' : 'ログイン'}
            </button>
            <div id="login-status">
              <Status>{busy ? 'ログインしています…' : ''}</Status>
            </div>
          </form>
          <p className="security-note">ログインの有効期限は24時間です。</p>
        </section>
        <p className="security-note">
          初めて利用する方は、LINE公式アカウントを友だち追加し、トークに届くURLから登録してください。URLが届かない／期限切れの場合は「登録」と送信してください。
        </p>
        <p className="login-footer">下落通知 · 株と指数を、毎日見守る。</p>
      </main>
    </>
  );
}
