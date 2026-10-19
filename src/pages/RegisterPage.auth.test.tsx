import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth';
import { router } from '../router';
import { session } from '../../tests/fixtures';
import { response } from '../../tests/helpers';

it.each(['other', 'failed'] as const)(
  '認証済み登録の成否不明=%sでローカル認証だけ破棄し、新IDのログインへ進める',
  async (outcome) => {
    let checks = 0;
    const newSession = { ...session, login_id: 'new-user', csrf_token: 'new-csrf' };
    const fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/auth/session')) {
        checks++;
        return checks > 1 && outcome === 'failed' ? response({}, 503) : response(session);
      }
      if (url.endsWith('/validate')) return response({ expires_at: session.expires_at });
      if (url.endsWith('/auth/register')) return response({}, 503);
      if (url.endsWith('/auth/login')) return response(newSession);
      return response({ items: [], total: 0 });
    });
    vi.stubGlobal('fetch', fetch);
    const memory = createMemoryRouter(router.routes, {
      initialEntries: [`/register#token=${'A'.repeat(43)}`],
    });
    const view = render(
      <AuthProvider>
        <RouterProvider router={memory} />
      </AuthProvider>,
    );
    await screen.findByText('登録後は新しいユーザーでログインします。');
    await waitFor(() => expect(screen.getByLabelText('ログインID')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('ログインID'), { target: { value: 'new-user' } });
    fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'new-password' } });
    fireEvent.submit(screen.getByRole('button', { name: '登録' }).closest('form')!);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('登録が完了している場合'),
    );
    expect(memory.state.location.pathname).toBe('/register');
    expect(screen.queryByRole('button', { name: 'ログアウト' })).toBeNull();
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/auth/logout'))).toHaveLength(0);
    fireEvent.click(screen.getByRole('link', { name: 'ログインへ' }));
    expect(await screen.findByRole('heading', { name: 'ログイン' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('ID'), { target: { value: 'new-user' } });
    fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'new-password' } });
    fireEvent.submit(screen.getByRole('button', { name: 'ログイン' }).closest('form')!);
    await screen.findByRole('heading', { name: '監視対象がまだありません' });
    expect(memory.state.location.pathname).toBe('/assets');
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/auth/register'))).toHaveLength(1);
    view.unmount();
    memory.dispose();
  },
);
