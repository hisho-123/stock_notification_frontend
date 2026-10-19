import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { ApiClient } from '../src/api';
import type { useAuth } from '../src/auth';
import { session } from './fixtures';

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export const response = (value: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers });

export function authMock(): ReturnType<typeof useAuth> {
  return {
    state: { status: 'authenticated', session },
    api: new ApiClient(),
    check: vi.fn().mockResolvedValue(undefined),
    login: vi.fn().mockResolvedValue(undefined),
    acceptSession: vi.fn(),
    forgetSession: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
  };
}
export function renderPage(element: ReactNode, path = '/assets') {
  const router = createMemoryRouter(
    [
      { path: path.split(/[?#]/)[0], element },
      { path: '*', element: <h1>移動先</h1> },
    ],
    { initialEntries: [path] },
  );
  const view = render(<RouterProvider router={router} />);
  return { ...view, router };
}
