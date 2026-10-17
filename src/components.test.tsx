import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { Alert, ConfirmDialog, Header, Status } from './components';
import { useAuth } from './auth';
import { authMock, deferred, renderPage } from '../tests/helpers';

vi.mock('./auth', () => ({ useAuth: vi.fn() }));
let auth: ReturnType<typeof authMock>;
beforeEach(() => {
  auth = authMock();
  vi.mocked(useAuth).mockReturnValue(auth);
});
it('空メッセージは表示せず、成功と失敗を異なるroleで通知する', () => {
  render(
    <>
      <Alert />
      <Alert success>成功</Alert>
      <Alert>失敗</Alert>
      <Status>処理中</Status>
    </>,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('失敗');
  expect(screen.getAllByRole('status')).toHaveLength(2);
});
it('ログアウト失敗を表示し、再試行中はボタンを無効にする', async () => {
  vi.mocked(auth.logout).mockRejectedValueOnce(new Error('offline'));
  renderPage(<Header />);
  fireEvent.click(screen.getByRole('button', { name: 'ログアウト' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('通信に失敗');
  const pending = deferred<void>();
  vi.mocked(auth.logout).mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getByRole('button', { name: 'ログアウト' }));
  expect(screen.getByRole('button', { name: 'ログアウト中…' })).toBeDisabled();
  await act(() => pending.resolve());
  await waitFor(() => expect(screen.getByRole('button', { name: 'ログアウト' })).toBeEnabled());
  expect(auth.logout).toHaveBeenCalledTimes(2);
});
it('外部のログアウト確認へ処理を委譲し、未認証ではナビを出さない', () => {
  const onLogout = vi.fn();
  const view = renderPage(<Header onLogout={onLogout} loggingOut={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'ログアウト' }));
  expect(onLogout).toHaveBeenCalledOnce();
  expect(auth.logout).not.toHaveBeenCalled();
  view.unmount();
  auth.state = { status: 'guest' };
  renderPage(<Header />);
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /下落通知/ })).toHaveAttribute('href', '/login');
});
it('ダイアログは処理中のEscを抑止し、通常のEscと確定を通知してフォーカスを戻す', () => {
  const onCancel = vi.fn(),
    onConfirm = vi.fn();
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const props = { title: '確認', confirmLabel: '実行', onCancel, onConfirm, children: '対象' };
  const view = render(<ConfirmDialog {...props} open={false} />);
  view.rerender(<ConfirmDialog {...props} open busy />);
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true }));
  expect(onCancel).not.toHaveBeenCalled();
  view.rerender(<ConfirmDialog {...props} open />);
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true }));
  fireEvent.click(screen.getByRole('button', { name: '実行' }));
  expect(onCancel).toHaveBeenCalledOnce();
  expect(onConfirm).toHaveBeenCalledOnce();
  view.unmount();
  expect(opener).toHaveFocus();
  opener.remove();
});
it('起動元が消えていても、閉じる処理でフォーカスを移動しない', () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const view = render(
    <ConfirmDialog open title="確認" confirmLabel="実行" onCancel={vi.fn()} onConfirm={vi.fn()}>
      対象
    </ConfirmDialog>,
  );
  opener.remove();
  expect(() => view.unmount()).not.toThrow();
});
