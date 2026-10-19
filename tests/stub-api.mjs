// E2E専用。実際のDB・価格提供サービス・LINEへは接続しない。
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  assets as initialAssets,
  settings as initialSettings,
  session as initialSession,
} from './fixtures.ts';

const origin = process.env.TEST_ORIGIN || 'https://localhost:5173';
let items, settings, options, sessions, requests, users, usedTokens;
function reset() {
  items = structuredClone(initialAssets);
  settings = structuredClone(initialSettings);
  sessions = new Map();
  users = new Map([
    ['owner', { password: 'test-password', items, settings }],
    [
      'other',
      { password: 'other-password', items: [], settings: structuredClone(initialSettings) },
    ],
  ]);
  usedTokens = new Set();
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
    if (url.pathname === '/__test/state')
      return json(res, 200, {
        items: users.get('owner').items,
        settings: users.get('owner').settings,
      });
    // 操作別の遅延で処理中のUIと重複送信防止を検証する。
    const operation = url.pathname.endsWith('/login')
      ? 'login'
      : url.pathname.endsWith('/validate')
        ? 'validate'
        : url.pathname.endsWith('/register')
          ? 'register'
          : url.pathname.endsWith('/logout')
            ? 'logout'
            : url.pathname.endsWith('/notifications')
              ? req.method === 'GET'
                ? 'settings'
                : 'save'
              : req.method === 'PATCH'
                ? 'toggle'
                : req.method === 'DELETE'
                  ? 'delete'
                  : req.method === 'POST'
                    ? 'create'
                    : 'list';
    if (options[`${operation}Delay`]) await delay(options[`${operation}Delay`]);
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
      body: /\/(login|register|validate)$/.test(url.pathname) ? undefined : body,
    });
    if (modifies && req.headers.origin !== origin)
      return fail(res, 403, 'CSRF_FAILED', '要求元を確認できませんでした。');
    if (url.pathname === '/api/v1/auth/login') {
      if (consume('loginLimited'))
        return fail(res, 429, 'TOO_MANY_ATTEMPTS', '時間をおいて再試行してください。', {
          'Retry-After': '2',
        });
      if (!users.has(body?.login_id) || users.get(body.login_id).password !== body?.password)
        return fail(res, 401, 'INVALID_CREDENTIALS', 'IDまたはパスワードが違います。');
      const value = randomBytes(24).toString('hex');
      if (token) sessions.delete(token);
      sessions.set(value, body.login_id);
      return json(
        res,
        200,
        {
          ...initialSession,
          login_id: body.login_id,
          expires_at: new Date(Date.now() + (options.sessionTtlMs || 86400000)).toISOString(),
        },
        { 'Set-Cookie': cookies(value) },
      );
    }
    if (['/api/v1/auth/registration/validate', '/api/v1/auth/register'].includes(url.pathname)) {
      if (consume(`${operation}Limited`))
        return fail(res, 429, 'TOO_MANY_ATTEMPTS', '時間をおいて再試行してください。', {
          'Retry-After': '2',
        });
      if (consume(`${operation}Failures`))
        return fail(res, 503, 'SERVICE_UNAVAILABLE', '確認できませんでした。');
      if (
        !/^[A-D]{43}$/.test(body?.registration_token ?? '') ||
        usedTokens.has(body.registration_token) ||
        consume(`${operation}Unavailable`)
      )
        return fail(res, 410, 'REGISTRATION_LINK_UNAVAILABLE', 'この登録URLは利用できません。');
      if (operation === 'validate')
        return json(res, 200, { expires_at: new Date(Date.now() + 86400000).toISOString() });
      if (users.has(body.login_id) || consume('registerConflicts'))
        return fail(res, 409, 'LOGIN_ID_ALREADY_EXISTS', 'このログインIDは使用されています。');
      if (
        typeof body.login_id !== 'string' ||
        [...body.login_id].length < 1 ||
        [...body.login_id].length > 100 ||
        typeof body.password !== 'string' ||
        Buffer.byteLength(body.password) < 8 ||
        Buffer.byteLength(body.password) > 72
      )
        return fail(res, 400, 'VALIDATION_ERROR', '入力内容を確認してください。');
      usedTokens.add(body.registration_token);
      users.set(body.login_id, {
        password: body.password,
        items: [],
        settings: structuredClone(initialSettings),
      });
      if (token) sessions.delete(token);
      const value = randomBytes(24).toString('hex');
      sessions.set(value, body.login_id);
      const session = {
        ...initialSession,
        login_id: body.login_id,
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      };
      // Set-Cookieまで到達して本文だけ失われた成功も再現する。
      if (consume('registerLostResponses'))
        return json(
          res,
          503,
          { error: { code: 'SERVICE_UNAVAILABLE', message: '結果を確認できません。', fields: {} } },
          { 'Set-Cookie': cookies(value) },
        );
      if (consume('registerDisconnects')) return res.destroy();
      return json(res, 201, session, { 'Set-Cookie': cookies(value) });
    }
    if (url.pathname === '/api/v1/auth/session' && consume('sessionFailures'))
      return fail(res, 503, 'SERVICE_UNAVAILABLE', 'セッションを取得できません。');
    if (!token || !sessions.has(token) || csrfCookie !== initialSession.csrf_token)
      return fail(res, 401, 'UNAUTHENTICATED', 'ログインしてください。');
    const loginId = sessions.get(token);
    const data = users.get(loginId);
    let { items, settings } = data;
    if (modifies && req.headers['x-csrf-token'] !== initialSession.csrf_token)
      return fail(res, 403, 'CSRF_FAILED', '認証トークンを確認できませんでした。');
    if (url.pathname === '/api/v1/auth/session')
      return json(res, 200, {
        ...initialSession,
        login_id: loginId,
        expires_at: new Date(Date.now() + (options.sessionTtlMs || 86400000)).toISOString(),
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
      const filtered = (options.emptyAssets ? [] : items).filter(
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
        data.items = items.filter((a) => a.id !== id);
        return fail(res, 404, 'ASSET_NOT_FOUND', '監視対象が見つかりません。');
      }
      if (req.method === 'PATCH') {
        if (consume('toggleFailures'))
          return fail(res, 403, 'CSRF_FAILED', '監視状態を変更できませんでした。');
        asset.monitoring_enabled = body.monitoring_enabled;
        if (consume('toggleDisconnects')) return res.destroy();
        return json(res, 200, asset);
      }
      if (req.method === 'DELETE') {
        if (raw) return fail(res, 400, 'VALIDATION_ERROR', '本文は指定できません。');
        if (consume('deleteFailures'))
          return fail(res, 503, 'SERVICE_UNAVAILABLE', '削除できませんでした。');
        if (consume('deleteForbidden'))
          return fail(res, 403, 'CSRF_FAILED', '削除を拒否しました。');
        data.items = items.filter((a) => a.id !== id);
        if (consume('deleteDisconnects')) return res.destroy();
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
        data.settings = settings = {
          thresholds: [...body.thresholds].sort((a, b) => a - b),
          updated_at: new Date().toISOString(),
        };
        if (consume('saveDisconnects')) return res.destroy();
        return json(res, 200, settings);
      }
    }
    return fail(res, 404, 'NOT_FOUND', '対象がありません。');
  })
  .listen(Number(process.env.E2E_API_PORT || 18080), '127.0.0.1');
