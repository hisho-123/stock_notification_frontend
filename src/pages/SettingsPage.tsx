import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useBeforeUnload, useBlocker } from 'react-router';
import { useAuth } from '../auth';
import { errorMessage, uncertainResult } from '../api';
import { Alert, ConfirmDialog, Footer, Header, PageTitle, Status } from '../components';
import { formatDate } from '../format';
import type { NotificationSettings } from '../types';
import { validateThreshold } from '../validation';

export function SettingsPage() {
  const { api, logout, state } = useAuth();
  const [saved, setSaved] = useState<NotificationSettings | null>(null);
  const [edited, setEdited] = useState<number[]>([]);
  const [raw, setRaw] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState('');
  const [inputError, setInputError] = useState('');
  const [notice, setNotice] = useState('');
  const [logoutError, setLogoutError] = useState('');
  const [confirmLogout, setConfirmLogout] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const dirty = saved !== null && JSON.stringify(saved.thresholds) !== JSON.stringify(edited);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      state.status === 'authenticated' &&
      dirty &&
      currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (!dirty && blocker.state === 'blocked') blocker.proceed();
  }, [dirty, blocker]);
  useBeforeUnload(
    useCallback(
      (event) => {
        if (dirty && state.status === 'authenticated') {
          event.preventDefault();
          event.returnValue = '';
        }
      },
      [dirty, state.status],
    ),
  );

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    try {
      const settings = await api.settings(controller.signal);
      if (controller.signal.aborted) return;
      setSaved(settings);
      setEdited([...settings.thresholds]);
    } catch (err) {
      if (!controller.signal.aborted) setError(`設定を取得できませんでした。${errorMessage(err)}`);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    void load();
    return () => request.current?.abort();
  }, [load]);

  const locked = loading || saving || loggingOut || !saved;
  function add(event: FormEvent) {
    event.preventDefault();
    if (locked) return;
    const invalid = validateThreshold(raw, edited);
    setInputError(invalid);
    setNotice('');
    if (!invalid) {
      setEdited((previous) => [...previous, Number(raw)].sort((a, b) => a - b));
      setRaw('');
    }
    input.current?.focus();
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (locked || !dirty || !edited.length) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await api.saveSettings(edited);
      setSaved(result);
      setEdited([...result.thresholds]);
      setNotice('設定を保存しました。次の監視実行から適用されます。');
    } catch (err) {
      let message = `保存に失敗しました。編集中の値を保持しています。${errorMessage(err)}`;
      if (uncertainResult(err)) {
        try {
          const current = await api.settings();
          setSaved(current);
          message =
            '保存の応答を確認できなかったため、保存済み設定を再取得しました。編集内容は保持しています。内容を確認してください。';
        } catch {
          message += ' 保存結果の再取得にも失敗しました。接続を確認してから再試行してください。';
        }
      }
      setError(message);
    } finally {
      setSaving(false);
    }
  }
  async function performLogout() {
    // ヘッダーからはrequestLogout、確認からはdialogのbusyが受付を制御する。
    setLoggingOut(true);
    setLogoutError('');
    try {
      await logout();
    } catch (err) {
      setLogoutError(errorMessage(err));
    } finally {
      setLoggingOut(false);
    }
  }
  function requestLogout() {
    if (saving || loggingOut) return;
    setLogoutError('');
    if (dirty) setConfirmLogout(true);
    else void performLogout();
  }
  function cancelLeave() {
    setConfirmLogout(false);
    setLogoutError('');
    if (blocker.state === 'blocked') blocker.reset();
  }
  return (
    <>
      <Header onLogout={requestLogout} loggingOut={loggingOut} />
      <main id="main" className="container settings-container">
        <PageTitle
          eyebrow="NOTIFICATION SETTINGS"
          title="通知設定"
          description="最高値から何%下落したときに通知するかを設定します。"
        >
          <div className="schedule">
            <span>全ての株・指数に適用</span>
            <strong>共通の通知率</strong>
          </div>
        </PageTitle>
        {!confirmLogout && <Alert>{logoutError}</Alert>}
        <div className="settings-grid">
          <section className="card" aria-labelledby="threshold-heading">
            <h2 id="threshold-heading">通知する下落率</h2>
            <p className="description">1〜99%の整数を、1件以上設定してください。</p>
            <Alert>{error}</Alert>
            <Status>
              {loading
                ? '通知設定を読み込んでいます…'
                : saving
                  ? '設定を保存しています…'
                  : notice || (dirty ? '未保存の変更があります。' : '')}
            </Status>
            {!loading && !saved && (
              <button type="button" onClick={() => void load()}>
                再試行
              </button>
            )}
            <div className="thresholds" aria-label="設定中の通知率">
              {saved &&
                edited.map((value) => (
                  <span className="threshold" key={value}>
                    {value}%
                    <button
                      type="button"
                      aria-label={`${value}%を削除`}
                      disabled={locked}
                      onClick={() => {
                        setEdited((previous) => previous.filter((t) => t !== value));
                        setNotice('');
                        input.current?.focus();
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              {saved && !edited.length && (
                <p className="small muted">通知率を1件以上追加してください。</p>
              )}
            </div>
            <hr className="settings-divider" />
            <form className="form-row" noValidate onSubmit={add}>
              <div className="grow threshold-input">
                <label htmlFor="threshold-input">通知率を追加（%）</label>
                <input
                  ref={input}
                  id="threshold-input"
                  name="threshold"
                  type="text"
                  inputMode="numeric"
                  placeholder="例：35"
                  disabled={locked}
                  value={raw}
                  onChange={(event) => setRaw(event.target.value)}
                  aria-invalid={!!inputError}
                  aria-describedby={inputError ? 'threshold-error' : undefined}
                />
              </div>
              <button type="submit" disabled={locked}>
                ＋ 追加
              </button>
            </form>
            <div id="threshold-error">
              <Alert>{inputError}</Alert>
            </div>
            <form onSubmit={(event) => void save(event)}>
              <div className="save-row">
                <span className="small muted">
                  {saved ? `更新：${formatDate(saved.updated_at)}` : ''}
                </span>
                <button
                  className="primary"
                  type="submit"
                  disabled={locked || !dirty || !edited.length}
                >
                  {saving ? '保存中…' : '設定を保存'}
                </button>
              </div>
            </form>
          </section>
          <aside className="card">
            <p className="eyebrow">HOW IT WORKS</p>
            <h2>通知のルール</h2>
            <ul className="note-list">
              <li>全ての監視対象に同じ通知率を適用します。</li>
              <li>複数の通知率に一度に到達した場合、最大の閾値について1通お知らせします。</li>
              <li>
                既に通知した最大率は、設定を変更しても保持します。それを超える設定値でのみ新たに通知します。
              </li>
              <li>最高値を更新すると、通知済み状態がリセットされます。</li>
              <li>
                設定変更時には通知しません。変更は次の監視実行から適用します。価格取得・通知判定は毎日07:00
                JSTです。実行中に変更した場合は次回に適用します。
              </li>
            </ul>
            <div className="example">
              <strong>例：20%を通知済みの場合</strong>
              通知率を5・15・25%に変更しても、15%では再通知しません。25%に到達すると通知します。
            </div>
          </aside>
        </div>
        <Footer>追加・削除した通知率は「設定を保存」で反映されます。</Footer>
        <ConfirmDialog
          open={confirmLogout || blocker.state === 'blocked'}
          title="変更を保存していません"
          cancelLabel="編集を続ける"
          confirmLabel={confirmLogout ? '破棄してログアウト' : '破棄して戻る'}
          busy={loggingOut || saving}
          error={logoutError}
          onCancel={cancelLeave}
          onConfirm={() => {
            if (confirmLogout) void performLogout();
            else if (blocker.state === 'blocked') blocker.proceed();
          }}
        >
          <p className="muted">
            {confirmLogout
              ? '変更を破棄してログアウトしますか？'
              : '変更を破棄して監視対象の一覧へ戻りますか？'}
          </p>
        </ConfirmDialog>
      </main>
    </>
  );
}
