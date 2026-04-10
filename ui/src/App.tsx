import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
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
        <ProtectedRoute>
          <RoleProvider>
            <Routes>
              <Route element={<Layout />}>
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
          </RoleProvider>
        </ProtectedRoute>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
