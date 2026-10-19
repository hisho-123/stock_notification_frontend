import type {
  Asset,
  AssetList,
  ErrorResponse,
  ListOptions,
  NotificationSettings,
  Session,
  RegistrationValidity,
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

export function isCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
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
  private generation = 0;
  private requests = new Set<AbortController>();
  onUnauthorized: () => void = () => {};

  clearSession() {
    this.generation++;
    for (const request of this.requests) request.abort();
    this.requests.clear();
    this.csrfToken = null;
  }
  setSession(session: Session) {
    this.clearSession();
    this.csrfToken = session.csrf_token;
  }

  // 全公開操作がoptionsを指定するため、呼出不能な既定引数は設けない。
  private async request<T>(path: string, options: RequestInit): Promise<T> {
    // ユーザー切替後に旧要求の成功・401・後続再取得を反映しないため、世代を固定する。
    const publicRequest = ['/auth/login', '/auth/register', '/auth/registration/validate'].includes(
      path,
    );
    const generation = this.generation;
    const controller = new AbortController();
    if (!publicRequest) this.requests.add(controller);
    const signal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    try {
      const value = await this.perform<T>(path, { ...options, signal });
      if ((!publicRequest && generation !== this.generation) || signal.aborted)
        throw new DOMException('Request cancelled', 'AbortError');
      return value;
    } finally {
      this.requests.delete(controller);
    }
  }

  private async perform<T>(path: string, options: RequestInit): Promise<T> {
    const publicRequest = ['/auth/login', '/auth/register', '/auth/registration/validate'].includes(
      path,
    );
    const method = options.method ?? 'GET';
    const headers = new Headers({ Accept: 'application/json' });
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (method !== 'GET' && !publicRequest && this.csrfToken) {
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
      ) {
        if (isCancelled(error)) throw error;
        throw new DOMException('Request cancelled', 'AbortError');
      }
      throw new ApiError(
        0,
        'NETWORK_ERROR',
        '通信に失敗しました。接続を確認して再試行してください。',
      );
    }
    if (!response.ok) {
      let payload: ErrorResponse | undefined;
      try {
        payload = (await response.json()) as ErrorResponse;
      } catch {
        /* プロキシ等の非JSONエラー */
      }
      if (options.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
      if (response.status === 401 && !publicRequest) {
        this.clearSession();
        this.onUnauthorized();
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
      const payload = (await response.json()) as T;
      if (options.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
      return payload;
    } catch {
      if (options.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
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
  login(login_id: string, password: string, signal?: AbortSignal) {
    return this.request<Session>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login_id, password }),
      signal,
    });
  }
  validateRegistration(registration_token: string, signal?: AbortSignal) {
    return this.request<RegistrationValidity>('/auth/registration/validate', {
      method: 'POST',
      body: JSON.stringify({ registration_token }),
      signal,
    });
  }
  register(registration_token: string, login_id: string, password: string, signal?: AbortSignal) {
    return this.request<Session>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ registration_token, login_id, password }),
      signal,
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
