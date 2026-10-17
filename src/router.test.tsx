import { act, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { router } from './router';
import { useAuth } from './auth';
import { authMock } from '../tests/helpers';

vi.mock('./auth', () => ({ useAuth: vi.fn() }));
vi.mock('./pages/LoginPage', () => ({ LoginPage: () => <h1>ログイン先</h1> }));
vi.mock('./pages/AssetsPage', () => ({ AssetsPage: () => <h1>一覧先</h1> }));
vi.mock('./pages/SettingsPage', () => ({ SettingsPage: () => <h1>設定先</h1> }));
let auth: ReturnType<typeof authMock>;
let memory: ReturnType<typeof createMemoryRouter>;
beforeEach(() => {
  auth = authMock();
  vi.mocked(useAuth).mockReturnValue(auth);
});
afterEach(() => memory?.dispose());
function mount(path: string) {
  memory = createMemoryRouter(router.routes, { initialEntries: [path] });
  return render(<RouterProvider router={memory} />);
}
it.each([
  ['/', '一覧先'],
  ['/settings', '設定先'],
  ['/login', 'ログイン先'],
])('ルート%sを解決する', async (path, title) => {
  mount(path);
  expect(await screen.findByRole('heading', { name: title })).toBeVisible();
});
it('未認証では保護画面からログインへ戻る', async () => {
  auth.state = { status: 'guest' };
  mount('/assets');
  expect(await screen.findByRole('heading', { name: 'ログイン先' })).toBeVisible();
});
it('確認中・確認失敗・再試行の表示を切り替える', async () => {
  auth.state = { status: 'checking' };
  const view = mount('/assets');
  expect(screen.getByRole('status')).toHaveTextContent('確認しています');
  auth.state = { status: 'error', message: '再接続' };
  view.unmount();
  memory.dispose();
  mount('/assets');
  expect(screen.getByRole('alert')).toHaveTextContent('再接続');
  fireEvent.click(screen.getByRole('button', { name: '再試行' }));
  expect(auth.check).toHaveBeenCalledOnce();
  await act(async () => {});
});
it('未知のURLと描画失敗にはそれぞれ復旧先を表示する', async () => {
  const view = mount('/missing');
  expect(screen.getByRole('heading')).toHaveTextContent('ページが見つかりません');
  view.unmount();
  memory.dispose();
  function Broken(): never {
    throw new Error('render failed');
  }
  vi.spyOn(console, 'error').mockImplementation(() => {});
  memory = createMemoryRouter(
    [{ ...router.routes[0], index: false, children: [{ path: '/broken', element: <Broken /> }] }],
    { initialEntries: ['/broken'] },
  );
  render(<RouterProvider router={memory} />);
  expect(await screen.findByRole('heading', { name: '画面を表示できませんでした' })).toBeVisible();
  expect(screen.getByRole('link', { name: '監視対象へ' })).toHaveAttribute('href', '/assets');
});
