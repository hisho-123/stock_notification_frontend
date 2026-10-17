import { act, fireEvent, screen } from '@testing-library/react';
import type { Root } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { assets, session } from '../tests/fixtures';
import { response } from '../tests/helpers';

const mounted = vi.hoisted(() => ({ root: null as Root | null }));
vi.mock('react-dom/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom/client')>();
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      mounted.root = actual.createRoot(...args);
      return mounted.root;
    },
  };
});
it('実エントリから起動し、認証確認・ログインを経て一覧を表示する', async () => {
  window.history.replaceState(null, '', '/assets');
  const container = document.createElement('div');
  container.id = 'root';
  document.body.append(container);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/session')) return response({}, 401);
      if (url.endsWith('/login')) return response(session);
      return response({ items: assets, total: assets.length });
    }),
  );
  await act(async () => {
    await import('./main');
  });
  await screen.findByRole('heading', { name: 'ログイン' });
  fireEvent.change(screen.getByLabelText('ID'), { target: { value: 'owner' } });
  fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'password' } });
  fireEvent.submit(screen.getByLabelText('ID').closest('form')!);
  expect(await screen.findByRole('button', { name: 'AAPLを削除' })).toBeVisible();
  await act(async () => mounted.root?.unmount());
  const { router } = await import('./router');
  router.dispose();
  container.remove();
});
