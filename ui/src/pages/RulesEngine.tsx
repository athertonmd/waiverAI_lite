import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut } from '../api/client';

/* ── Types ─────────────────────────────────────────── */

interface RuleRecord {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  parameters: Record<string, unknown>;
  condition: string;
  action: string;
  updated_at: string;
}

interface RulesResponse {
  data: RuleRecord[];
}

interface RuleResponse {
  data: RuleRecord;
}

/** Extract the ruleId from the key (e.g. "rule:auto_approve_threshold" → "auto_approve_threshold") */
function ruleIdFromKey(key: string): string {
  return key.replace(/^rule:/, '');
}

/* ── Component ─────────────────────────────────────── */

export function RulesEngine() {
  const queryClient = useQueryClient();
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  /* ── Fetch rules ── */
  const { data, isLoading, error } = useQuery<RulesResponse>({
    queryKey: ['rules'],
    queryFn: () => apiGet<RulesResponse>('/v1/rules'),
  });

  const rules = data?.data ?? [];

  /* ── Toggle mutation with optimistic update ── */
  const toggleMutation = useMutation({
    mutationFn: ({ ruleId, enabled }: { ruleId: string; enabled: boolean }) =>
      apiPut<RuleResponse>(`/v1/rules/${ruleId}`, { enabled }),
    onMutate: async ({ ruleId, enabled }) => {
      setBanner(null);
      await queryClient.cancelQueries({ queryKey: ['rules'] });
      const previous = queryClient.getQueryData<RulesResponse>(['rules']);
      queryClient.setQueryData<RulesResponse>(['rules'], (old) => {
        if (!old) return old;
        return {
          ...old,
          data: old.data.map((r) =>
            ruleIdFromKey(r.key) === ruleId ? { ...r, enabled } : r,
          ),
        };
      });
      return { previous };
    },
    onError: (err: Error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['rules'], context.previous);
      }
      setBanner({ type: 'error', msg: `Toggle failed: ${err.message}` });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
    },
  });

  /* ── Loading / Error states ── */
  if (isLoading) return <p style={{ padding: 24 }}>Loading rules…</p>;
  if (error) return <p style={{ padding: 24, color: 'var(--color-red)' }}>Failed to load rules: {(error as Error).message}</p>;

  return (
    <div>
      <h1 style={S.heading}>Rules Engine</h1>
      <p style={S.subtitle}>
        Configure automated rules that govern waiver processing, routing, and lifecycle management.
      </p>

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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {rules.map((rule) => {
          const ruleId = ruleIdFromKey(rule.key);
          return (
            <div key={rule.key} className="card" style={{ opacity: rule.enabled ? 1 : 0.6 }}>
              <div style={S.ruleHeader}>
                <div>
                  <div style={S.ruleName}>{rule.name}</div>
                  <div style={S.ruleDesc}>{rule.description}</div>
                </div>
                <label style={S.toggle}>
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={() => toggleMutation.mutate({ ruleId, enabled: !rule.enabled })}
                    aria-label={`Toggle ${rule.name}`}
                  />
                  <span style={S.toggleLabel}>{rule.enabled ? 'Enabled' : 'Disabled'}</span>
                </label>
              </div>
              <div style={S.ruleDetails}>
                <div style={S.detailRow}>
                  <span style={S.detailLabel}>Condition:</span>
                  <code style={S.code}>{rule.condition}</code>
                </div>
                <div style={S.detailRow}>
                  <span style={S.detailLabel}>Action:</span>
                  <code style={S.code}>{rule.action}</code>
                </div>
              </div>

              {/* Threshold parameter editing for auto_approve_threshold */}
              {ruleId === 'auto_approve_threshold' && (
                <ThresholdEditor
                  currentThreshold={(rule.parameters?.threshold as number) ?? 0.85}
                  onSuccess={(msg) => setBanner({ type: 'success', msg })}
                  onError={(msg) => setBanner({ type: 'error', msg })}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginTop: 24, background: '#f0f4ff', border: '1px dashed var(--color-primary)' }}>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: 0 }}>
          Custom rule creation coming soon. Rules will support conditions on any waiver field
          and actions like auto-approve, flag for review, send notification, or trigger webhook.
        </p>
      </div>
    </div>
  );
}

/* ── Threshold Editor Sub-Component ────────────────── */

function ThresholdEditor({
  currentThreshold,
  onSuccess,
  onError,
}: {
  currentThreshold: number;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState<string>(currentThreshold.toString());
  const [validationError, setValidationError] = useState('');

  const mutation = useMutation({
    mutationFn: (threshold: number) =>
      apiPut<RuleResponse>('/v1/rules/auto_approve_threshold', {
        parameters: { threshold },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      onSuccess('Threshold updated successfully.');
    },
    onError: (err: Error) => onError(`Threshold update failed: ${err.message}`),
  });

  const handleSave = () => {
    setValidationError('');
    const num = parseFloat(value);
    if (isNaN(num) || num < 0 || num > 1) {
      setValidationError('Threshold must be between 0.0 and 1.0.');
      return;
    }
    mutation.mutate(num);
  };

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
          Threshold:
        </label>
        <input
          type="number"
          min={0}
          max={1}
          step={0.01}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setValidationError('');
          }}
          style={{
            width: 80,
            padding: '4px 8px',
            border: `1px solid ${validationError ? 'var(--color-red)' : 'var(--color-border)'}`,
            borderRadius: 4,
            fontSize: 14,
            textAlign: 'center',
          }}
          aria-label="Auto-approve confidence threshold"
        />
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={mutation.isPending}
          style={{ padding: '4px 12px', fontSize: 13 }}
        >
          {mutation.isPending ? 'Saving…' : 'Update'}
        </button>
      </div>
      {validationError && (
        <p style={{ fontSize: 12, color: 'var(--color-red)', marginTop: 4 }}>{validationError}</p>
      )}
    </div>
  );
}

/* ── Styles ────────────────────────────────────────── */

const S: Record<string, React.CSSProperties> = {
  heading: { fontSize: 24, fontWeight: 600, marginBottom: 4 },
  subtitle: { fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 20 },
  ruleHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  ruleName: { fontSize: 16, fontWeight: 600, marginBottom: 4 },
  ruleDesc: { fontSize: 13, color: 'var(--color-text-secondary)' },
  toggle: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flexShrink: 0 },
  toggleLabel: { fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' },
  ruleDetails: { display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8, borderTop: '1px solid var(--color-border)' },
  detailRow: { display: 'flex', alignItems: 'center', gap: 8 },
  detailLabel: { fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', minWidth: 70 },
  code: { fontSize: 13, background: '#f5f5f5', padding: '2px 8px', borderRadius: 4, fontFamily: 'monospace' },
};
