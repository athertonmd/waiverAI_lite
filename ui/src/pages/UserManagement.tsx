import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPut, apiDelete } from '../api/client';

/* ── Types ─────────────────────────────────────────── */

interface UserRecord {
  username: string;
  email: string;
  role: 'admin' | 'user';
  status: string;
  enabled: boolean;
  createdAt: string;
}

interface UsersResponse {
  data: UserRecord[];
}

interface UserResponse {
  data: UserRecord;
}

interface RegistrationRequest {
  key: string;
  id: string;
  name: string;
  email: string;
  company: string;
  status: string;
  createdAt: string;
}

interface RegistrationRequestsResponse {
  data: RegistrationRequest[];
}

type Role = 'admin' | 'user';

/* ── Component ─────────────────────────────────────── */

export function UserManagement() {
  const queryClient = useQueryClient();

  /* ── State ── */
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<Role>('user');
  const [emailError, setEmailError] = useState('');
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [confirmDisable, setConfirmDisable] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmReject, setConfirmReject] = useState<string | null>(null);

  /* ── Queries ── */
  const { data, isLoading, error } = useQuery<UsersResponse>({
    queryKey: ['users'],
    queryFn: () => apiGet<UsersResponse>('/v1/users'),
  });

  const users = data?.data ?? [];

  const { data: regData, isLoading: regLoading } = useQuery<RegistrationRequestsResponse>({
    queryKey: ['registration-requests'],
    queryFn: () => apiGet<RegistrationRequestsResponse>('/v1/registration-requests'),
  });

  const requests = regData?.data ?? [];

  /* ── Mutations ── */
  const showSuccess = (msg: string) => setBanner({ type: 'success', msg });
  const showError = (err: Error) => setBanner({ type: 'error', msg: err.message });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });
  const invalidateRequests = () => queryClient.invalidateQueries({ queryKey: ['registration-requests'] });

  const createMutation = useMutation({
    mutationFn: (body: { email: string; role: Role }) =>
      apiPost<UserResponse>('/v1/users', body),
    onSuccess: () => {
      invalidate();
      showSuccess('User created successfully.');
      setNewEmail('');
      setNewRole('user');
    },
    onError: showError,
  });

  const changeRoleMutation = useMutation({
    mutationFn: ({ username, role }: { username: string; role: Role }) =>
      apiPut<UserResponse>(`/v1/users/${encodeURIComponent(username)}/role`, { role }),
    onSuccess: () => { invalidate(); showSuccess('Role updated.'); },
    onError: showError,
  });

  const disableMutation = useMutation({
    mutationFn: (username: string) =>
      apiPost<UserResponse>(`/v1/users/${encodeURIComponent(username)}/disable`),
    onSuccess: () => { invalidate(); showSuccess('User disabled.'); setConfirmDisable(null); },
    onError: (err: Error) => { showError(err); setConfirmDisable(null); },
  });

  const enableMutation = useMutation({
    mutationFn: (username: string) =>
      apiPost<UserResponse>(`/v1/users/${encodeURIComponent(username)}/enable`),
    onSuccess: () => { invalidate(); showSuccess('User enabled.'); },
    onError: showError,
  });

  const deleteMutation = useMutation({
    mutationFn: (username: string) =>
      apiDelete<{ data: { deleted: boolean } }>(`/v1/users/${encodeURIComponent(username)}`),
    onSuccess: () => { invalidate(); showSuccess('User deleted.'); setConfirmDelete(null); },
    onError: (err: Error) => { showError(err); setConfirmDelete(null); },
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      apiPost(`/v1/registration-requests/${encodeURIComponent(id)}/approve`),
    onSuccess: () => { invalidate(); invalidateRequests(); showSuccess('Request approved — user created.'); },
    onError: showError,
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) =>
      apiPost(`/v1/registration-requests/${encodeURIComponent(id)}/reject`),
    onSuccess: () => { invalidateRequests(); showSuccess('Request rejected.'); setConfirmReject(null); },
    onError: (err: Error) => { showError(err); setConfirmReject(null); },
  });

  /* ── Create form submit ── */
  const handleCreate = () => {
    setEmailError('');
    setBanner(null);
    const trimmed = newEmail.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError('Please enter a valid email address.');
      return;
    }
    createMutation.mutate({ email: trimmed, role: newRole });
  };

  /* ── Loading / Error states ── */
  if (isLoading) return <p style={{ padding: 24 }}>Loading users…</p>;
  if (error) return <p style={{ padding: 24, color: 'var(--color-red)' }}>Failed to load users: {(error as Error).message}</p>;

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>User Management</h1>

      {banner && (
        <div
          style={{
            padding: '10px 16px',
            borderRadius: 4,
            marginBottom: 12,
            fontSize: 14,
            background: banner.type === 'error' ? '#fce8e6' : '#e6f4ea',
            color: banner.type === 'error' ? 'var(--color-red)' : 'var(--color-green)',
          }}
        >
          {banner.msg}
        </div>
      )}

      {/* ── Pending Access Requests ── */}
      <div style={{ ...cardStyle, maxWidth: 960, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Pending Access Requests</h2>
        {regLoading ? (
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>Loading requests…</p>
        ) : requests.length === 0 ? (
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>No pending requests</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Company</th>
                <th style={thStyle}>Submitted</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => (
                <tr key={req.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={tdStyle}>{req.name}</td>
                  <td style={tdStyle}>{req.email}</td>
                  <td style={tdStyle}>{req.company}</td>
                  <td style={tdStyle}>{new Date(req.createdAt).toLocaleDateString()}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <button
                        style={{ ...iconBtnStyle, color: 'var(--color-green)' }}
                        onClick={() => approveMutation.mutate(req.id)}
                        disabled={approveMutation.isPending}
                        aria-label={`Approve ${req.email}`}
                      >
                        Approve
                      </button>
                      {confirmReject === req.id ? (
                        <span style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
                          Reject?
                          <button style={{ ...iconBtnStyle, color: 'var(--color-red)' }} onClick={() => rejectMutation.mutate(req.id)}>Yes</button>
                          <button style={iconBtnStyle} onClick={() => setConfirmReject(null)}>No</button>
                        </span>
                      ) : (
                        <button
                          style={{ ...iconBtnStyle, color: 'var(--color-red)' }}
                          onClick={() => setConfirmReject(req.id)}
                          disabled={rejectMutation.isPending}
                          aria-label={`Reject ${req.email}`}
                        >
                          Reject
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Create User Form ── */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Create User</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <input
              type="email"
              placeholder="Email address"
              value={newEmail}
              onChange={(e) => { setNewEmail(e.target.value); setEmailError(''); }}
              style={inputStyle}
              aria-label="New user email"
            />
            {emailError && <p style={{ fontSize: 12, color: 'var(--color-red)', marginTop: 4 }}>{emailError}</p>}
          </div>
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as Role)}
            style={{ ...inputStyle, width: 120 }}
            aria-label="New user role"
          >
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
          <button
            className="btn btn-primary"
            onClick={handleCreate}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? 'Creating…' : 'Create User'}
          </button>
        </div>
      </div>

      {/* ── Users Table ── */}
      <div style={{ ...cardStyle, marginTop: 24, maxWidth: 960 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Users</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
              <th style={thStyle}>Email</th>
              <th style={thStyle}>Role</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Created</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 12, color: 'var(--color-text-secondary)', textAlign: 'center' }}>
                  No users found.
                </td>
              </tr>
            )}
            {users.map((user) => (
              <tr key={user.username} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={tdStyle}>{user.email}</td>
                <td style={tdStyle}>
                  <select
                    value={user.role}
                    onChange={(e) => changeRoleMutation.mutate({ username: user.username, role: e.target.value as Role })}
                    style={inlineSelectStyle}
                    disabled={changeRoleMutation.isPending}
                    aria-label={`Change role for ${user.email}`}
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td style={tdStyle}>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 10,
                      fontSize: 12,
                      fontWeight: 600,
                      background: user.enabled ? '#e6f4ea' : '#fce8e6',
                      color: user.enabled ? 'var(--color-green)' : 'var(--color-red)',
                    }}
                  >
                    {user.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </td>
                <td style={tdStyle}>{new Date(user.createdAt).toLocaleDateString()}</td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {/* Enable / Disable toggle */}
                    {user.enabled ? (
                      confirmDisable === user.username ? (
                        <span style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
                          Disable?
                          <button style={{ ...iconBtnStyle, color: 'var(--color-red)' }} onClick={() => disableMutation.mutate(user.username)}>Yes</button>
                          <button style={iconBtnStyle} onClick={() => setConfirmDisable(null)}>No</button>
                        </span>
                      ) : (
                        <button
                          style={iconBtnStyle}
                          onClick={() => setConfirmDisable(user.username)}
                          disabled={disableMutation.isPending}
                          aria-label={`Disable ${user.email}`}
                        >
                          Disable
                        </button>
                      )
                    ) : (
                      <button
                        style={iconBtnStyle}
                        onClick={() => enableMutation.mutate(user.username)}
                        disabled={enableMutation.isPending}
                        aria-label={`Enable ${user.email}`}
                      >
                        Enable
                      </button>
                    )}

                    {/* Delete */}
                    {confirmDelete === user.username ? (
                      <span style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
                        Delete?
                        <button style={{ ...iconBtnStyle, color: 'var(--color-red)' }} onClick={() => deleteMutation.mutate(user.username)}>Yes</button>
                        <button style={iconBtnStyle} onClick={() => setConfirmDelete(null)}>No</button>
                      </span>
                    ) : (
                      <button
                        style={{ ...iconBtnStyle, color: 'var(--color-red)' }}
                        onClick={() => setConfirmDelete(user.username)}
                        disabled={deleteMutation.isPending}
                        aria-label={`Delete ${user.email}`}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


/* ── Styles ────────────────────────────────────────── */

const cardStyle: React.CSSProperties = {
  background: 'var(--color-card)',
  borderRadius: 8,
  boxShadow: 'var(--color-card-shadow)',
  padding: 24,
  maxWidth: 600,
};

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  fontSize: 14,
  outline: 'none',
  width: '100%',
};

const inlineSelectStyle: React.CSSProperties = {
  padding: '2px 6px',
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  fontSize: 13,
  background: 'transparent',
  cursor: 'pointer',
};

const thStyle: React.CSSProperties = { padding: '8px 4px' };
const tdStyle: React.CSSProperties = { padding: '8px 4px' };

const iconBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  padding: '2px 8px',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
};
