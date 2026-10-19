import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './auth';
import { session } from '../tests/fixtures';
import { deferred, response } from '../tests/helpers';

afterEach(() => vi.useRealTimers());
it('Providerなしの利用は設定漏れとして失敗する', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(() => renderHook(useAuth)).toThrow('AuthProvider is required');
});
it('セッション復元・ログイン・ログアウトで認証状態を更新する', async () => {
  const fetch = vi.fn().mockImplementation(async () => response(session));
  vi.stubGlobal('fetch', fetch);
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  expect(result.current.state.status).toBe('checking');
  await waitFor(() => expect(result.current.state.status).toBe('authenticated'));
  fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await act(() => result.current.logout());
  expect(result.current.state.status).toBe('guest');
  await act(() => result.current.login('owner', 'pass'));
  expect(result.current.state).toEqual({ status: 'authenticated', session });
});
it.each([401, 503])('初期確認のHTTP %sを未認証または再試行可能な失敗にする', async (status) => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response({}, status))
    .mockResolvedValue(response(session));
  vi.stubGlobal('fetch', fetch);
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.state.status).toBe(status === 401 ? 'guest' : 'error'));
  await act(() => result.current.check());
  expect(result.current.state.status).toBe('authenticated');
});
it.each([401, 503])(
  'ログアウトのHTTP %sは失効または編集保持のための失敗として扱う',
  async (status) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response({}, status));
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.state.status).toBe('authenticated'));
    await act(async () => {
      if (status === 503) await expect(result.current.logout()).rejects.toMatchObject({ status });
      else await result.current.logout();
    });
    expect(result.current.state.status).toBe(status === 401 ? 'guest' : 'authenticated');
  },
);
it('有効期限ちょうどで認証を破棄する', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        response({ ...session, expires_at: new Date(Date.now() + 1000).toISOString() }),
      ),
  );
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await act(async () => {});
  expect(result.current.state.status).toBe('authenticated');
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(result.current.state.status).toBe('guest');
});
it.each(['success', 'failure'] as const)(
  '取消済みの確認要求が%sになっても状態を変更しない',
  async (outcome) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(session)));
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.state.status).toBe('authenticated'));
    const pending = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);
    const controller = new AbortController();
    let check!: Promise<void>;
    act(() => {
      check = result.current.check(controller.signal);
    });
    controller.abort();
    await act(async () => {
      if (outcome === 'success') pending.resolve(response(session));
      else pending.reject(new Error('offline'));
      await check;
    });
    expect(result.current.state.status).toBe('checking');
  },
);

it('登録成功後に届く旧ユーザーの初回確認やログイン結果を採用しない', async () => {
  const pending = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(pending.promise));
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  const newSession = { ...session, login_id: 'new-user', csrf_token: 'new-token' };
  act(() => result.current.acceptSession(newSession));
  await act(() => pending.resolve(response(session)));
  expect(result.current.state).toEqual({ status: 'authenticated', session: newSession });
  const login = deferred<typeof session>();
  vi.spyOn(result.current.api, 'login').mockReturnValueOnce(login.promise);
  let loggingIn!: Promise<void>;
  act(() => {
    loggingIn = result.current.login('owner', 'test-password');
  });
  act(() => result.current.acceptSession(newSession));
  await act(async () => {
    login.resolve(session);
    await loggingIn;
  });
  expect(result.current.state).toEqual({ status: 'authenticated', session: newSession });
});
it.each(['resolved', 'cancelled', 'unauthorized'] as const)(
  '初回確認の新しい要求・取消・401を個別に扱う: %s',
  async (outcome) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(session)));
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.state.status).toBe('authenticated'));
    const pending = deferred<typeof session>();
    vi.spyOn(result.current.api, 'session').mockReturnValueOnce(pending.promise);
    let checking!: Promise<void>;
    act(() => {
      checking = result.current.check();
    });
    if (outcome === 'resolved') {
      act(() => result.current.acceptSession({ ...session, login_id: 'new-user' }));
      await act(async () => {
        pending.resolve(session);
        await checking;
      });
      expect(result.current.state).toMatchObject({ session: { login_id: 'new-user' } });
    } else {
      const { ApiError } = await import('./api');
      await act(async () => {
        pending.reject(
          outcome === 'cancelled'
            ? new DOMException('cancel', 'AbortError')
            : new ApiError(401, 'UNAUTHENTICATED', '期限切れ'),
        );
        await checking;
      });
      expect(result.current.state.status).toBe(outcome === 'cancelled' ? 'checking' : 'guest');
    }
  },
);
