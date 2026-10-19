import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, uncertainResult } from './api';
import { session, assets, settings } from '../tests/fixtures';

describe('APIクライアント', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  const json = (value: unknown, status = 200, headers = {}) =>
    new Response(JSON.stringify(value), { status, headers });
  it('全9操作のパス・型とCookie/CSRF・本文なしの204を扱う', async () => {
    const api = new ApiClient();
    fetchMock.mockResolvedValueOnce(json(session));
    await api.login(' owner ', ' pass ');
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({
      login_id: ' owner ',
      password: ' pass ',
    });
    expect(new Headers(fetchMock.mock.calls[0][1]!.headers).has('X-CSRF-Token')).toBe(false);
    fetchMock.mockResolvedValueOnce(json(session));
    await api.session();
    api.setSession(session);
    fetchMock.mockResolvedValueOnce(json({ items: assets, total: assets.length }));
    const list = await api.assets({ q: '%_', sort: 'highest_value', order: 'desc' });
    expect(list.items[0].id).toBe('9007199254740993');
    expect(fetchMock.mock.calls[2][0]).toBe('/api/v1/assets?q=%25_&sort=highest_value&order=desc');
    fetchMock.mockResolvedValueOnce(json(assets[0], 201));
    await api.createAsset('AAPL');
    fetchMock.mockResolvedValueOnce(json(assets[0]));
    await api.setMonitoring(assets[0].id, false);
    expect(fetchMock.mock.calls[4][0]).toBe('/api/v1/assets/9007199254740993');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await api.deleteAsset('2');
    fetchMock.mockResolvedValueOnce(json(settings));
    await api.settings();
    fetchMock.mockResolvedValueOnce(json(settings));
    await api.saveSettings([30, 10]);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await api.logout();
    for (const index of [3, 4, 5, 7, 8]) {
      expect(new Headers(fetchMock.mock.calls[index][1]!.headers).get('X-CSRF-Token')).toBe(
        session.csrf_token,
      );
    }
    for (const index of [5, 8]) {
      expect(fetchMock.mock.calls[index][1]!.body).toBeUndefined();
      expect(new Headers(fetchMock.mock.calls[index][1]!.headers).has('Content-Type')).toBe(false);
    }
    for (const [, options] of fetchMock.mock.calls)
      expect(options).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });
  });
  it('ログイン不一致は期限切れと区別し、その他の401ではトークンを破棄する', async () => {
    const api = new ApiClient();
    const unauthorized = vi.fn();
    api.onUnauthorized = unauthorized;
    fetchMock.mockResolvedValueOnce(
      json({ error: { code: 'INVALID_CREDENTIALS', message: '不一致', fields: {} } }, 401),
    );
    await expect(api.login('owner', 'wrong')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(unauthorized).not.toHaveBeenCalled();
    api.setSession(session);
    fetchMock.mockResolvedValueOnce(
      json(
        { error: { code: 'UNAUTHENTICATED', message: 'ログインしてください。', fields: {} } },
        401,
      ),
    );
    await expect(api.settings()).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toHaveBeenCalledOnce();
    fetchMock.mockResolvedValueOnce(json(assets[0]));
    await api.createAsset('AAPL');
    expect(new Headers(fetchMock.mock.calls[2][1]!.headers).has('X-CSRF-Token')).toBe(false);
  });
  it('403・429・503と項目別エラーを保持し、書き込みを自動再送しない', async () => {
    const api = new ApiClient();
    for (const status of [403, 429, 503]) {
      fetchMock.mockResolvedValueOnce(
        json(
          { error: { code: 'ERROR', message: '説明', fields: { code: '入力エラー' } } },
          status,
          { 'Retry-After': '3' },
        ),
      );
      await expect(api.createAsset('AAPL')).rejects.toMatchObject({
        status,
        fields: { code: '入力エラー' },
        retryAfter: 3,
      });
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('通信断・非JSON・不正JSON応答を安全なエラーにし、取消はそのまま伝える', async () => {
    const api = new ApiClient();
    fetchMock.mockRejectedValueOnce(new TypeError('private endpoint'));
    await expect(api.createAsset('AAPL')).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
    });
    fetchMock.mockResolvedValueOnce(new Response('<html>private details</html>', { status: 502 }));
    await expect(api.settings()).rejects.toMatchObject({ status: 502, code: 'HTTP_ERROR' });
    fetchMock.mockResolvedValueOnce(new Response('invalid', { status: 200 }));
    await expect(api.settings()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    const abort = new DOMException('cancel', 'AbortError');
    fetchMock.mockRejectedValueOnce(abort);
    await expect(api.settings()).rejects.toBe(abort);
    expect(uncertainResult(new ApiError(503, '', ''))).toBe(true);
    expect(uncertainResult(new ApiError(502, 'HTTP_ERROR', ''))).toBe(true);
    expect(uncertainResult(new ApiError(502, 'PRICE_PROVIDER_ERROR', ''))).toBe(false);
    expect(uncertainResult(new ApiError(409, '', ''))).toBe(false);
  });
});

it('公開登録APIは認証中でもCSRFを送らず、初回セッション復元と並行できる', async () => {
  const api = new ApiClient();
  const token = 'A'.repeat(43);
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>((done) => {
    resolve = done;
  });
  const fetch = vi
    .fn()
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce(new Response(JSON.stringify(session), { status: 201 }));
  vi.stubGlobal('fetch', fetch);
  const validate = api.validateRegistration(token);
  api.setSession(session);
  resolve(new Response(JSON.stringify({ expires_at: session.expires_at })));
  await expect(validate).resolves.toEqual({ expires_at: session.expires_at });
  await api.register(token, ' new-user ', ' password ');
  for (const [, options] of fetch.mock.calls)
    expect(new Headers(options.headers).has('X-CSRF-Token')).toBe(false);
  expect(fetch.mock.calls[0][0]).toBe('/api/v1/auth/registration/validate');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ registration_token: token });
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
    registration_token: token,
    login_id: ' new-user ',
    password: ' password ',
  });
});
it.each([200, 401, 204])(
  'セッション切替前の遅延応答 HTTP %s を取消し、旧401で新ログインを失効しない',
  async (status) => {
    const api = new ApiClient();
    const unauthorized = vi.fn();
    api.onUnauthorized = unauthorized;
    api.setSession(session);
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const pending = status === 204 ? api.deleteAsset('1') : api.settings();
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    api.setSession({ ...session, login_id: 'new-user', csrf_token: 'new-csrf' });
    finish(status === 204 ? new Response(null, { status }) : new Response('{}', { status }));
    await rejected;
    expect(unauthorized).not.toHaveBeenCalled();
  },
);
it.each([200, 401])('本文読込中のユーザー切替でも遅延HTTP %sを採用しない', async (status) => {
  const api = new ApiClient();
  const unauthorized = vi.fn();
  api.onUnauthorized = unauthorized;
  let finish!: (body: object) => void;
  const body = new Promise<object>((resolve) => {
    finish = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({ ok: status === 200, status, headers: new Headers(), json: () => body }),
  );
  const pending = api.settings();
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await Promise.resolve();
  api.setSession({ ...session, login_id: 'new-user' });
  finish({});
  await rejected;
  expect(unauthorized).not.toHaveBeenCalled();
});
it('ユーザー切替で中断した通信失敗は取消として伝え、成否不明の再取得を誘発しない', async () => {
  const api = new ApiClient();
  let fail!: (reason: unknown) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementationOnce(
      () =>
        new Promise<Response>((_, reject) => {
          fail = reject;
        }),
    ),
  );
  const pending = api.createAsset('AAPL');
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  api.setSession({ ...session, login_id: 'new-user' });
  fail(new TypeError('connection lost'));
  await rejected;
});
