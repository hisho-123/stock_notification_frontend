import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { RegisterPage } from './RegisterPage';
import { useAuth } from '../auth';
import { ApiError } from '../api';
import { session } from '../../tests/fixtures';
import { authMock, deferred, renderPage } from '../../tests/helpers';

vi.mock('../auth', () => ({ useAuth: vi.fn() }));
const token = 'A'.repeat(43);
const validity = () => ({ expires_at: new Date(Date.now() + 86_400_000).toISOString() });
let auth: ReturnType<typeof authMock>;
beforeEach(() => {
  auth = authMock();
  auth.state = { status: 'guest' };
  vi.mocked(useAuth).mockReturnValue(auth);
  vi.spyOn(auth.api, 'validateRegistration').mockResolvedValue(validity());
  vi.spyOn(auth.api, 'register').mockResolvedValue({ ...session, login_id: 'new-user' });
});
afterEach(() => vi.useRealTimers());
async function mount(hash = `#token=${token}`) {
  const view = renderPage(<RegisterPage />, `/register${hash}`);
  if (hash === `#token=${token}`) await screen.findByText(/有効期限：/);
  return view;
}
function fill(id = 'new-user', password = 'password') {
  fireEvent.change(screen.getByLabelText('ログインID'), { target: { value: id } });
  fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: password } });
}
function submit() {
  fireEvent.submit(screen.getByRole('button', { name: /^(登録|登録中…)$/ }).closest('form')!);
}
it.each(['', '#token=bad', `#token=${token}&token=${token}`])(
  '不正URLではAPIを呼ばず共通の復旧案内を表示: %s',
  async (hash) => {
    await mount(hash);
    expect(auth.api.validateRegistration).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('LINEトークで「登録」');
    expect(screen.getByLabelText('ログインID')).toBeDisabled();
    expect(screen.getByRole('link', { name: 'ログインへ' })).toHaveAttribute('href', '/login');
  },
);
it('認証済み・StrictModeでもURLを確認し、秘密値を表示せず入力を許可する', async () => {
  auth.state = { status: 'authenticated', session };
  renderPage(
    <StrictMode>
      <RegisterPage />
    </StrictMode>,
    `/register#token=${token}`,
  );
  await screen.findByText(/有効期限：/);
  expect(screen.getByText('登録後は新しいユーザーでログインします。')).toBeVisible();
  expect(screen.queryByText(token)).toBeNull();
  expect(screen.getByLabelText('パスワード')).toHaveAttribute('autocomplete', 'new-password');
  expect(screen.getByRole('button', { name: '登録' })).toBeDisabled();
});
it('確認中・送信中は入力を止め、成功はSession採用と置換遷移を行う', async () => {
  const pending = deferred<{ expires_at: string }>();
  vi.mocked(auth.api.validateRegistration).mockReturnValueOnce(pending.promise);
  const view = renderPage(<RegisterPage />, `/register#token=${token}`);
  expect(screen.getByRole('status')).toHaveTextContent('登録URLを確認しています');
  expect(screen.getByLabelText('ログインID')).toBeDisabled();
  await act(() => pending.resolve(validity()));
  fill(' new-user ', ' password ');
  const registration = deferred<typeof session>();
  vi.mocked(auth.api.register).mockReturnValueOnce(registration.promise);
  submit();
  submit();
  expect(screen.getByLabelText('パスワード')).toBeDisabled();
  expect(auth.api.register).toHaveBeenCalledExactlyOnceWith(
    token,
    ' new-user ',
    ' password ',
    expect.any(AbortSignal),
  );
  await act(() => registration.resolve({ ...session, login_id: ' new-user ' }));
  expect(auth.acceptSession).toHaveBeenCalledWith(
    expect.objectContaining({ login_id: ' new-user ' }),
  );
  expect(view.router.state.location.pathname).toBe('/assets');
  expect(view.router.state.location.hash).toBe('');
  expect(view.router.state.historyAction).toBe('REPLACE');
});
it('文字数・UTF-8下限と上限の項目エラーへフォーカスする', async () => {
  await mount();
  submit();
  expect(screen.getByLabelText('ログインID')).toHaveFocus();
  fill('x'.repeat(101));
  submit();
  expect(screen.getByLabelText('ログインID')).toHaveFocus();
  fill('new-user', 'ああ');
  submit();
  expect(screen.getByLabelText('パスワード')).toHaveFocus();
  fill('new-user', 'あ'.repeat(25));
  submit();
  expect(auth.api.register).not.toHaveBeenCalled();
});
it.each([410, 503])('確認のHTTP %sは無効URLまたは確認だけの再試行にする', async (status) => {
  vi.mocked(auth.api.validateRegistration).mockRejectedValueOnce(
    new ApiError(status, 'ERROR', '確認エラー'),
  );
  renderPage(<RegisterPage />, `/register#token=${token}`);
  await waitFor(() => expect(screen.getByRole('alert')).toBeVisible());
  if (status === 503) {
    fireEvent.click(screen.getByRole('button', { name: '確認を再試行' }));
    await screen.findByText(/有効期限：/);
    expect(auth.api.validateRegistration).toHaveBeenCalledTimes(2);
  } else expect(screen.queryByRole('button', { name: '確認を再試行' })).toBeNull();
  expect(auth.api.register).not.toHaveBeenCalled();
});
it('409ではIDとトークンを保持し、パスワードだけ消して別IDで登録できる', async () => {
  vi.mocked(auth.api.register).mockRejectedValueOnce(
    new ApiError(409, 'LOGIN_ID_ALREADY_EXISTS', '重複', { login_id: '別のID' }),
  );
  await mount();
  fill();
  submit();
  await screen.findByText('このログインIDは使用されています。');
  expect(screen.getByLabelText('ログインID')).toHaveValue('new-user');
  expect(screen.getByLabelText('パスワード')).toHaveValue('');
  await waitFor(() => expect(screen.getByLabelText('ログインID')).toHaveFocus());
  fill('another-user');
  submit();
  await waitFor(() => expect(auth.acceptSession).toHaveBeenCalledOnce());
  expect(auth.api.register).toHaveBeenLastCalledWith(
    token,
    'another-user',
    'password',
    expect.any(AbortSignal),
  );
});
it('確認後に410になったURLは再送できない', async () => {
  vi.mocked(auth.api.register).mockRejectedValueOnce(
    new ApiError(410, 'REGISTRATION_LINK_UNAVAILABLE', '無効'),
  );
  await mount();
  fill();
  submit();
  await screen.findByText(unavailableText());
  expect(screen.getByLabelText('ログインID')).toBeDisabled();
  expect(screen.getByLabelText('パスワード')).toHaveValue('');
  submit();
  expect(auth.api.register).toHaveBeenCalledOnce();
});
function unavailableText() {
  return 'この登録URLは利用できません。LINEトークで「登録」と送信してください。';
}
it.each(['validate', 'register'])(
  '429の待機後は確認のみ実行しPOSTを自動再送しない: %s',
  async (operation) => {
    vi.useFakeTimers();
    const limited = new ApiError(429, 'TOO_MANY_ATTEMPTS', '待機', {}, 2);
    if (operation === 'validate')
      vi.mocked(auth.api.validateRegistration).mockRejectedValueOnce(limited);
    else vi.mocked(auth.api.register).mockRejectedValueOnce(limited);
    renderPage(<RegisterPage />, `/register#token=${token}`);
    await act(async () => {});
    if (operation === 'register') {
      fill();
      await act(async () => submit());
    }
    expect(screen.getByRole('alert')).toHaveTextContent('あと2秒');
    expect(screen.getByRole('button', { name: '登録' })).toBeDisabled();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(auth.api.validateRegistration).toHaveBeenCalledTimes(2);
    expect(auth.api.register).toHaveBeenCalledTimes(operation === 'register' ? 1 : 0);
    expect(screen.getByLabelText('パスワード')).toHaveValue('');
  },
);
it.each(['match', 'other', 'failed'])(
  '成否不明時はsessionのID照合で復旧し、登録を再送しない: %s',
  async (outcome) => {
    vi.mocked(auth.api.register).mockRejectedValueOnce(
      new ApiError(503, 'SERVICE_UNAVAILABLE', '不明'),
    );
    const check = vi.spyOn(auth.api, 'session');
    if (outcome === 'failed') check.mockRejectedValueOnce(new Error('offline'));
    else
      check.mockResolvedValueOnce({
        ...session,
        login_id: outcome === 'match' ? 'new-user' : 'owner',
      });
    await mount();
    fill();
    submit();
    if (outcome === 'match') await screen.findByRole('heading', { name: '移動先' });
    else {
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent('登録が完了している場合'),
      );
      expect(screen.getByLabelText('パスワード')).toHaveValue('');
      expect(screen.getByRole('button', { name: '登録' })).toBeDisabled();
      submit();
      expect(auth.acceptSession).not.toHaveBeenCalled();
    }
    expect(check).toHaveBeenCalledOnce();
    expect(auth.api.register).toHaveBeenCalledOnce();
  },
);
it('確定した400は項目エラーを表示し、パスワードを消して訂正可能にする', async () => {
  vi.mocked(auth.api.register).mockRejectedValueOnce(
    new ApiError(400, 'VALIDATION_ERROR', '入力不正', { password: '変更してください' }),
  );
  await mount();
  fill();
  submit();
  await screen.findByText('変更してください');
  expect(screen.getByLabelText('パスワード')).toHaveValue('');
  await waitFor(() => expect(screen.getByLabelText('パスワード')).toHaveFocus());
});
it('有効期限ちょうど・pagehideで入力とトークンを破棄する', async () => {
  vi.useFakeTimers();
  vi.mocked(auth.api.validateRegistration).mockResolvedValueOnce({
    expires_at: new Date(Date.now() + 1000).toISOString(),
  });
  renderPage(<RegisterPage />, `/register#token=${token}`);
  await act(async () => {});
  fill();
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(screen.getByRole('alert')).toHaveTextContent('この登録URLは利用できません');
  expect(screen.getByLabelText('パスワード')).toHaveValue('');
  act(() => window.dispatchEvent(new Event('pagehide')));
  expect(screen.getByLabelText('ログインID')).toBeDisabled();
});
it.each(['resolve', 'reject'])('離脱後の確認結果は反映しない: %s', async (outcome) => {
  const pending = deferred<{ expires_at: string }>();
  vi.mocked(auth.api.validateRegistration).mockReturnValueOnce(pending.promise);
  const view = renderPage(<RegisterPage />, `/register#token=${token}`);
  view.unmount();
  await act(() =>
    outcome === 'resolve' ? pending.resolve(validity()) : pending.reject(new Error('offline')),
  );
  expect(vi.mocked(auth.api.validateRegistration).mock.calls[0][1]?.aborted).toBe(true);
});
it('離脱後の登録失敗でセッション照会を開始しない', async () => {
  const pending = deferred<typeof session>();
  vi.mocked(auth.api.register).mockReturnValueOnce(pending.promise);
  const check = vi.spyOn(auth.api, 'session');
  const view = await mount();
  fill();
  submit();
  view.unmount();
  await act(() => pending.reject(new Error('offline')));
  expect(check).not.toHaveBeenCalled();
});
it.each(['success', 'failure'] as const)(
  '成否不明のセッション確認中に離脱しても結果を反映しない: %s',
  async (outcome) => {
    vi.mocked(auth.api.register).mockRejectedValueOnce(new Error('offline'));
    const pending = deferred<typeof session>();
    const check = vi.spyOn(auth.api, 'session').mockReturnValueOnce(pending.promise);
    const view = await mount();
    fill();
    submit();
    await waitFor(() => expect(check).toHaveBeenCalledOnce());
    view.unmount();
    await act(() =>
      outcome === 'success'
        ? pending.resolve({ ...session, login_id: 'new-user' })
        : pending.reject(new Error('offline')),
    );
    expect(auth.acceptSession).not.toHaveBeenCalled();
  },
);
it('離脱後に成功した登録も新しい画面へSessionを反映しない', async () => {
  const pending = deferred<typeof session>();
  vi.mocked(auth.api.register).mockReturnValueOnce(pending.promise);
  const view = await mount();
  fill();
  submit();
  view.unmount();
  await act(() => pending.resolve({ ...session, login_id: 'new-user' }));
  expect(auth.acceptSession).not.toHaveBeenCalled();
});
