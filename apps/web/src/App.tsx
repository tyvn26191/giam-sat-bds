import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/Toast';
import { DashboardPage } from './pages/Dashboard';
import { LoginPage, PendingPage } from './pages/Login';

const AddPropertyPage = lazy(() => import('./pages/AddProperty').then((m) => ({ default: m.AddPropertyPage })));
const PropertyDetailPage = lazy(() => import('./pages/PropertyDetail').then((m) => ({ default: m.PropertyDetailPage })));
const EditPropertyPage = lazy(() => import('./pages/EditProperty').then((m) => ({ default: m.EditPropertyPage })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));
const LogsPage = lazy(() => import('./pages/Logs').then((m) => ({ default: m.LogsPage })));

function Gate({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  if (session.status === 'loading') return <div className="splash">Đang tải…</div>;
  if (session.status === 'signedOut') return <LoginPage />;
  if (!session.role) return <PendingPage />;
  return <>{children}</>;
}

const page = (el: ReactNode) => <Suspense fallback={<p className="page muted">Đang tải…</p>}>{el}</Suspense>;

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Gate>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<DashboardPage />} />
                <Route path="add" element={page(<AddPropertyPage />)} />
                <Route path="p/:id" element={page(<PropertyDetailPage />)} />
                <Route path="p/:id/edit" element={page(<EditPropertyPage />)} />
                <Route path="settings" element={page(<SettingsPage />)} />
                <Route path="logs" element={page(<LogsPage />)} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </Gate>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
