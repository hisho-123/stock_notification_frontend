import type {
  Asset,
  AssetList,
  ErrorResponse,
  ListOptions,
  NotificationSettings,
  Session,
} from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
    public retryAfter = 0,
  ) {
    super(message);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : '通信に失敗しました。接続を確認して再試行してください。';
}
export function uncertainResult(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    ([0, 500, 503].includes(error.status) || (error.code === 'HTTP_ERROR' && error.status >= 500))
  );
}

export class ApiClient {
  private csrfToken: string | null = null;
  onUnauthorized: () => void = () => {};

  clearSession() {
    this.csrfToken = null;
  }
  setSession(session: Session) {
    this.csrfToken = session.csrf_token;
  }

  // 全公開操作がoptionsを指定するため、呼出不能な既定引数は設けない。
  private async request<T>(path: string, options: RequestInit): Promise<T> {
    const method = options.method ?? 'GET';
    const headers = new Headers({ Accept: 'application/json' });
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (method !== 'GET' && path !== '/auth/login' && this.csrfToken) {
      headers.set('X-CSRF-Token', this.csrfToken);
    }
    let response: Response;
    try {
      response = await fetch(`/api/v1${path}`, {
        ...options,
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } catch (error) {
      if (
        options.signal?.aborted ||
        (typeof error === 'object' &&
          error !== null &&
          'name' in error &&
          error.name === 'AbortError')
      )
        throw error;
      throw new ApiError(
        0,
        'NETWORK_ERROR',
        '通信に失敗しました。接続を確認して再試行してください。',
      );
    }
    if (response.status === 401 && path !== '/auth/login') {
      this.clearSession();
      this.onUnauthorized();
    }
    if (!response.ok) {
      let payload: ErrorResponse | undefined;
      try {
        payload = (await response.json()) as ErrorResponse;
      } catch {
        /* プロキシ等の非JSONエラー */
      }
      const seconds = Number(response.headers.get('Retry-After'));
      throw new ApiError(
        response.status,
        payload?.error?.code ?? 'HTTP_ERROR',
        payload?.error?.message ??
          '処理を完了できませんでした。接続先を確認して再試行してください。',
        payload?.error?.fields ?? {},
        Number.isFinite(seconds) && seconds > 0 ? seconds : 900,
      );
    }
    if (response.status === 204) return undefined as T;
    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError(
        0,
        'INVALID_RESPONSE',
        '応答を確認できませんでした。再取得して確認してください。',
      );
    }
  }

  session(signal?: AbortSignal) {
    return this.request<Session>('/auth/session', { signal });
  }
  login(admin_id: string, password: string) {
    return this.request<Session>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ admin_id, password }),
    });
  }
  logout() {
    return this.request<void>('/auth/logout', { method: 'POST' });
  }
  assets(options: ListOptions, signal?: AbortSignal) {
    return this.request<AssetList>(`/assets?${new URLSearchParams({ ...options })}`, { signal });
  }
  createAsset(code: string) {
    return this.request<Asset>('/assets', { method: 'POST', body: JSON.stringify({ code }) });
  }
  setMonitoring(id: string, monitoring_enabled: boolean) {
    return this.request<Asset>(`/assets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ monitoring_enabled }),
    });
  }
  deleteAsset(id: string) {
    return this.request<void>(`/assets/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  settings(signal?: AbortSignal) {
    return this.request<NotificationSettings>('/settings/notifications', { signal });
  }
  saveSettings(thresholds: number[]) {
    return this.request<NotificationSettings>('/settings/notifications', {
      method: 'PUT',
      body: JSON.stringify({ thresholds }),
    });
  }
}
