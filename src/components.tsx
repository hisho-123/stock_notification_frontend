import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { useAuth } from './auth';
import { errorMessage } from './api';

export function Alert({ children, success = false }: { children?: ReactNode; success?: boolean }) {
  if (!children) return null;
  return (
    <div
      className={`alert${success ? ' success' : ''}`}
      role={success ? 'status' : 'alert'}
      aria-live={success ? 'polite' : undefined}
    >
      {children}
    </div>
  );
}
export function Status({ children }: { children: ReactNode }) {
  return (
    <div className="status" role="status" aria-live="polite">
      {children}
    </div>
  );
}
export function Header({
  onLogout,
  loggingOut = false,
}: {
  onLogout?: () => void;
  loggingOut?: boolean;
}) {
  const { state, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const authenticated = state.status === 'authenticated';
  async function handleLogout() {
    if (onLogout) {
      onLogout();
      return;
    }
    // この処理の入口はdisabledで制御するボタンだけなので、到達不能な再入判定を重ねない。
    setBusy(true);
    setError('');
    try {
      await logout();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          // 登録URLのフラグメントには権限トークンがあるため、アンカーで書き換えない。
          event.preventDefault();
          const main = document.getElementById('main');
          if (main) {
            main.tabIndex = -1;
            main.focus();
          }
        }}
      >
        本文へ移動
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" to={authenticated ? '/assets' : '/login'}>
            <span className="brand-mark" aria-hidden="true">
              ↘
            </span>
            <div>
              <div className="brand-name">下落通知</div>
              <div className="brand-sub">MARKET WATCH</div>
            </div>
          </Link>
          {authenticated ? (
            <nav className="nav" aria-label="メイン">
              <NavLink to="/assets">監視対象</NavLink>
              <NavLink to="/settings/notifications">通知設定</NavLink>
              <button
                className="ghost"
                type="button"
                disabled={busy || loggingOut}
                onClick={() => void handleLogout()}
              >
                {busy || loggingOut ? 'ログアウト中…' : 'ログアウト'}
              </button>
            </nav>
          ) : (
            <span className="muted small">株・指数のモニタリング</span>
          )}
        </div>
      </header>
      {error && (
        <div className="header-error">
          <Alert>{error}</Alert>
        </div>
      )}
    </>
  );
}
export function PageTitle({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  useEffect(() => {
    document.title = `${title} | 下落通知`;
  }, [title]);
  return (
    <div className="title-row">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="description">{description}</p>
      </div>
      {children}
    </div>
  );
}
export function Footer({ children }: { children: ReactNode }) {
  return (
    <footer className="footer">
      <span>{children}</span>
      <span>表示時刻：日本時間（JST）</span>
    </footer>
  );
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = '取消',
  busy = false,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const node = dialog.current;
    const opener = document.activeElement;
    node?.showModal();
    cancel.current?.focus();
    return () => {
      node?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [open]);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id={`${id}-title`}>{title}</h2>
      <div id={`${id}-description`}>{children}</div>
      <Alert>{error}</Alert>
      <div className="dialog-actions">
        <button ref={cancel} type="button" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </button>
        <button className="danger" type="button" disabled={busy} onClick={onConfirm}>
          {busy ? '処理中…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
