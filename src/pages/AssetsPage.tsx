import { useRef, useState, type FormEvent } from 'react';
import { ApiError, errorMessage, isCancelled, uncertainResult } from '../api';
import { useAuth } from '../auth';
import { Alert, ConfirmDialog, Footer, Header, PageTitle } from '../components';
import { formatDate, formatPrice } from '../format';
import {
  sortOptions,
  type Asset,
  type AssetErrorCode,
  type ListOptions,
  type Sort,
} from '../types';
import { useAssetList } from '../useAssetList';
import { normalizeCode, validateCode } from '../validation';

const errorLabels: Record<AssetErrorCode, string> = {
  PRICE_FETCH_FAILED: '価格取得に失敗',
  NOTIFICATION_FAILED: 'LINE通知に失敗',
  PRICE_DATA_STALE: '価格データが10日以上前',
};
const columns: [Sort, string, string?][] = [
  ['code', '銘柄'],
  ['highest_value', '監視開始後の最高値', 'num'],
  ['latest_value', '最終取得値', 'num'],
  ['decline_rate', '下落率', 'num'],
  ['latest_fetched_at', '取得日時'],
  ['monitoring_enabled', '監視状態'],
  ['last_notified_threshold', '通知済み率', 'num'],
];

export function AssetsPage() {
  const { api } = useAuth();
  const [options, setOptions] = useState<ListOptions>({ q: '', sort: 'created_at', order: 'asc' });
  const { data, loading, error, refresh } = useAssetList(api, options);
  const [code, setCode] = useState('');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [searchError, setSearchError] = useState('');
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<Asset | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const codeInput = useRef<HTMLInputElement>(null);
  function sortBy(sort: Sort) {
    setOptions((previous) => ({
      ...previous,
      sort,
      order: previous.sort === sort && previous.order === 'asc' ? 'desc' : 'asc',
    }));
  }
  async function add(event: FormEvent) {
    event.preventDefault();
    if (adding) return;
    const normalized = normalizeCode(code);
    const invalid = validateCode(normalized);
    setAddError(invalid);
    setNotice('');
    if (invalid) {
      codeInput.current?.focus();
      return;
    }
    setAdding(true);
    try {
      const asset = await api.createAsset(normalized);
      setCode('');
      setNotice(
        asset.last_error_code === 'PRICE_DATA_STALE'
          ? `${asset.code}を追加しました。価格データが10日以上前のため、停止状態で登録しました。`
          : `${asset.code}を追加しました。登録時の価格から監視を開始します。`,
      );
      await refresh();
    } catch (err) {
      if (isCancelled(err)) return;
      setAddError(
        errorMessage(err) +
          (uncertainResult(err)
            ? ' 登録の成否が不明なため一覧を更新しました。確認してから再試行してください。'
            : ''),
      );
      if (uncertainResult(err)) await refresh();
    } finally {
      setAdding(false);
    }
    window.requestAnimationFrame(() => codeInput.current?.focus());
  }
  function search(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    if ([...q].length > 200) {
      setSearchError('検索文字列は200文字以内で入力してください。');
      return;
    }
    setSearchError('');
    if (q === options.q) void refresh();
    else setOptions((previous) => ({ ...previous, q }));
  }
  function markPending(id: string, busy: boolean) {
    setPending((previous) => {
      const next = new Set(previous);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  async function toggle(asset: Asset) {
    // 通信中の行操作は両ボタンのdisabledで止める。フォーム送信とは異なり別の入口はない。
    markPending(asset.id, true);
    setActionError('');
    setNotice('');
    try {
      await api.setMonitoring(asset.id, !asset.monitoring_enabled);
      setNotice(
        `${asset.code}の監視を${asset.monitoring_enabled ? '停止' : '再開'}しました。最高値と通知済み状態は保持されます。`,
      );
      await refresh();
    } catch (err) {
      if (isCancelled(err)) return;
      if (err instanceof ApiError && err.status === 404) {
        setActionError('対象は削除済みです。一覧を更新しました。');
        await refresh();
      } else {
        setActionError(
          errorMessage(err) +
            (uncertainResult(err) ? ' 一覧を更新して結果を確認してください。' : ''),
        );
        if (uncertainResult(err)) await refresh();
      }
    } finally {
      markPending(asset.id, false);
    }
  }
  async function remove() {
    if (!deleting) return;
    const asset = deleting;
    markPending(asset.id, true);
    setDeleteError('');
    setNotice('');
    try {
      await api.deleteAsset(asset.id);
      setDeleting(null);
      setNotice(`${asset.code}を削除しました。`);
      await refresh();
      codeInput.current?.focus();
    } catch (err) {
      if (isCancelled(err)) return;
      if (err instanceof ApiError && err.status === 404) {
        setDeleting(null);
        setActionError('対象は削除済みです。一覧を更新しました。');
        await refresh();
        codeInput.current?.focus();
      } else {
        setDeleteError(
          errorMessage(err) +
            (uncertainResult(err)
              ? ' 一覧を更新しました。対象の有無を確認してから再試行してください。'
              : ''),
        );
        if (uncertainResult(err)) await refresh();
      }
    } finally {
      markPending(asset.id, false);
    }
  }
  return (
    <>
      <Header />
      <main id="main" className="container">
        <PageTitle
          eyebrow="WATCHLIST"
          title="監視対象"
          description="株・指数の最高値からの下落を、LINEでお知らせします。"
        >
          <div className="schedule">
            <span>毎日の価格取得・通知判定</span>
            <strong>
              07:00 <span className="small">JST</span>
            </strong>
          </div>
        </PageTitle>
        <section className="card" aria-labelledby="add-heading">
          <div className="section-head">
            <h2 id="add-heading">株・指数を追加</h2>
            <span className="muted small">銘柄コードで登録</span>
          </div>
          <form className="form-row" noValidate onSubmit={(event) => void add(event)}>
            <div className="grow code-field">
              <label htmlFor="code-input">銘柄コード</label>
              <input
                ref={codeInput}
                id="code-input"
                name="code"
                placeholder="例：AAPL、^GSPC"
                autoComplete="off"
                spellCheck={false}
                required
                disabled={adding || (!data && loading)}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                aria-invalid={!!addError}
                aria-describedby={addError ? 'add-error' : undefined}
              />
            </div>
            <button className="primary" type="submit" disabled={adding || (!data && loading)}>
              {adding ? '取得中…' : '＋ 追加'}
            </button>
          </form>
          <p className="form-note">
            名称と価格を自動取得します。価格データが10日以上前なら、警告付きの停止状態で登録します。
          </p>
          <div id="add-error">
            <Alert>{addError}</Alert>
          </div>
        </section>
        <Alert success>{notice}</Alert>
        <Alert>{actionError}</Alert>
        {error && (
          <Alert>
            {data
              ? '一覧を更新できませんでした。直前の一覧を表示しています。'
              : '一覧を取得できませんでした。'}{' '}
            {error}{' '}
            <button type="button" onClick={() => void refresh()} disabled={loading}>
              再試行
            </button>
          </Alert>
        )}
        <section className="card table-card" aria-label="登録済みの監視対象">
          <div className="table-toolbar">
            <div className="count">
              <strong>{data?.total ?? '—'}</strong>件の監視対象
            </div>
            <div className="search-tools">
              <form className="form-row" onSubmit={search}>
                <div className="search-input">
                  <label htmlFor="search-input">検索</label>
                  <input
                    id="search-input"
                    name="q"
                    placeholder="コード・名称で検索"
                    type="search"
                    disabled={loading}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && event.nativeEvent.isComposing)
                        event.preventDefault();
                    }}
                    aria-invalid={!!searchError}
                    aria-describedby={searchError ? 'search-error' : undefined}
                  />
                </div>
                <button type="submit" disabled={loading}>
                  検索
                </button>
              </form>
              <div className="sort-field">
                <label htmlFor="sort-select">ソート項目</label>
                <select
                  id="sort-select"
                  disabled={loading}
                  value={options.sort}
                  onChange={(event) =>
                    setOptions((previous) => ({
                      ...previous,
                      sort: event.target.value as Sort,
                      order: 'asc',
                    }))
                  }
                >
                  {sortOptions.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                disabled={loading}
                aria-label={`並び順を${options.order === 'asc' ? '降順' : '昇順'}に変更`}
                onClick={() =>
                  setOptions((previous) => ({
                    ...previous,
                    order: previous.order === 'asc' ? 'desc' : 'asc',
                  }))
                }
              >
                {options.order === 'asc' ? '昇順 ↑' : '降順 ↓'}
              </button>
              <button type="button" disabled={loading} onClick={() => void refresh()}>
                一覧更新
              </button>
            </div>
          </div>
          <div id="search-error">
            <Alert>{searchError}</Alert>
          </div>
          {loading && (
            <div className="empty" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              監視対象を読み込んでいます…
            </div>
          )}
          {!loading && data?.items.length === 0 && (
            <div className="empty">
              <h2>{options.q ? '一致する監視対象がありません' : '監視対象がまだありません'}</h2>
              <p>
                {options.q
                  ? '検索語を変更するか、空欄で検索して絞り込みを解除してください。'
                  : '銘柄コードを入力して、最初の株・指数を追加してください。'}
              </p>
              {options.q && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setOptions((previous) => ({ ...previous, q: '' }));
                  }}
                >
                  検索を解除
                </button>
              )}
            </div>
          )}
          {!!data?.items.length && (
            <div
              className="table-scroll"
              role="region"
              aria-label="監視対象一覧・横にスクロールできます"
              tabIndex={0}
              aria-busy={loading}
            >
              <table>
                <thead>
                  <tr>
                    {columns.map(([sort, label, css]) => (
                      <th
                        key={sort}
                        scope="col"
                        className={css}
                        aria-sort={
                          options.sort === sort
                            ? options.order === 'asc'
                              ? 'ascending'
                              : 'descending'
                            : 'none'
                        }
                      >
                        <button type="button" disabled={loading} onClick={() => sortBy(sort)}>
                          {label}
                        </button>
                      </th>
                    ))}
                    <th scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((asset) => (
                    <tr key={asset.id}>
                      <td>
                        <div className="asset-code">{asset.code}</div>
                        <div className="asset-name">{asset.name}</div>
                        {asset.last_error_code && (
                          <div className="row-error">
                            {errorLabels[asset.last_error_code]} · 確認{' '}
                            {formatDate(asset.last_checked_at)}
                          </div>
                        )}
                      </td>
                      <td className="num price">{formatPrice(asset.highest_value)}</td>
                      <td className="num price">{formatPrice(asset.latest_value)}</td>
                      <td className="num loss">{asset.decline_rate}%</td>
                      <td className="date">{formatDate(asset.latest_fetched_at)}</td>
                      <td>
                        <span className={`badge ${asset.monitoring_enabled ? 'active' : 'paused'}`}>
                          {asset.monitoring_enabled ? '監視中' : '停止中'}
                        </span>
                      </td>
                      <td className="num">
                        {asset.last_notified_threshold === null
                          ? '未通知'
                          : `${asset.last_notified_threshold}%`}
                      </td>
                      <td>
                        <div className="actions">
                          <button
                            type="button"
                            disabled={pending.has(asset.id)}
                            aria-label={`${asset.code}の監視を${asset.monitoring_enabled ? '停止' : '再開'}`}
                            onClick={() => void toggle(asset)}
                          >
                            {asset.monitoring_enabled ? '停止' : '再開'}
                          </button>
                          <button
                            className="danger"
                            type="button"
                            disabled={pending.has(asset.id)}
                            aria-label={`${asset.code}を削除`}
                            onClick={() => {
                              setDeleting(asset);
                              setDeleteError('');
                            }}
                          >
                            削除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="table-foot">
            最高値は登録時と鮮度確認を通過した毎日の取得値から計算します。取得：毎日07:00
            JST。停止中は価格と通知済み状態を保持します。
          </div>
        </section>
        <p className="form-note">
          日次の監視処理中は停止・再開・削除を避けてください。再開時に価格取得・通知は行いませんが、実行中の停止→再開では同じ実行で通知されることがあります。
        </p>
        <Footer>価格は最終取得時点の値です。一覧更新では価格を再取得しません。</Footer>
        <ConfirmDialog
          open={!!deleting}
          title="監視対象を削除しますか？"
          confirmLabel="削除する"
          busy={!!deleting && pending.has(deleting.id)}
          error={deleteError}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void remove()}
        >
          <div className="dialog-target">
            {deleting?.code} · {deleting?.name}
          </div>
          <p className="muted">
            再登録時は最高値と通知済み状態が新しくなります。この操作は取り消せません。
          </p>
        </ConfirmDialog>
      </main>
    </>
  );
}
