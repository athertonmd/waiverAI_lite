import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { PublicLayout } from './components/PublicLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { RoleProvider } from './auth/RoleContext';
import { Dashboard } from './pages/Dashboard';
import { WaiverList } from './pages/WaiverList';
import { ReviewQueue } from './pages/ReviewQueue';
import { WaiverDetail } from './pages/WaiverDetail';
import { Monitoring } from './pages/Monitoring';
import { Settings } from './pages/Settings';
import { RulesEngine } from './pages/RulesEngine';
import { Reports } from './pages/Reports';
import { Ingest } from './pages/Ingest';
import { UserManagement } from './pages/UserManagement';
import { PublicWaiverList } from './pages/PublicWaiverList';
import { PublicWaiverDetail } from './pages/PublicWaiverDetail';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* Public routes — no auth required */}
          <Route element={<PublicLayout />}>
            <Route path="browse" element={<PublicWaiverList />} />
            <Route path="browse/:id" element={<PublicWaiverDetail />} />
          </Route>

          {/* Protected routes — require Cognito auth */}
          <Route element={
            <ProtectedRoute>
              <RoleProvider>
                <Layout />
              </RoleProvider>
            </ProtectedRoute>
          }>
            <Route index element={<Dashboard />} />
            <Route path="waivers" element={<WaiverList />} />
            <Route path="waivers/:id" element={<WaiverDetail />} />
            <Route path="review" element={<ReviewQueue />} />
            <Route path="ingest" element={<Ingest />} />
            <Route path="monitoring" element={<Monitoring />} />
            <Route path="rules" element={<RulesEngine />} />
            <Route path="reports" element={<Reports />} />
            <Route path="settings" element={<Settings />} />
            <Route path="users" element={<UserManagement />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
