// E2E専用。実際のDB・価格提供サービス・LINEへは接続しない。
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import {
  assets as initialAssets,
  settings as initialSettings,
  session as initialSession,
} from './fixtures.ts';

const origin = 'https://localhost:5173';
let items, settings, options, sessions, requests;
function reset() {
  items = structuredClone(initialAssets);
  settings = structuredClone(initialSettings);
  sessions = new Set();
  requests = [];
  options = {};
}
reset();
function json(res, status, value, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(value === undefined ? undefined : JSON.stringify(value));
}
function fail(res, status, code, message, headers) {
  json(res, status, { error: { code, message, fields: {} } }, headers);
}
function consume(key) {
  if (options[key] > 0) {
    options[key]--;
    return true;
  }
  return false;
}
function cookies(value, maxAge = 86400) {
  return [
    `__Host-stock_session=${value}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`,
    `__Host-stock_csrf=${initialSession.csrf_token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`,
  ];
}
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1:18080');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    if (url.pathname === '/__test/health') return json(res, 200, { ok: true });
    if (url.pathname === '/__test/reset') {
      reset();
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/__test/config') {
      Object.assign(options, body);
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/__test/requests') return json(res, 200, requests);
    if (url.pathname === '/__test/expire') {
      sessions.clear();
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/__test/state') return json(res, 200, { items, settings });
    const token = /(?:^|;\s*)__Host-stock_session=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    const csrfCookie = /(?:^|;\s*)__Host-stock_csrf=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    const modifies = req.method !== 'GET';
    requests.push({
      method: req.method,
      path: url.pathname,
      query: url.search,
      origin: req.headers.origin,
      csrf: !!req.headers['x-csrf-token'],
      cookie: !!token,
      body: url.pathname.endsWith('/login') ? undefined : body,
    });
    if (modifies && req.headers.origin !== origin)
      return fail(res, 403, 'CSRF_FAILED', '要求元を確認できませんでした。');
    if (url.pathname === '/api/v1/auth/login') {
      if (consume('loginLimited'))
        return fail(res, 429, 'TOO_MANY_ATTEMPTS', '時間をおいて再試行してください。', {
          'Retry-After': '2',
        });
      if (body?.admin_id !== 'owner' || body?.password !== 'test-password')
        return fail(res, 401, 'INVALID_CREDENTIALS', 'IDまたはパスワードが違います。');
      const value = randomBytes(24).toString('hex');
      sessions.add(value);
      return json(
        res,
        200,
        { ...initialSession, expires_at: new Date(Date.now() + 86400000).toISOString() },
        { 'Set-Cookie': cookies(value) },
      );
    }
    if (url.pathname === '/api/v1/auth/session' && consume('sessionFailures'))
      return fail(res, 503, 'SERVICE_UNAVAILABLE', 'セッションを取得できません。');
    if (!token || !sessions.has(token) || csrfCookie !== initialSession.csrf_token)
      return fail(res, 401, 'UNAUTHENTICATED', 'ログインしてください。');
    if (modifies && req.headers['x-csrf-token'] !== initialSession.csrf_token)
      return fail(res, 403, 'CSRF_FAILED', '認証トークンを確認できませんでした。');
    if (url.pathname === '/api/v1/auth/session')
      return json(res, 200, {
        ...initialSession,
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      });
    if (url.pathname === '/api/v1/auth/logout') {
      if (raw) return fail(res, 400, 'VALIDATION_ERROR', '本文は指定できません。');
      if (consume('logoutFailures'))
        return fail(res, 503, 'SERVICE_UNAVAILABLE', 'ログアウトできませんでした。');
      sessions.delete(token);
      return json(res, 204, undefined, { 'Set-Cookie': cookies('', 0) });
    }
    if (url.pathname === '/api/v1/assets' && req.method === 'GET') {
      if (consume('listFailures'))
        return fail(res, 503, 'SERVICE_UNAVAILABLE', '一覧を取得できません。');
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const sort = url.searchParams.get('sort') ?? 'created_at';
      const order = url.searchParams.get('order') === 'desc' ? -1 : 1;
      const filtered = items.filter(
        (a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q),
      );
      filtered.sort((a, b) => {
        if (a[sort] === null || b[sort] === null)
          return a[sort] === b[sort] ? 0 : a[sort] === null ? 1 : -1;
        const numeric = [
          'highest_value',
          'latest_value',
          'decline_rate',
          'last_notified_threshold',
          'monitoring_enabled',
        ].includes(sort);
        const comparison = numeric
          ? Number(a[sort]) - Number(b[sort])
          : String(a[sort]).localeCompare(String(b[sort]));
        return comparison * order || (BigInt(a.id) < BigInt(b.id) ? -1 : 1);
      });
      return json(res, 200, { items: filtered, total: filtered.length });
    }
    if (url.pathname === '/api/v1/assets' && req.method === 'POST') {
      const code = body.code;
      if (items.some((a) => a.code === code))
        return fail(res, 409, 'ASSET_ALREADY_EXISTS', 'この銘柄は登録済みです。');
      if (code === 'NOPE')
        return fail(res, 422, 'SYMBOL_UNAVAILABLE', 'このコードの価格を取得できません。');
      if (code === 'PROVIDER')
        return fail(
          res,
          502,
          'PRICE_PROVIDER_ERROR',
          '価格提供サービスから有効な価格を取得できません。',
        );
      if (code === 'TIMEOUT')
        return fail(res, 504, 'PRICE_PROVIDER_TIMEOUT', '価格取得がタイムアウトしました。');
      const timestamp = new Date().toISOString();
      const asset = {
        ...initialAssets[0],
        id: String(
          BigInt(items.reduce((max, a) => (BigInt(a.id) > BigInt(max) ? a.id : max), '0')) + 1n,
        ),
        code,
        name: code === 'TSLA' ? 'Tesla, Inc.' : code,
        highest_value: '300',
        latest_value: '300',
        decline_rate: '0.00',
        monitoring_enabled: code !== 'STALE',
        last_error_code: code === 'STALE' ? 'PRICE_DATA_STALE' : null,
        last_notified_threshold: null,
        latest_fetched_at: timestamp,
        last_checked_at: timestamp,
        created_at: timestamp,
        updated_at: timestamp,
      };
      items.push(asset);
      if (consume('createDisconnects')) return res.destroy();
      return json(res, 201, asset);
    }
    if (/^\/api\/v1\/assets\/\d+$/.test(url.pathname)) {
      const id = url.pathname.split('/').at(-1);
      const asset = items.find((a) => a.id === id);
      if (!asset || consume('rowMissing')) {
        items = items.filter((a) => a.id !== id);
        return fail(res, 404, 'ASSET_NOT_FOUND', '監視対象が見つかりません。');
      }
      if (req.method === 'PATCH') {
        asset.monitoring_enabled = body.monitoring_enabled;
        return json(res, 200, asset);
      }
      if (req.method === 'DELETE') {
        if (raw) return fail(res, 400, 'VALIDATION_ERROR', '本文は指定できません。');
        if (consume('deleteFailures'))
          return fail(res, 503, 'SERVICE_UNAVAILABLE', '削除できませんでした。');
        items = items.filter((a) => a.id !== id);
        return json(res, 204);
      }
    }
    if (url.pathname === '/api/v1/settings/notifications') {
      if (req.method === 'GET') {
        if (consume('settingsFailures'))
          return fail(res, 503, 'SERVICE_UNAVAILABLE', '設定を取得できません。');
        return json(res, 200, settings);
      }
      if (req.method === 'PUT') {
        if (consume('saveFailures'))
          return fail(res, 403, 'CSRF_FAILED', '認証トークンを確認できませんでした。');
        settings = {
          thresholds: [...body.thresholds].sort((a, b) => a - b),
          updated_at: new Date().toISOString(),
        };
        if (consume('saveDisconnects')) return res.destroy();
        return json(res, 200, settings);
      }
    }
    return fail(res, 404, 'NOT_FOUND', '対象がありません。');
  })
  .listen(18080, '127.0.0.1');
