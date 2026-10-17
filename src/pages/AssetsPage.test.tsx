import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AssetsPage } from './AssetsPage';
import { useAuth } from '../auth';
import { ApiError } from '../api';
import { assets } from '../../tests/fixtures';
import { authMock, deferred, renderPage } from '../../tests/helpers';
import type { Asset } from '../types';

vi.mock('../auth', () => ({ useAuth: vi.fn() }));
let auth: ReturnType<typeof authMock>;
beforeEach(() => {
  auth = authMock();
  vi.mocked(useAuth).mockReturnValue(auth);
  vi.spyOn(auth.api, 'assets').mockResolvedValue({ items: assets, total: assets.length });
});
async function mount() {
  const view = renderPage(<AssetsPage />);
  await screen.findByRole('button', { name: 'AAPLを削除' });
  return view;
}
function add(code: string) {
  const input = screen.getByLabelText('銘柄コード');
  fireEvent.change(input, { target: { value: code } });
  fireEvent.submit(input.closest('form')!);
}
function search(q: string) {
  const input = screen.getByLabelText('検索');
  fireEvent.change(input, { target: { value: q } });
  fireEvent.submit(input.closest('form')!);
}
it('初期取得失敗と空一覧を区別し、再試行できる', async () => {
  vi.mocked(auth.api.assets)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ items: [], total: 0 });
  renderPage(<AssetsPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('一覧を取得できません');
  fireEvent.click(screen.getByRole('button', { name: '再試行' }));
  expect(await screen.findByRole('heading', { name: '監視対象がまだありません' })).toBeVisible();
});
it('再取得失敗では直前一覧を保持し、全ソート・並び順・検索解除を操作できる', async () => {
  await mount();
  vi.mocked(auth.api.assets).mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: '一覧更新' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('直前の一覧');
  fireEvent.click(screen.getByRole('button', { name: '再試行' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  const order = () => screen.getByRole('button', { name: /並び順を/ });
  fireEvent.click(order());
  await waitFor(() => expect(order()).toHaveTextContent('降順'));
  fireEvent.click(order());
  await waitFor(() => expect(order()).toHaveTextContent('昇順'));
  fireEvent.change(screen.getByLabelText('ソート項目'), { target: { value: 'name' } });
  await waitFor(() =>
    expect(auth.api.assets).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: 'name' }),
      expect.any(AbortSignal),
    ),
  );
  for (let n = 0; n < 3; n++) {
    fireEvent.click(screen.getByRole('button', { name: '下落率' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '一覧更新' })).toBeEnabled());
  }
  search('x'.repeat(201));
  expect(screen.getByRole('alert')).toHaveTextContent('200文字');
  search('');
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  vi.mocked(auth.api.assets).mockResolvedValue({ items: [], total: 0 });
  search('missing');
  expect(
    await screen.findByRole('heading', { name: '一致する監視対象がありません' }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '検索を解除' }));
  expect(await screen.findByRole('heading', { name: '監視対象がまだありません' })).toBeVisible();
});
it('IME変換中のEnterだけを抑止する', async () => {
  await mount();
  const input = screen.getByLabelText('検索');
  expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(false);
  expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: false })).toBe(true);
  expect(fireEvent.keyDown(input, { key: 'a', isComposing: true })).toBe(true);
});
it('追加入力の検証・正規化・停止登録と処理中の重複送信を検証する', async () => {
  const pending = deferred<Asset>();
  const create = vi
    .spyOn(auth.api, 'createAsset')
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue({ ...assets[0], code: 'STALE', last_error_code: 'PRICE_DATA_STALE' });
  await mount();
  add(' ');
  expect(screen.getByLabelText('銘柄コード')).toHaveFocus();
  expect(create).not.toHaveBeenCalled();
  add(' tsla ');
  fireEvent.submit(screen.getByLabelText('銘柄コード').closest('form')!);
  expect(create).toHaveBeenCalledExactlyOnceWith('TSLA');
  await act(() => pending.resolve({ ...assets[0], code: 'TSLA' }));
  expect(screen.getByText(/TSLAを追加しました/)).toBeVisible();
  add('STALE');
  expect(await screen.findByText(/停止状態で登録しました/)).toBeVisible();
});
it.each([
  new ApiError(409, 'DUPLICATE', '重複'),
  new ApiError(0, 'NETWORK_ERROR', '通信断'),
  new Error('unexpected'),
])('追加失敗時は入力を保持し、成否不明時だけ再取得する: %s', async (error) => {
  vi.spyOn(auth.api, 'createAsset').mockRejectedValue(error);
  await mount();
  add('TSLA');
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(screen.getByLabelText('銘柄コード')).toHaveValue('TSLA');
  await waitFor(() => expect(screen.getByRole('button', { name: '＋ 追加' })).toBeEnabled());
  expect(auth.api.assets).toHaveBeenCalledTimes(
    error instanceof ApiError && error.status === 0 ? 2 : 1,
  );
});
it('停止・再開で通知し、処理後は行操作を再度許可する', async () => {
  vi.spyOn(auth.api, 'setMonitoring').mockResolvedValue(assets[0]);
  await mount();
  for (const name of ['^GSPCの監視を停止', 'AAPLの監視を再開']) {
    fireEvent.click(screen.getByRole('button', { name }));
    await waitFor(() => expect(screen.getByRole('button', { name })).toBeEnabled());
  }
  expect(screen.getByText(/AAPLの監視を再開しました/)).toBeVisible();
});

