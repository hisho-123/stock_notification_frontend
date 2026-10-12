import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../auth';
import { SettingsPage } from './SettingsPage';
import { session, settings } from '../../tests/fixtures';

const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function mount(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  const router = createMemoryRouter(
    [
      { path: '/settings/notifications', element: <SettingsPage /> },
      { path: '/assets', element: <h1>一覧画面</h1> },
    ],
    { initialEntries: ['/settings/notifications'] },
  );
  function ReadyRouter() {
    const { state } = useAuth();
    return state.status === 'authenticated' ? <RouterProvider router={router} /> : null;
  }
  render(
    <AuthProvider>
      <ReadyRouter />
    </AuthProvider>,
  );
  return router;
}

describe('通知設定', () => {
  it('保存失敗後も編集を保持し、再保存で返却された配列・日時を反映する', async () => {
    const user = userEvent.setup();
    const mock = vi
      .fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response(settings))
      .mockResolvedValueOnce(
        response(
          { error: { code: 'CSRF_FAILED', message: 'トークンを確認できません。', fields: {} } },
          403,
        ),
      )
      .mockResolvedValueOnce(
        response({ thresholds: [10, 15, 20, 25, 30, 35], updated_at: '2026-10-09T22:00:00Z' }),
      );
    mount(mock);
    await screen.findByRole('button', { name: '10%を削除' });
    await user.type(screen.getByLabelText('通知率を追加（%）'), '35');
    await user.click(screen.getByRole('button', { name: '＋ 追加' }));
    await user.click(screen.getByRole('button', { name: '設定を保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('編集中の値を保持');
    expect(screen.getByRole('button', { name: '35%を削除' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '設定を保存' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '設定を保存' })).toBeDisabled());
    expect(screen.getByText('更新：2026/10/10 07:00 JST')).toBeInTheDocument();
    expect(JSON.parse(mock.mock.calls[3][1].body)).toEqual({
      thresholds: [10, 15, 20, 25, 30, 35],
    });
  });
  it('未保存で戻る操作は確認し、取消で保持、確定で遷移する', async () => {
    const user = userEvent.setup();
    mount(
      vi.fn().mockResolvedValueOnce(response(session)).mockResolvedValueOnce(response(settings)),
    );
    await screen.findByRole('button', { name: '10%を削除' });
    await user.click(screen.getByRole('button', { name: '10%を削除' }));
    await user.click(screen.getByRole('link', { name: '監視対象' }));
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByRole('button', { name: '編集を続ける' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '編集を続ける' }));
    expect(screen.queryByRole('button', { name: '10%を削除' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: '監視対象' }));
    await user.click(screen.getByRole('button', { name: '破棄して戻る' }));
    expect(await screen.findByRole('heading', { name: '一覧画面' })).toBeInTheDocument();
  });
  it('初期取得失敗で初期値を表示せず、再試行まで編集不可、ログアウトは常時表示する', async () => {
    const user = userEvent.setup();
    mount(
      vi
        .fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(
          response(
            { error: { code: 'SERVICE_UNAVAILABLE', message: '取得不可', fields: {} } },
            503,
          ),
        )
        .mockResolvedValueOnce(response(settings)),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('設定を取得できません');
    expect(screen.queryByRole('button', { name: '10%を削除' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('通知率を追加（%）')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'ログアウト' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '再試行' }));
    expect(await screen.findByRole('button', { name: '10%を削除' })).toBeEnabled();
  });
});
