import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut, apiPost, apiDelete } from '../api/client';

/* ── Types ─────────────────────────────────────────── */

interface ThresholdResponse {
  data: { threshold: number };
}

interface FieldDefinition {
  key: string;
  label: string;
  type: 'text' | 'date' | 'array' | 'textarea';
  definition: string;
  required: boolean;
  order: number;
}

interface FieldSchemaResponse {
  data: FieldDefinition[];
}

const FIELD_TYPES: FieldDefinition['type'][] = ['text', 'date', 'array', 'textarea'];

/* ── Component ─────────────────────────────────────── */

export function Settings() {
  const queryClient = useQueryClient();

  /* ── Confidence Threshold ── */
  const { data, isLoading } = useQuery<ThresholdResponse>({
    queryKey: ['settings-threshold'],
    queryFn: () => apiGet<ThresholdResponse>('/v1/settings/threshold'),
  });

  const [value, setValue] = useState(0.85);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  useEffect(() => {
    if (data?.data?.threshold !== undefined) setValue(data.data.threshold);
  }, [data]);

  const mutation = useMutation({
    mutationFn: (threshold: number) =>
      apiPut<ThresholdResponse>('/v1/settings/threshold', { threshold }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-threshold'] });
      setBanner({ type: 'success', msg: 'Threshold updated.' });
    },
    onError: (err: Error) => setBanner({ type: 'error', msg: err.message }),
  });

  const handleSave = () => {
    setBanner(null);
    mutation.mutate(parseFloat(value.toFixed(2)));
  };

  if (isLoading) return <p style={{ padding: 24 }}>Loading settings…</p>;

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>Settings</h1>

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

      <div style={cardStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
          Confidence Threshold
        </h2>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
          Waivers with an overall confidence score below this threshold are routed to the Review Queue for human review.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={value}
            onChange={(e) => setValue(parseFloat(e.target.value))}
            style={{ flex: 1 }}
            aria-label="Confidence threshold"
          />
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={value}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              if (!isNaN(n) && n >= 0 && n <= 1) setValue(n);
            }}
            style={{ width: 70, padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: 14, textAlign: 'center' }}
            aria-label="Confidence threshold value"
          />
        </div>

        <button
          className="btn btn-primary"
          style={{ marginTop: 16 }}
          onClick={handleSave}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* ── Field Definitions ── */}
      <FieldDefinitionsCard />

      {/* ── Notification Recipients ── */}
      <NotificationRecipientsCard />

      {/* ── API Keys ── */}
      <ApiKeysCard />
    </div>
  );
}

/* ── Field Definitions Card ────────────────────────── */

