import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import { useAuth } from '../auth';
import { ApiError } from '../api';
import { settings } from '../../tests/fixtures';
import { authMock, deferred, renderPage } from '../../tests/helpers';
import type { NotificationSettings } from '../types';

vi.mock('../auth', () => ({ useAuth: vi.fn() }));
let auth: ReturnType<typeof authMock>;
beforeEach(() => {
  auth = authMock();
  vi.mocked(useAuth).mockReturnValue(auth);
  vi.spyOn(auth.api, 'settings').mockResolvedValue(settings);
  vi.spyOn(auth.api, 'saveSettings').mockResolvedValue(settings);
});
function mount() {
  return renderPage(<SettingsPage />, '/settings/notifications');
}
async function ready() {
  const view = mount();
  await screen.findByRole('button', { name: '10%を削除' });
  return view;
}
function add(raw = '35') {
  const input = screen.getByLabelText('通知率を追加（%）');
  fireEvent.change(input, { target: { value: raw } });
  fireEvent.submit(input.closest('form')!);
}
function save() {
  fireEvent.submit(screen.getByRole('button', { name: /設定を保存|保存中/ }).closest('form')!);
}
function logout() {
  fireEvent.click(screen.getByRole('button', { name: 'ログアウト' }));
}

it('読込中・未変更・空配列では送信せず、重複値を拒否する', async () => {
  const pending = deferred<NotificationSettings>();
  vi.mocked(auth.api.settings).mockReturnValueOnce(pending.promise);
  mount();
  add();
  save();
  expect(auth.api.saveSettings).not.toHaveBeenCalled();
  await act(() => pending.resolve(settings));
  save();
  add('10');
  expect(screen.getByRole('alert')).toHaveTextContent('追加済み');
  for (const value of settings.thresholds)
    fireEvent.click(screen.getByRole('button', { name: `${value}%を削除` }));
  expect(screen.getByText('通知率を1件以上追加してください。')).toBeVisible();
  save();
  expect(auth.api.saveSettings).not.toHaveBeenCalled();
  add('5');
  add('2');
  expect(screen.getByRole('button', { name: '2%を削除' })).toBeVisible();
});
it('保存中は再送とログアウトを抑止する', async () => {
  const pending = deferred<NotificationSettings>();
  vi.mocked(auth.api.saveSettings).mockReturnValueOnce(pending.promise);
  await ready();
  add();
  save();
  save();
  logout();
  expect(auth.api.saveSettings).toHaveBeenCalledTimes(1);
  expect(auth.logout).not.toHaveBeenCalled();
  await act(() => pending.resolve({ ...settings, thresholds: [...settings.thresholds, 35] }));
  expect(screen.getByRole('button', { name: '設定を保存' })).toBeDisabled();
});
it.each([true, false])('成否不明時の再取得が成功=%sでも編集値を保持する', async (success) => {
  await ready();
  add();
  vi.mocked(auth.api.saveSettings).mockRejectedValueOnce(new ApiError(503, 'FAIL', '不明'));
  if (success)
    vi.mocked(auth.api.settings).mockResolvedValueOnce({
      ...settings,
      thresholds: [...settings.thresholds, 35],
    });
  else vi.mocked(auth.api.settings).mockRejectedValueOnce(new Error('offline'));
  save();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    success ? '保存済み設定を再取得' : '再取得にも失敗',
  );
  expect(screen.getByRole('button', { name: '35%を削除' })).toBeVisible();
});
it('未変更のログアウト失敗を画面に表示し、再試行できる', async () => {
  vi.mocked(auth.logout).mockRejectedValueOnce(new Error('offline'));
  await ready();
  logout();
  expect(await screen.findByRole('alert')).toHaveTextContent('通信に失敗');
  logout();
  await waitFor(() => expect(auth.logout).toHaveBeenCalledTimes(2));
});
it('未保存ログアウトを取消・失敗・再試行し、処理中は確認をロックする', async () => {
  await ready();
  add();
  logout();
  fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }));
  expect(auth.logout).not.toHaveBeenCalled();
  vi.mocked(auth.logout).mockRejectedValueOnce(new Error('offline'));
  logout();
  fireEvent.click(screen.getByRole('button', { name: '破棄してログアウト' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('通信に失敗');
  const pending = deferred<void>();
  vi.mocked(auth.logout).mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getByRole('button', { name: '破棄してログアウト' }));
  expect(screen.getByRole('button', { name: '処理中…' })).toBeDisabled();
  await act(() => pending.resolve());
  expect(auth.logout).toHaveBeenCalledTimes(2);
});
it('未保存の再読み込みだけを防ぎ、保存後は遷移保留を解除する', async () => {
  const view = await ready();
  expect(fireEvent(window, new Event('beforeunload', { cancelable: true }))).toBe(true);
  add();
  expect(fireEvent(window, new Event('beforeunload', { cancelable: true }))).toBe(false);
  await act(async () => {
    void view.router.navigate('/assets');
  });
  expect(screen.getByRole('dialog')).toBeVisible();
  vi.mocked(auth.api.saveSettings).mockResolvedValueOnce({
    ...settings,
    thresholds: [...settings.thresholds, 35],
  });
  save();
  expect(await screen.findByRole('heading', { name: '移動先' })).toBeVisible();
});
it('未認証への変更後は未保存でも再読み込みを妨げない', async () => {
  const view = await ready();
  add();
  auth.state = { status: 'guest' };
  await act(() => view.router.navigate('/settings/notifications?expired'));
  expect(fireEvent(window, new Event('beforeunload', { cancelable: true }))).toBe(true);
});
it.each(['success', 'failure'] as const)(
  '画面破棄後の設定取得%sでは状態更新しない',
  async (outcome) => {
    const pending = deferred<NotificationSettings>();
    vi.mocked(auth.api.settings).mockReturnValueOnce(pending.promise);
    const view = mount();
    view.unmount();
    await act(async () => {
      if (outcome === 'success') pending.resolve(settings);
      else pending.reject(new Error('offline'));
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  },
);
it('閉じた確認の確定イベントは遷移もログアウトも起こさない', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '破棄して戻る', hidden: true }));
  expect(auth.logout).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: '通知設定' })).toBeVisible();
});
it.each(['load', 'save', 'logout'] as const)(
  'ユーザー切替で取消した%s操作からエラーや再取得を行わない',
  async (operation) => {
    const cancelled = new DOMException('session replaced', 'AbortError');
    if (operation === 'load') {
      vi.mocked(auth.api.settings).mockRejectedValueOnce(cancelled);
      mount();
    } else {
      await ready();
      if (operation === 'save') {
        add();
        vi.mocked(auth.api.saveSettings).mockRejectedValueOnce(cancelled);
        save();
      } else {
        vi.mocked(auth.logout).mockRejectedValueOnce(cancelled);
        logout();
      }
    }
    await act(async () => {});
    expect(screen.queryByRole('alert')).toBeNull();
    expect(auth.api.settings).toHaveBeenCalledOnce();
  },
);
