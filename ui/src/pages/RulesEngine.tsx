import { useState } from 'react';

interface Rule {
  id: string;
  name: string;
  description: string;
  condition: string;
  action: string;
  enabled: boolean;
}

const SAMPLE_RULES: Rule[] = [
  {
    id: 'r1',
    name: 'Auto-approve high confidence',
    description: 'Automatically approve waivers with confidence above threshold',
    condition: 'overall_confidence >= confidence_threshold',
    action: 'Set status to auto_approved',
    enabled: true,
  },
  {
    id: 'r2',
    name: 'Flag expired waivers',
    description: 'Mark waivers as expired when expiration date passes',
    condition: 'expiration_date < current_date AND status = active',
    action: 'Set status to expired',
    enabled: true,
  },
  {
    id: 'r3',
    name: 'High-impact priority boost',
    description: 'Boost review priority for waivers with material field changes',
    condition: 'high_impact = true',
    action: 'Move to top of review queue',
    enabled: true,
  },
  {
    id: 'r4',
    name: 'Duplicate detection',
    description: 'Flag potential duplicates based on airline + waiver code + dates',
    condition: 'matching airline_code + waiver_code + effective_date exists',
    action: 'Tag as potential_duplicate for review',
    enabled: true,
  },
];

export function RulesEngine() {
  const [rules, setRules] = useState<Rule[]>(SAMPLE_RULES);

  const toggleRule = (id: string) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
    );
  };

  return (
    <div>
      <h1 style={S.heading}>Rules Engine</h1>
      <p style={S.subtitle}>
        Configure automated rules that govern waiver processing, routing, and lifecycle management.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {rules.map((rule) => (
          <div key={rule.id} className="card" style={{ opacity: rule.enabled ? 1 : 0.6 }}>
            <div style={S.ruleHeader}>
              <div>
                <div style={S.ruleName}>{rule.name}</div>
                <div style={S.ruleDesc}>{rule.description}</div>
              </div>
              <label style={S.toggle}>
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={() => toggleRule(rule.id)}
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
          </div>
        ))}
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