function FieldDefinitionsCard() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<FieldSchemaResponse>({
    queryKey: ['settings-extraction-fields'],
    queryFn: () => apiGet<FieldSchemaResponse>('/v1/settings/extraction-fields'),
  });

  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [fieldBanner, setFieldBanner] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [confirmRemoveIdx, setConfirmRemoveIdx] = useState<number | null>(null);

  useEffect(() => {
    if (data?.data && !initialized) {
      setFields([...data.data].sort((a, b) => a.order - b.order));
      setInitialized(true);
    }
  }, [data, initialized]);

  const saveMutation = useMutation({
    mutationFn: (schema: FieldDefinition[]) =>
      apiPut<FieldSchemaResponse>('/v1/settings/extraction-fields', schema),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-extraction-fields'] });
      setFieldBanner({ type: 'success', msg: 'Field definitions saved.' });
    },
    onError: (err: Error) => setFieldBanner({ type: 'error', msg: err.message }),
  });

  const updateField = (idx: number, patch: Partial<FieldDefinition>) => {
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  };

  const addField = () => {
    const maxOrder = fields.length > 0 ? Math.max(...fields.map((f) => f.order)) : -1;
    setFields((prev) => [
      ...prev,
      { key: '', label: '', type: 'text', definition: '', required: false, order: maxOrder + 1 },
    ]);
  };

  const removeField = (idx: number) => {
    setFields((prev) => prev.filter((_, i) => i !== idx));
    setConfirmRemoveIdx(null);
  };

  const moveField = (idx: number, direction: -1 | 1) => {
    const target = idx + direction;
    if (target < 0 || target >= fields.length) return;
    setFields((prev) => {
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next.map((f, i) => ({ ...f, order: i }));
    });
  };

  const handleSave = () => {
    setFieldBanner(null);
    const normalized = fields.map((f, i) => ({ ...f, order: i }));
    saveMutation.mutate(normalized);
  };

  if (isLoading) return <div style={{ ...cardStyle, marginTop: 24 }}><p>Loading field definitions…</p></div>;
  if (error) return <div style={{ ...cardStyle, marginTop: 24 }}><p style={{ color: 'var(--color-red)' }}>Failed to load field definitions.</p></div>;

  return (
    <div style={{ ...cardStyle, marginTop: 24, maxWidth: 900 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Field Definitions</h2>
      <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
        Configure the fields extracted from waiver documents. Changes affect future extractions.
      </p>

      {fieldBanner && (
        <div
          style={{
            padding: '10px 16px',
            borderRadius: 4,
            marginBottom: 12,
            fontSize: 14,
            background: fieldBanner.type === 'error' ? '#fce8e6' : '#e6f4ea',
            color: fieldBanner.type === 'error' ? 'var(--color-red)' : 'var(--color-green)',
          }}
        >
          {fieldBanner.msg}
        </div>
      )}

      {fields.map((field, idx) => (
        <div key={idx} style={fieldRowStyle}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', minWidth: 20 }}>#{idx + 1}</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                style={iconBtnStyle}
                onClick={() => moveField(idx, -1)}
                disabled={idx === 0}
                title="Move up"
                aria-label={`Move field ${field.key || idx + 1} up`}
              >↑</button>
              <button
                style={iconBtnStyle}
                onClick={() => moveField(idx, 1)}
                disabled={idx === fields.length - 1}
                title="Move down"
                aria-label={`Move field ${field.key || idx + 1} down`}
              >↓</button>
            </div>
            <div style={{ marginLeft: 'auto' }}>
              {confirmRemoveIdx === idx ? (
                <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                  Remove?
                  <button style={{ ...iconBtnStyle, color: 'var(--color-red)' }} onClick={() => removeField(idx)}>Yes</button>
                  <button style={iconBtnStyle} onClick={() => setConfirmRemoveIdx(null)}>No</button>
                </span>
              ) : (
                <button
                  style={{ ...iconBtnStyle, color: 'var(--color-red)' }}
                  onClick={() => setConfirmRemoveIdx(idx)}
                  title="Remove field"
                  aria-label={`Remove field ${field.key || idx + 1}`}
                >✕</button>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: 8, marginBottom: 8 }}>
            <label style={fieldLabelStyle}>
              Key
              <input
                type="text"
                value={field.key}
                onChange={(e) => updateField(idx, { key: e.target.value })}
                style={fieldInputStyle}
                placeholder="e.g. airline_code"
                aria-label={`Field ${idx + 1} key`}
              />
            </label>
            <label style={fieldLabelStyle}>
              Label
              <input
                type="text"
                value={field.label}
                onChange={(e) => updateField(idx, { label: e.target.value })}
                style={fieldInputStyle}
                placeholder="e.g. Airline Code"
                aria-label={`Field ${idx + 1} label`}
              />
            </label>
            <label style={fieldLabelStyle}>
              Type
              <select
                value={field.type}
                onChange={(e) => updateField(idx, { type: e.target.value as FieldDefinition['type'] })}
                style={fieldInputStyle}
                aria-label={`Field ${idx + 1} type`}
              >
                {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          </div>

          <label style={fieldLabelStyle}>
            Definition
            <input
              type="text"
              value={field.definition}
              onChange={(e) => updateField(idx, { definition: e.target.value })}
              style={fieldInputStyle}
              placeholder="AI guidance text for extraction"
              aria-label={`Field ${idx + 1} definition`}
            />
          </label>

          <label style={{ ...fieldLabelStyle, flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={field.required}
              onChange={(e) => updateField(idx, { required: e.target.checked })}
              aria-label={`Field ${idx + 1} required`}
            />
            Required
          </label>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn" style={{ border: '1px solid var(--color-border)', borderRadius: 4, padding: '6px 14px', cursor: 'pointer', background: 'none', fontSize: 14 }} onClick={addField}>
          + Add Field
        </button>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? 'Saving…' : 'Save Field Definitions'}
        </button>
      </div>
    </div>
  );
}

/* ── Notification Recipients Card ──────────────────── */

const NOTIF_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface NotifRecipientsResponse {
  data: { recipients: string[] };
}

function NotificationRecipientsCard() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<NotifRecipientsResponse>({
    queryKey: ['settings-notification-recipients'],
    queryFn: () => apiGet<NotifRecipientsResponse>('/v1/settings/notification-recipients'),
  });

  const [recipients, setRecipients] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [notifBanner, setNotifBanner] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  useEffect(() => {
    if (data?.data?.recipients && !initialized) {
      setRecipients([...data.data.recipients]);
      setInitialized(true);
    }
  }, [data, initialized]);

  const saveMutation = useMutation({
    mutationFn: (list: string[]) =>
      apiPut<NotifRecipientsResponse>('/v1/settings/notification-recipients', { recipients: list }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-notification-recipients'] });
      setNotifBanner({ type: 'success', msg: 'Notification recipients saved.' });
    },
    onError: (err: Error) => setNotifBanner({ type: 'error', msg: err.message }),
  });

  const handleAdd = () => {
    const trimmed = newEmail.trim();
    if (!NOTIF_EMAIL_REGEX.test(trimmed)) {
      setEmailError('Please enter a valid email address.');
      return;
    }
    if (recipients.includes(trimmed)) {
      setEmailError('This email is already in the list.');
      return;
    }
    setRecipients((prev) => [...prev, trimmed]);
    setNewEmail('');
    setEmailError('');
    setShowAdd(false);
  };

  const handleRemove = (idx: number) => {
    setRecipients((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = () => {
    setNotifBanner(null);
    saveMutation.mutate(recipients);
  };

  if (isLoading) return <div style={{ ...cardStyle, marginTop: 24 }}><p>Loading notification recipients…</p></div>;
  if (error) return <div style={{ ...cardStyle, marginTop: 24 }}><p style={{ color: 'var(--color-red)' }}>Failed to load notification recipients.</p></div>;

  return (
    <div style={{ ...cardStyle, marginTop: 24, maxWidth: 600 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Notification Recipients</h2>
      <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
        Email addresses that receive notifications when new waiver emails arrive.
      </p>

      {notifBanner && (
        <div style={{
          padding: '10px 16px', borderRadius: 4, marginBottom: 12, fontSize: 14,
          background: notifBanner.type === 'error' ? '#fce8e6' : '#e6f4ea',
          color: notifBanner.type === 'error' ? 'var(--color-red)' : 'var(--color-green)',
        }}>
          {notifBanner.msg}
        </div>
      )}

      {recipients.length === 0 && !showAdd && (
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 12 }}>No recipients configured.</p>
      )}

      {recipients.map((email, idx) => (
        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 14, flex: 1 }}>{email}</span>
          <button
            style={{ ...iconBtnStyle, color: 'var(--color-red)' }}
            onClick={() => handleRemove(idx)}
            aria-label={`Remove ${email}`}
          >✕</button>
        </div>
      ))}

      {showAdd && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => { setNewEmail(e.target.value); setEmailError(''); }}
              placeholder="email@example.com"
              style={fieldInputStyle}
              aria-label="New recipient email"
            />
            {emailError && <p style={{ fontSize: 12, color: 'var(--color-red)', marginTop: 4 }}>{emailError}</p>}
          </div>
          <button style={iconBtnStyle} onClick={handleAdd}>Add</button>
          <button style={iconBtnStyle} onClick={() => { setShowAdd(false); setNewEmail(''); setEmailError(''); }}>Cancel</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {!showAdd && (
          <button
            className="btn"
            style={{ border: '1px solid var(--color-border)', borderRadius: 4, padding: '6px 14px', cursor: 'pointer', background: 'none', fontSize: 14 }}
            onClick={() => setShowAdd(true)}
            disabled={recipients.length >= 20}
          >
            + Add Recipient
          </button>
        )}
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

/* ── API Keys Card ─────────────────────────────────── */

interface ApiKeyRecord {
  key: string;
  name: string;
  apiGatewayKeyId: string;
  active: boolean;
  createdAt: string;
  usageCount?: number;
}

interface ApiKeysResponse {
  data: ApiKeyRecord[];
}

interface CreateApiKeyResponse {
  data: { keyId: string; name: string; value: string; createdAt: string };
}

function ApiKeysCard() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<ApiKeysResponse>({
    queryKey: ['settings-api-keys'],
    queryFn: () => apiGet<ApiKeysResponse>('/v1/settings/api-keys'),
  });

  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKeyValue, setCreatedKeyValue] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [keyBanner, setKeyBanner] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const createMutation = useMutation({
    mutationFn: (name: string) =>
      apiPost<CreateApiKeyResponse>('/v1/settings/api-keys', { name }),
    onSuccess: (res) => {
      setCreatedKeyValue(res.data.value);
      setNewKeyName('');
      queryClient.invalidateQueries({ queryKey: ['settings-api-keys'] });
      setKeyBanner({ type: 'success', msg: 'API key created.' });
    },
    onError: (err: Error) => setKeyBanner({ type: 'error', msg: err.message }),
  });

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) =>
      apiDelete<unknown>(`/v1/settings/api-keys/${keyId}`),
    onSuccess: () => {
      setConfirmRevokeId(null);
      queryClient.invalidateQueries({ queryKey: ['settings-api-keys'] });
      setKeyBanner({ type: 'success', msg: 'API key revoked.' });
    },
    onError: (err: Error) => setKeyBanner({ type: 'error', msg: err.message }),
  });

  const handleCreate = () => {
    if (!newKeyName.trim()) return;
    setKeyBanner(null);
    setCreatedKeyValue(null);
    setCopied(false);
    createMutation.mutate(newKeyName.trim());
  };

  const handleCopy = () => {
    if (createdKeyValue) {
      navigator.clipboard.writeText(createdKeyValue);
      setCopied(true);
    }
  };

  if (isLoading) return <div style={{ ...cardStyle, marginTop: 24 }}><p>Loading API keys…</p></div>;
  if (error) return <div style={{ ...cardStyle, marginTop: 24 }}><p style={{ color: 'var(--color-red)' }}>Failed to load API keys.</p></div>;

  const keys = data?.data ?? [];

  return (
    <div style={{ ...cardStyle, marginTop: 24, maxWidth: 900 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>API Keys</h2>
      <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
        Manage API keys for third-party access to the public API.
      </p>

      {keyBanner && (
        <div style={{
          padding: '10px 16px', borderRadius: 4, marginBottom: 12, fontSize: 14,
          background: keyBanner.type === 'error' ? '#fce8e6' : '#e6f4ea',
          color: keyBanner.type === 'error' ? 'var(--color-red)' : 'var(--color-green)',
        }}>
          {keyBanner.msg}
        </div>
      )}

      {createdKeyValue && (
        <div style={{ padding: 12, marginBottom: 12, border: '1px solid var(--color-border)', borderRadius: 6, background: '#fffbe6' }}>
          <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#b45309' }}>
            Copy this key now — it won't be shown again.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code style={{ flex: 1, fontSize: 13, wordBreak: 'break-all' }}>{createdKeyValue}</code>
            <button style={iconBtnStyle} onClick={handleCopy} aria-label="Copy API key">
              {copied ? '✓' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
            <th style={{ padding: '8px 4px' }}>Name</th>
            <th style={{ padding: '8px 4px' }}>Created</th>
            <th style={{ padding: '8px 4px' }}>Status</th>
            <th style={{ padding: '8px 4px' }}>Usage</th>
            <th style={{ padding: '8px 4px' }}></th>
          </tr>
        </thead>
        <tbody>
          {keys.length === 0 && (
            <tr><td colSpan={5} style={{ padding: 12, color: 'var(--color-text-secondary)', textAlign: 'center' }}>No API keys yet.</td></tr>
          )}
          {keys.map((k) => (
            <tr key={k.key} style={{ borderBottom: '1px solid var(--color-border)' }}>
              <td style={{ padding: '8px 4px' }}>{k.name}</td>
              <td style={{ padding: '8px 4px' }}>{new Date(k.createdAt).toLocaleDateString()}</td>
              <td style={{ padding: '8px 4px' }}>
                <span style={{
                  padding: '2px 8px', borderRadius: 10, fontSize: 12, fontWeight: 600,
                  background: k.active ? '#e6f4ea' : '#fce8e6',
                  color: k.active ? 'var(--color-green)' : 'var(--color-red)',
                }}>
                  {k.active ? 'Active' : 'Revoked'}
                </span>
              </td>
              <td style={{ padding: '8px 4px' }}>{k.usageCount ?? 0}</td>
              <td style={{ padding: '8px 4px' }}>
                {k.active && (
                  confirmRevokeId === k.apiGatewayKeyId ? (
                    <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                      Revoke?
                      <button style={{ ...iconBtnStyle, color: 'var(--color-red)' }} onClick={() => revokeMutation.mutate(k.apiGatewayKeyId)}>Yes</button>
                      <button style={iconBtnStyle} onClick={() => setConfirmRevokeId(null)}>No</button>
                    </span>
                  ) : (
                    <button style={{ ...iconBtnStyle, color: 'var(--color-red)' }} onClick={() => setConfirmRevokeId(k.apiGatewayKeyId)} aria-label={`Revoke key ${k.name}`}>
                      Revoke
                    </button>
                  )
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showCreate ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Key name"
            style={fieldInputStyle}
            aria-label="New API key name"
          />
          <button className="btn btn-primary" onClick={handleCreate} disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creating…' : 'Create'}
          </button>
          <button style={iconBtnStyle} onClick={() => { setShowCreate(false); setNewKeyName(''); }}>Cancel</button>
        </div>
      ) : (
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          Create API Key
        </button>
      )}
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

const fieldRowStyle: React.CSSProperties = {
  padding: 12,
  marginBottom: 8,
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  background: '#fafafa',
};

const fieldLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--color-text-secondary)',
};

const fieldInputStyle: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  fontSize: 14,
  outline: 'none',
};

const iconBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  padding: '2px 8px',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
};
