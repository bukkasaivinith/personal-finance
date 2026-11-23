import { createBrowserRouter, Link, Outlet, RouterProvider } from 'react-router';
import App from '@/App';
import { AuthGate } from '@/components/auth-gate';
import { MobileApp } from '@/components/mobile-app';
import { AuthShell } from '@/components/auth-forms';
import { financePageRoutes, mobilePath, viewPaths } from '@/lib/navigation';

function ProtectedPages() {
  return <AuthGate><Outlet /></AuthGate>;
}

function RouteMessage({ title, detail }: { title: string; detail: string }) {
  return <AuthShell>
    <div className="auth-heading"><h1>{title}</h1><p>{detail}</p></div>
    <Link className="auth-button" to={viewPaths.overview}>Back to Overview</Link>
  </AuthShell>;
}

const router = createBrowserRouter([{
  errorElement: <RouteMessage title="Page unavailable" detail="Return to Overview or refresh to try again." />,
  children: [
    {
      element: <ProtectedPages />,
      children: [
        { element: <App />, children: financePageRoutes },
        { path: mobilePath, element: <MobileApp /> },
      ],
    },
    {
      path: '*',
      element: <RouteMessage title="Page not found" detail="Check the address or return to Overview." />,
    },
  ],
}]);

export function SiteRouter() {
  return <RouterProvider router={router} onError={() => {}} />;
}
