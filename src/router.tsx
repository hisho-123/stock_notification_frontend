import { createBrowserRouter, Link, Navigate, Outlet, useRouteError } from 'react-router';
import { useAuth } from './auth';
import { Alert, Header, Status } from './components';
import { LoginPage } from './pages/LoginPage';
import { AssetsPage } from './pages/AssetsPage';
import { SettingsPage } from './pages/SettingsPage';

export function SessionBoundary() {
  const { state, check } = useAuth();
  if (state.status === 'checking')
    return (
      <>
        <Header />
        <main id="main" className="container">
          <Status>ログイン状態を確認しています…</Status>
        </main>
      </>
    );
  if (state.status === 'error')
    return (
      <>
        <Header />
        <main id="main" className="container">
          <h1>ログイン状態を確認できませんでした</h1>
          <Alert>{state.message}</Alert>
          <button type="button" onClick={() => void check()}>
            再試行
          </button>
        </main>
      </>
    );
  return <Outlet />;
}
export function ProtectedRoutes() {
  const { state } = useAuth();
  return state.status === 'authenticated' ? (
    <Outlet key={state.session.expires_at} />
  ) : (
    <Navigate to="/login" replace />
  );
}
function RouteError() {
  useRouteError();
  return (
    <main id="main" className="container">
      <h1>画面を表示できませんでした</h1>
      <p>ページを再読み込みして、もう一度お試しください。</p>
      <a href="/assets">監視対象へ</a>
    </main>
  );
}
export const router = createBrowserRouter([
  {
    element: <SessionBoundary />,
    errorElement: <RouteError />,
    children: [
      { path: '/login', element: <LoginPage /> },
      {
        element: <ProtectedRoutes />,
        children: [
          { path: '/', element: <Navigate to="/assets" replace /> },
          { path: '/assets', element: <AssetsPage /> },
          { path: '/settings', element: <Navigate to="/settings/notifications" replace /> },
          { path: '/settings/notifications', element: <SettingsPage /> },
        ],
      },
      {
        path: '*',
        element: (
          <>
            <Header />
            <main id="main" className="container">
              <h1>ページが見つかりません</h1>
              <Link to="/assets">監視対象へ</Link>
            </main>
          </>
        ),
      },
    ],
  },
]);
