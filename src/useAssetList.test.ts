import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from './api';
import { useAssetList } from './useAssetList';
import type { AssetList, ListOptions } from './types';
import { assets } from '../tests/fixtures';

it('遅い古い要求を取消し、応答が届いても新しい検索結果を上書きしない', async () => {
  const api = new ApiClient();
  let oldResolve!: (value: AssetList) => void;
  const spy = vi
    .spyOn(api, 'assets')
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          oldResolve = resolve;
        }),
    )
    .mockResolvedValueOnce({ items: [assets[1]], total: 1 });
  const initial: ListOptions = { q: '', sort: 'created_at', order: 'asc' };
  const { result, rerender } = renderHook((options) => useAssetList(api, options), {
    initialProps: initial,
  });
  rerender({ ...initial, q: 'AAPL' });
  await waitFor(() => expect(result.current.data?.items[0].code).toBe('AAPL'));
  expect(spy.mock.calls[0][1]?.aborted).toBe(true);
  await act(async () => oldResolve({ items: assets, total: assets.length }));
  expect(result.current.data?.total).toBe(1);
});

it('再取得失敗時に直前の一覧を残し、再試行で復旧する', async () => {
  const api = new ApiClient();
  vi.spyOn(api, 'assets')
    .mockResolvedValueOnce({ items: assets, total: assets.length })
    .mockRejectedValueOnce(new ApiError(503, 'SERVICE_UNAVAILABLE', '通信失敗'))
    .mockResolvedValueOnce({ items: [], total: 0 });
  const { result } = renderHook(() =>
    useAssetList(api, { q: '', sort: 'created_at', order: 'asc' }),
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(() => result.current.refresh());
  expect(result.current.data?.items).toEqual(assets);
  expect(result.current.error).toBe('通信失敗');
  await act(() => result.current.refresh());
  expect(result.current.data?.total).toBe(0);
  expect(result.current.error).toBe('');
});

it('取消済みの古い要求が失敗しても、新しい結果をエラーで上書きしない', async () => {
  const api = new ApiClient();
  let rejectOld!: (error: unknown) => void;
  vi.spyOn(api, 'assets')
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectOld = reject;
        }),
    )
    .mockResolvedValueOnce({ items: [], total: 0 });
  const initial: ListOptions = { q: '', sort: 'created_at', order: 'asc' };
  const { result, rerender } = renderHook((options) => useAssetList(api, options), {
    initialProps: initial,
  });
  rerender({ ...initial, q: 'new' });
  await waitFor(() => expect(result.current.data?.total).toBe(0));
  await act(async () => rejectOld(new Error('old request')));
  expect(result.current.error).toBe('');
  expect(result.current.loading).toBe(false);
});