it('行操作の通信中は二度クリックしてもAPIを再送しない', async () => {
  const pending = deferred<Asset>();
  const change = vi.spyOn(auth.api, 'setMonitoring').mockReturnValueOnce(pending.promise);
  await mount();
  const button = screen.getByRole('button', { name: '^GSPCの監視を停止' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(change).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
  await act(() => pending.resolve(assets[0]));
  expect(button).toBeEnabled();
  const remove = deferred<void>();
  const deletion = vi.spyOn(auth.api, 'deleteAsset').mockReturnValueOnce(remove.promise);
  fireEvent.click(screen.getByRole('button', { name: 'AAPLを削除' }));
  const confirm = screen.getByRole('button', { name: '削除する' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(deletion).toHaveBeenCalledTimes(1);
  await act(() => remove.resolve());
});
it('削除対象がない確認イベントではAPIを送信しない', async () => {
  const remove = vi.spyOn(auth.api, 'deleteAsset');
  await mount();
  fireEvent.click(screen.getByRole('button', { name: '削除する', hidden: true }));
  expect(remove).not.toHaveBeenCalled();
});
it.each([
  new ApiError(404, 'MISSING', 'なし'),
  new ApiError(403, 'CSRF', '拒否'),
  new ApiError(503, 'FAIL', '失敗'),
  new Error('offline'),
])('監視変更失敗を表示し、404と成否不明時だけ再取得する: %s', async (error) => {
  vi.spyOn(auth.api, 'setMonitoring').mockRejectedValue(error);
  await mount();
  fireEvent.click(screen.getByRole('button', { name: '^GSPCの監視を停止' }));
  expect(await screen.findByRole('alert')).toBeVisible();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '^GSPCの監視を停止' })).toBeEnabled(),
  );
  expect(auth.api.assets).toHaveBeenCalledTimes(
    error instanceof ApiError && [404, 503].includes(error.status) ? 2 : 1,
  );
});
it('削除を取り消し、成功時にはダイアログを閉じて入力へ戻す', async () => {
  vi.spyOn(auth.api, 'deleteAsset').mockResolvedValue();
  await mount();
  const remove = () => fireEvent.click(screen.getByRole('button', { name: 'AAPLを削除' }));
  remove();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(auth.api.deleteAsset).not.toHaveBeenCalled();
  remove();
  fireEvent.click(screen.getByRole('button', { name: '削除する' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByLabelText('銘柄コード')).toHaveFocus();
});
it.each([
  new ApiError(404, 'MISSING', 'なし'),
  new ApiError(403, 'CSRF', '拒否'),
  new ApiError(503, 'FAIL', '失敗'),
  new Error('offline'),
])('削除の失敗を表示し、404では確認を閉じる: %s', async (error) => {
  vi.spyOn(auth.api, 'deleteAsset').mockRejectedValue(error);
  await mount();
  fireEvent.click(screen.getByRole('button', { name: 'AAPLを削除' }));
  fireEvent.click(screen.getByRole('button', { name: '削除する' }));
  expect(await screen.findByRole('alert')).toBeVisible();
  await waitFor(() =>
    expect(auth.api.assets).toHaveBeenCalledTimes(
      error instanceof ApiError && [404, 503].includes(error.status) ? 2 : 1,
    ),
  );
});
