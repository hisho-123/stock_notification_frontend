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
      admin_id: ' owner ',
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
