import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth';
import { ApiError, errorMessage, isCancelled } from '../api';
import { Header } from '../components';
import { formatDate } from '../format';
import { validateLogin } from '../validation';

type Phase =
  | 'checking'
  | 'valid'
  | 'failed'
  | 'unavailable'
  | 'limited'
  | 'submitting'
  | 'recovering'
  | 'uncertain'
  | 'complete';
const unavailable = 'この登録URLは利用できません。LINEトークで「登録」と送信してください。';
const recovery =
  '登録が完了している場合は、入力したID・パスワードでログインしてください。未完了の場合はLINEで「登録」と送信してください。';

export function RegisterPage() {
  const { state, api, acceptSession, forgetSession } = useAuth();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const token = useRef('');
  const request = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<Phase>('checking');
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const idInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const wait = Math.max(0, Math.ceil((retryAt - now) / 1000));

  const validate = useCallback(async () => {
    request.current?.abort();
    const pending = new AbortController();
    request.current = pending;
    setError('');
    setFields({});
    setPassword('');
    if (!token.current) {
      setPhase('unavailable');
      setError(unavailable);
      return;
    }
    setPhase('checking');
    try {
      const validity = await api.validateRegistration(token.current, pending.signal);
      if (pending.signal.aborted) return;
      setExpiresAt(validity.expires_at);
      setPhase('valid');
    } catch (err) {
      if (pending.signal.aborted || isCancelled(err)) return;
      setError(errorMessage(err));
      if (err instanceof ApiError && err.status === 410) {
        token.current = '';
        setPhase('unavailable');
        setError(unavailable);
      } else if (err instanceof ApiError && err.status === 429) {
        const timestamp = Date.now();
        setNow(timestamp);
        setRetryAt(timestamp + err.retryAfter * 1000);
        setPhase('limited');
      } else setPhase('failed');
    }
  }, [api]);

  useEffect(() => {
    document.title = 'ユーザー登録 | 下落通知';
    const values = new URLSearchParams(hash.slice(1)).getAll('token');
    token.current = values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0]) ? values[0] : '';
    void validate();
    return () => {
      // URL以外の永続領域には保存せず、離脱時は未完了通信と平文トークンを破棄する。
      request.current?.abort();
      token.current = '';
    };
  }, [hash, validate]);
  useEffect(() => {
    if (phase !== 'limited') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    // 登録POSTを再送すると二重登録の成否を誤認するため、待機後は確認APIだけを呼ぶ。
    if (phase === 'limited' && !wait) void validate();
  }, [phase, wait, validate]);
  useEffect(() => {
    if (phase !== 'valid' || !expiresAt) return;
    const timer = window.setTimeout(
      () => {
        token.current = '';
        setPassword('');
        setPhase('unavailable');
        setError(unavailable);
      },
      Math.max(0, Date.parse(expiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [phase, expiresAt]);
  useEffect(() => {
    const discard = () => {
      token.current = '';
      request.current?.abort();
      setPassword('');
      setPhase('unavailable');
      setError(unavailable);
    };
    window.addEventListener('pagehide', discard);
    return () => window.removeEventListener('pagehide', discard);
  }, []);

  async function complete(session: Parameters<typeof acceptSession>[0]) {
    token.current = '';
    setPassword('');
    setPhase('complete');
    acceptSession(session);
    await navigate('/assets', { replace: true });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (phase !== 'valid') return;
    const invalid = validateLogin(id, password);
    setFields(invalid);
    setError('');
    if (Object.keys(invalid).length) {
      (invalid.login_id ? idInput : passwordInput).current?.focus();
      return;
    }
    const pending = new AbortController();
    request.current = pending;
    setPhase('submitting');
    try {
      const session = await api.register(token.current, id, password, pending.signal);
      if (!pending.signal.aborted) await complete(session);
    } catch (err) {
      if (pending.signal.aborted || isCancelled(err)) return;
      setPassword('');
      if (err instanceof ApiError && err.status === 409) {
        setFields({ login_id: '別のIDを入力してください。', ...err.fields });
        setError('このログインIDは使用されています。');
        setPhase('valid');
        window.requestAnimationFrame(() => idInput.current?.focus());
      } else if (err instanceof ApiError && err.status === 410) {
        token.current = '';
        setPhase('unavailable');
        setError(unavailable);
      } else if (err instanceof ApiError && err.status === 429) {
        const timestamp = Date.now();
        setNow(timestamp);
        setRetryAt(timestamp + err.retryAfter * 1000);
        setError(errorMessage(err));
        setPhase('limited');
      } else if (!(err instanceof ApiError) || err.status === 0 || err.status >= 500) {
        // Cookieだけ発行済みの場合があるため、入力したIDと照合してから成功を確定する。
        setPhase('recovering');
        token.current = '';
        try {
          const session = await api.session(pending.signal);
          if (pending.signal.aborted) return;
          if (session.login_id === id) {
            await complete(session);
            return;
          }
        } catch {
          if (pending.signal.aborted) return;
        }
        // 旧ログインの自動転送を止め、入力した新IDでログインできるようローカル認証だけ破棄する。
        forgetSession();
        setPhase('uncertain');
        setError(recovery);
      } else {
        setFields(err.fields);
        setError(errorMessage(err));
        setPhase('valid');
        window.requestAnimationFrame(() => passwordInput.current?.focus());
      }
    }
  }
  const editable = phase === 'valid';
  const validInput = Object.keys(validateLogin(id, password)).length === 0;
  return (
    <>
      <Header />
      <main id="main" className="login-container">
        <div className="login-hero">
          <p className="eyebrow">GET STARTED</p>
          <h1>ユーザー登録</h1>
          <p className="description">LINEと連携して、株・指数の下落を見守ります。</p>
        </div>
        <section className="card login-card" aria-label="ユーザー登録">
          <p className="security-note">
            登録URLは24時間有効で、1回だけ使えます。他の人に共有しないでください。
          </p>
          {state.status === 'authenticated' && <p>登録後は新しいユーザーでログインします。</p>}
          {expiresAt && (
            <p id="registration-expires-at" className="form-note">
              有効期限：{formatDate(expiresAt)}
            </p>
          )}
          <form id="registration-form" noValidate onSubmit={(event) => void submit(event)}>
            <div className="field">
              <label htmlFor="login-id">ログインID</label>
              <input
                ref={idInput}
                id="login-id"
                name="login_id"
                autoComplete="username"
                required
                disabled={!editable}
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
              <p className="form-note">1〜100文字。前後の空白・大文字と小文字を区別します。</p>
            </div>
            <div className="field">
              <label htmlFor="password">パスワード</label>
              <input
                ref={passwordInput}
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                disabled={!editable}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={!!fields.password}
                aria-describedby="password-hint"
              />
              <p id="password-hint" className="form-note">
                UTF-8で8〜72バイト。日本語は1文字で複数バイトです。
              </p>
              {fields.password && (
                <div className="field-error" role="alert">
                  {fields.password}
                </div>
              )}
            </div>
            {error && (
              <div id="registration-error" className="alert" role="alert">
                {phase === 'limited'
                  ? `試行回数が上限に達しました。あと${wait}秒でURLを確認し直します。`
                  : error}
              </div>
            )}
            <button
              id="register-button"
              className="primary login-submit"
              type="submit"
              disabled={!editable || !validInput}
            >
              {phase === 'submitting' ? '登録中…' : '登録'}
            </button>
            <div id="registration-status" className="status" role="status" aria-live="polite">
              {(
                {
                  checking: '登録URLを確認しています…',
                  submitting: '登録しています…',
                  recovering: '登録結果を確認しています…',
                  complete: '登録が完了しました。',
                } as Partial<Record<Phase, string>>
              )[phase] ?? ''}
            </div>
          </form>
          {phase === 'failed' && (
            <button id="retry-button" type="button" onClick={() => void validate()}>
              確認を再試行
            </button>
          )}
          {(phase === 'unavailable' || phase === 'uncertain') && (
            <p id="recovery-note" className="security-note">
              {phase === 'uncertain'
                ? recovery
                : 'LINEトークで「登録」と送信してください。すでに登録した場合はログインしてください。'}
            </p>
          )}
          <p>
            <Link id="login-link" to="/login">
              ログインへ
            </Link>
          </p>
        </section>
      </main>
    </>
  );
}
