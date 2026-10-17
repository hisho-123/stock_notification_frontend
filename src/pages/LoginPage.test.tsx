import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';
import { useAuth } from '../auth';
import { ApiError } from '../api';
import { authMock, deferred, renderPage } from '../../tests/helpers';

vi.mock('../auth', () => ({ useAuth: vi.fn() }));
let auth: ReturnType<typeof authMock>;
beforeEach(() => {
  auth = authMock();
  auth.state = { status: 'guest' };
  vi.mocked(useAuth).mockReturnValue(auth);
});
afterEach(() => vi.useRealTimers());
function fill(id = 'owner', password = 'password') {
  fireEvent.change(screen.getByLabelText('ID'), { target: { value: id } });
  fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: password } });
}
function submit() {
  fireEvent.submit(screen.getByRole('button', { name: 'ログイン' }).closest('form')!);
}

it('空欄・ID超過・パスワード超過では送信せず、最初の不正項目にフォーカスする', () => {
  renderPage(<LoginPage />, '/login');
  submit();
  expect(screen.getByLabelText('ID')).toHaveFocus();
  fill('x'.repeat(101));
  submit();
  expect(screen.getByLabelText('ID')).toHaveFocus();
  fill('owner', 'x'.repeat(73));
  submit();
  expect(screen.getByLabelText('パスワード')).toHaveFocus();
  expect(auth.login).not.toHaveBeenCalled();
});
it('送信中の再送を抑止し、成功時には入力値をそのまま渡す', async () => {
  const pending = deferred<void>();
  vi.mocked(auth.login).mockReturnValue(pending.promise);
  renderPage(<LoginPage />, '/login');
  fill(' owner ', ' pass ');
  submit();
  expect(screen.getByRole('button', { name: 'ログイン中…' })).toBeDisabled();
  fireEvent.submit(screen.getByLabelText('ID').closest('form')!);
  expect(auth.login).toHaveBeenCalledExactlyOnceWith(' owner ', ' pass ');
  await act(() => pending.resolve());
  expect(screen.getByRole('button', { name: 'ログイン' })).toBeEnabled();
});
it.each([new ApiError(401, 'INVALID_CREDENTIALS', '不一致'), new Error('internal')])(
  '失敗後はパスワードを消し、IDとエラーを保持する: %s',
  async (error) => {
    vi.mocked(auth.login).mockRejectedValue(error);
    renderPage(<LoginPage />, '/login');
    fill();
    submit();
    await waitFor(() => expect(screen.getByRole('alert')).toBeVisible());
    expect(screen.getByLabelText('ID')).toHaveValue('owner');
    expect(screen.getByLabelText('パスワード')).toHaveValue('');
    await waitFor(() => expect(screen.getByLabelText('パスワード')).toHaveFocus());
  },
);
it('429の待機中はフォーム送信も抑止し、期限後は再送できる', async () => {
  vi.useFakeTimers();
  vi.mocked(auth.login).mockRejectedValueOnce(new ApiError(429, 'LIMIT', '待機', {}, 2));
  renderPage(<LoginPage />, '/login');
  fill();
  await act(async () => submit());
  expect(screen.getByRole('alert')).toHaveTextContent('あと2秒');
  fill();
  await act(async () => submit());
  expect(auth.login).toHaveBeenCalledTimes(1);
  await act(() => vi.advanceTimersByTimeAsync(2000));
  await act(async () => submit());
  expect(auth.login).toHaveBeenCalledTimes(2);
});
it('認証済みなら一覧へ移動する', async () => {
  auth.state = authMock().state;
  renderPage(<LoginPage />, '/login');
  expect(await screen.findByRole('heading', { name: '移動先' })).toBeVisible();
});
