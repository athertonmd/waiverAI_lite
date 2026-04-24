import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPut } from '../api/client';
import { useRole } from '../auth/RoleContext';

/* ── Types ─────────────────────────────────────────── */

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

interface WaiverRecord {
  id: string;
  confidence_scores: Record<string, number>;
  overall_confidence: number;
  status: string;
  source_type: string;
  source_s3_key: string;
  normalized_s3_key: string;
  ingestion_timestamp: string;
  is_duplicate?: boolean;
  duplicate_of_id?: string | null;
  duplicate_count?: number;
  airline_code?: string;
  waiver_code?: string;
  [field: string]: unknown;
}

interface WaiverResponse {
  data: WaiverRecord;
}

interface GroupCopy {
  id: string;
  ingestion_timestamp: string;
  source_type: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface WaiverVersion {
  id: string;
  waiver_id: string;
  version_number: number;
  data: Record<string, unknown>;
  changed_by: string | null;
  changed_at: string;
}

/* ── Color palette for source viewer highlighting ──── */

const COLOR_PALETTE = [
  '#bbdefb', '#c8e6c9', '#fff9c4', '#f8bbd0', '#e1bee7',
  '#b2dfdb', '#ffe0b2', '#d1c4e9', '#ffccbc', '#b3e5fc',
  '#dcedc8', '#f0f4c3', '#ffcdd2', '#cfd8dc',
];

function getFieldColor(index: number): string {
  return COLOR_PALETTE[index % COLOR_PALETTE.length];
}

/* ── Component ─────────────────────────────────────── */

export function WaiverDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin } = useRole();

  /* Split-screen divider */
  const [leftWidth, setLeftWidth] = useState(50);
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const onMouseDown = useCallback(() => { dragging.current = true; }, []);
  const onMouseUp = useCallback(() => { dragging.current = false; }, []);
  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setLeftWidth(Math.min(80, Math.max(20, pct)));
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  /* Fetch schema */
  const { data: schemaData } = useQuery<FieldSchemaResponse>({
    queryKey: ['settings-extraction-fields'],
    queryFn: () => apiGet<FieldSchemaResponse>('/v1/settings/extraction-fields'),
  });
  const schema = schemaData?.data ? [...schemaData.data].sort((a, b) => a.order - b.order) : [];

  /* Fetch waiver */
  const { data, isLoading, error: fetchError } = useQuery<WaiverResponse>({
    queryKey: ['waiver', id],
    queryFn: () => apiGet<WaiverResponse>(`/v1/waivers/${id}`),
    enabled: !!id,
  });

  const waiver = data?.data;

  /* Check if original waiver exists (for duplicate notice) */
  const duplicateOfId = waiver?.duplicate_of_id;

  /* Version history */
  const [showVersions, setShowVersions] = useState(false);
  const [showCopies, setShowCopies] = useState(false);
  const [expandedPanel, setExpandedPanel] = useState<'source' | 'data' | null>(null);
  const [compareVersion, setCompareVersion] = useState<WaiverVersion | null>(null);
  const { data: versionsData } = useQuery<{ data: WaiverVersion[] }>({
    queryKey: ['waiver-versions', id],
    queryFn: () => apiGet<{ data: WaiverVersion[] }>(`/v1/waivers/${id}/versions`),
    enabled: !!id && showVersions,
  });

  /* Fetch group copies when duplicate_count > 1 */
  const duplicateCount = waiver?.duplicate_count ?? 1;
  const airlineCode = waiver?.airline_code;
  const waiverCode = waiver?.waiver_code;
  const { data: groupCopiesData, error: groupCopiesError } = useQuery<{ data: GroupCopy[] }>({
    queryKey: ['waiver-group-copies', airlineCode, waiverCode],
    queryFn: () => apiGet<{ data: GroupCopy[] }>('/v1/waivers/group', { airline: airlineCode!, waiverCode: waiverCode! }),
    enabled: !!airlineCode && !!waiverCode,
  });
  const otherCopies = (groupCopiesData?.data ?? []).filter((c) => c.id !== id);

  /* Form state — dynamic, keyed by schema field keys */
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [original, setOriginal] = useState<Record<string, string> | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [banner, setBanner] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [sourceContent, setSourceContent] = useState('');

  /* Populate form when waiver + schema load */
  useEffect(() => {
    if (waiver && schema.length > 0 && !form) {
      const f: Record<string, string> = {};
      for (const field of schema) {
        let raw = waiver[field.key];
        // Backward compat: if schema has 'airports' but record only has 'applicable_routes'
        if (field.key === 'airports' && raw == null && waiver.applicable_routes != null) {
          raw = waiver.applicable_routes;
        }
        if (field.type === 'array' && Array.isArray(raw)) {
          f[field.key] = raw.join(', ');
        } else {
          f[field.key] = String(raw ?? '');
        }
      }
      setForm(f);
      setOriginal(f);
    }
  }, [waiver, schema, form]);

  /* Helpers */
  const isModified = (key: string) => form && original && form[key] !== original[key];

  const modifiedFields = (): Record<string, unknown> | null => {
    if (!form || !original) return null;
    const changes: Record<string, unknown> = {};
    for (const field of schema) {
      if (form[field.key] !== original[field.key]) {
        if (field.type === 'array') {
          changes[field.key] = form[field.key].split(',').map((s) => s.trim()).filter(Boolean);
        } else {
          changes[field.key] = form[field.key];
        }
      }
    }
    return Object.keys(changes).length ? changes : null;
  };

  const validate = (): string[] => {
    const errs: string[] = [];
    if (!form) return errs;
    const requiredFields = schema.filter((f) => f.required);
    for (const f of requiredFields) {
      if (!form[f.key]?.trim()) errs.push(`${f.label} is required.`);
    }
    // Date ordering check for effective/expiration if both exist
    if (form.effective_date && form.expiration_date && form.effective_date >= form.expiration_date) {
      errs.push('Effective date must be before expiration date.');
    }
    return errs;
  };

  /* Mutations */
  const approveMutation = useMutation({
    mutationFn: async () => {
      const body = modifiedFields() ?? {};
      await apiPost(`/v1/waivers/${id}/approve`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-queue'] });
      queryClient.invalidateQueries({ queryKey: ['waivers'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      navigate('/review');
    },
    onError: (err: Error) => setBanner({ type: 'error', msg: err.message }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (reason: string) => {
      await apiPost(`/v1/waivers/${id}/reject`, { reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-queue'] });
      queryClient.invalidateQueries({ queryKey: ['waivers'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      navigate('/review');
    },
    onError: (err: Error) => setBanner({ type: 'error', msg: err.message }),
  });

  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      const body = modifiedFields() ?? {};
      await apiPut(`/v1/waivers/${id}/draft`, body);
    },
    onSuccess: () => {
      setBanner({ type: 'success', msg: 'Draft saved.' });
      setOriginal(form);
      queryClient.invalidateQueries({ queryKey: ['waiver', id] });
      queryClient.invalidateQueries({ queryKey: ['waivers'] });
      queryClient.invalidateQueries({ queryKey: ['review-queue'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: Error) => setBanner({ type: 'error', msg: err.message }),
  });

  const handleApprove = () => {
    const errs = validate();
    if (errs.length) { setValidationErrors(errs); return; }
    setValidationErrors([]);
    approveMutation.mutate();
  };

  const handleRejectSubmit = () => {
    if (!rejectReason.trim()) return;
    setRejectModalOpen(false);
    rejectMutation.mutate(rejectReason);
  };

  const handleSaveDraft = () => {
    const errs = validate();
    if (errs.length) { setValidationErrors(errs); return; }
    setValidationErrors([]);
    saveDraftMutation.mutate();
  };

  const setField = (key: string, value: string) => {
    setForm((prev) => prev ? { ...prev, [key]: value } : prev);
  };

  /* Loading / error states */
  if (isLoading) return <p style={{ padding: 24 }}>Loading waiver…</p>;
  if (fetchError) return <p style={{ padding: 24, color: 'var(--color-red)' }}>Failed to load waiver.</p>;
  if (!waiver) return <p style={{ padding: 24 }}>Waiver not found.</p>;
  if (!form) return <p style={{ padding: 24 }}>Loading form…</p>;

  const confidenceScores = (waiver.confidence_scores && typeof waiver.confidence_scores === 'object') ? waiver.confidence_scores : {} as Record<string, number>;

  /* Build color map from schema */
  const fieldColorMap: Record<string, string> = {};
  schema.forEach((f, i) => { fieldColorMap[f.key] = getFieldColor(i); });

  /* Build label map from schema */
  const fieldLabelMap: Record<string, string> = {};
  schema.forEach((f) => { fieldLabelMap[f.key] = f.label; });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={S.header}>
        <button className="btn" style={S.backBtn} onClick={() => navigate('/review')}>← Back</button>
        <h1 style={S.heading}>{form.waiver_code || (waiver.waiver_code as string) || ''} — {form.airline_code || (waiver.airline_code as string) || ''}</h1>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button className="btn" style={S.draftBtn} onClick={handleSaveDraft} disabled={saveDraftMutation.isPending}>
              {saveDraftMutation.isPending ? 'Saving…' : 'Save Draft'}
            </button>
            <button className="btn" style={S.rejectBtn} onClick={() => setRejectModalOpen(true)} disabled={rejectMutation.isPending}>
              Reject
            </button>
            <button className="btn btn-primary" onClick={handleApprove} disabled={approveMutation.isPending}>
              {approveMutation.isPending ? 'Approving…' : 'Approve'}
            </button>
          </div>
        )}
      </div>

      {/* Banner */}
      {banner && (
        <div
          style={{
            ...S.bannerStyle,
            background: banner.type === 'error' ? '#fce8e6' : '#e6f4ea',
            color: banner.type === 'error' ? 'var(--color-red)' : 'var(--color-green)',
          }}
        >
          {banner.msg}
          <button onClick={() => setBanner(null)} style={S.bannerClose}>✕</button>
        </div>
      )}

      {/* Validation errors */}
      {validationErrors.length > 0 && (
        <div style={{ ...S.bannerStyle, background: '#fce8e6', color: 'var(--color-red)' }}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {validationErrors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {/* Duplicate notice */}
      {(waiver?.is_duplicate || otherCopies.length > 0) && (
        <div style={{ ...S.bannerStyle, background: '#fff3e0', color: '#e65100' }}>
          <span>⚠ This waiver has {otherCopies.length > 0 ? otherCopies.length : ''} other {otherCopies.length === 1 ? 'copy' : 'copies'}. Use "Show Previous Copies" below to view them.</span>
        </div>
      )}

      {/* Split-screen */}
      <div ref={containerRef} style={S.splitContainer}>
        {/* Left panel — source viewer */}
        <div style={{ ...S.panel, width: `${leftWidth}%` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexShrink: 0 }}>
            <h2 style={{ ...S.panelTitle, marginBottom: 0 }}>Source Document</h2>
            <button onClick={() => setExpandedPanel('source')} style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 12 }} title="Expand">⛶</button>
          </div>
          <SourceViewer
            waiverId={waiver.id}
            sourceType={waiver.source_type}
            extractedFields={form}
            fieldColorMap={fieldColorMap}
            fieldLabelMap={fieldLabelMap}
            onContentLoaded={setSourceContent}
          />
        </div>

        {/* Divider */}
        <div style={S.divider} onMouseDown={onMouseDown} role="separator" aria-label="Resize panels" />

        {/* Right panel — editable form */}
        <div style={{ ...S.panel, width: `${100 - leftWidth}%` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexShrink: 0 }}>
            <h2 style={{ ...S.panelTitle, marginBottom: 0 }}>Extracted Data</h2>
            <button onClick={() => setExpandedPanel('data')} style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 12 }} title="Expand">⛶</button>
          </div>
          <div style={S.formScroll}>
            {schema.map((fieldDef, idx) => {
              const key = fieldDef.key;
              const isTextArea = fieldDef.type === 'textarea';
              const isArray = fieldDef.type === 'array';
              const isDate = fieldDef.type === 'date';
              const useTextArea = isTextArea || isArray;
              const confidence = confidenceScores[key];
              const modified = isModified(key);

              const fieldValue = form[key] ?? '';
              const hasSourceMatch = fieldValue && fieldValue.length >= 2 && sourceContent
                ? sourceContent.toLowerCase().includes(fieldValue.toLowerCase())
                : false;
              const fieldColor = hasSourceMatch ? getFieldColor(idx) : undefined;

              return (
                <div key={key} style={{ ...S.fieldGroup, ...(modified ? S.fieldModified : {}) }}>
                  <div style={S.fieldLabelRow}>
                    <label style={{ ...S.fieldLabel, ...(fieldColor ? { color: 'var(--color-text)' } : {}) }}>
                      {fieldColor && <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: fieldColor, marginRight: 6 }} />}
                      {fieldDef.label}
                      {fieldDef.required && <span style={{ color: 'var(--color-red)', marginLeft: 2 }}>*</span>}
                    </label>
                    {confidence !== undefined && <FieldConfidenceBadge value={confidence} />}
                  </div>
                  {useTextArea ? (
                    <>
                      <textarea
                        value={fieldValue}
                        onChange={(e) => setField(key, e.target.value)}
                        style={{ ...S.textarea, ...(fieldColor ? { borderColor: fieldColor, borderWidth: 2, background: `${fieldColor}15` } : {}) }}
                        rows={isArray ? 2 : 3}
                        aria-label={fieldDef.label}
                        readOnly={!isAdmin}
                        disabled={!isAdmin}
                        {...(key === 'release_notes' ? { maxLength: 500 } : {})}
                      />
                      {key === 'release_notes' && (
                        <div style={{ fontSize: 11, color: fieldValue.length > 480 ? 'var(--color-red)' : 'var(--color-text-secondary)', textAlign: 'right', marginTop: 2 }}>
                          {fieldValue.length}/500
                        </div>
                      )}
                    </>
                  ) : (
                    <input
                      type={isDate ? 'date' : 'text'}
                      value={fieldValue}
                      onChange={(e) => setField(key, e.target.value)}
                      style={{ ...S.input, ...(fieldColor ? { borderColor: fieldColor, borderWidth: 2, background: `${fieldColor}15` } : {}) }}
                      aria-label={fieldDef.label}
                      readOnly={!isAdmin}
                      disabled={!isAdmin}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Version History toggle */}
      <div style={{ padding: '12px 0', flexShrink: 0 }}>
        <button
          className="btn"
          style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 4, padding: '6px 14px', cursor: 'pointer', fontSize: 14 }}
          onClick={() => setShowVersions((v) => !v)}
        >
          {showVersions ? 'Hide Version History' : 'Show Version History'}
        </button>
      </div>

      {/* Version History list */}
      {showVersions && versionsData && (
        <div style={{ ...S.panel, marginBottom: 12, maxHeight: 300, overflowY: 'auto', width: '100%' }}>
          <h2 style={S.panelTitle}>Version History</h2>
          {versionsData.data.length === 0 ? (
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>No previous versions.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th style={thStyle}>Version</th>
                  <th style={thStyle}>Changed By</th>
                  <th style={thStyle}>Changed At</th>
                  <th style={thStyle}>Action</th>
                </tr>
              </thead>
              <tbody>
                {versionsData.data.map((v) => (
                  <tr key={v.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={tdStyle}>v{v.version_number}</td>
                    <td style={tdStyle}>{v.changed_by ?? '—'}</td>
                    <td style={tdStyle}>{new Date(v.changed_at).toLocaleString()}</td>
                    <td style={tdStyle}>
                      <button
                        className="btn"
                        style={{ fontSize: 12, padding: '4px 10px', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', background: 'none' }}
                        onClick={() => setCompareVersion(v)}
                      >
                        Compare
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Version comparison modal */}
      {compareVersion && waiver && (
        <div style={S.modalOverlay}>
          <div style={{ ...S.modal, width: 700, maxWidth: '95vw', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>Compare: Current vs v{compareVersion.version_number}</h3>
              <button onClick={() => setCompareVersion(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                  <th style={thStyle}>Field</th>
                  <th style={thStyle}>Current</th>
                  <th style={thStyle}>v{compareVersion.version_number}</th>
                </tr>
              </thead>
              <tbody>
                {schema.map((fieldDef) => {
                  const current = String(waiver[fieldDef.key] ?? '');
                  const old = String(compareVersion.data[fieldDef.key] ?? '');
                  const changed = current !== old;
                  return (
                    <tr key={fieldDef.key} style={{ borderBottom: '1px solid var(--color-border)', background: changed ? '#fff8e1' : 'transparent' }}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{fieldDef.label}</td>
                      <td style={tdStyle}>{current}</td>
                      <td style={tdStyle}>{old}</td>
                    </tr>
                  );
                })}
                {/* Also compare overall_confidence and status */}
                {['overall_confidence', 'status'].map((field) => {
                  const current = String(waiver[field] ?? '');
                  const old = String(compareVersion.data[field] ?? '');
                  const changed = current !== old;
                  return (
                    <tr key={field} style={{ borderBottom: '1px solid var(--color-border)', background: changed ? '#fff8e1' : 'transparent' }}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{field}</td>
                      <td style={tdStyle}>{current}</td>
                      <td style={tdStyle}>{old}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Previous copies section — collapsible */}
      {otherCopies.length > 0 && (
        <div style={{ padding: '12px 0', flexShrink: 0 }}>
          <button
            className="btn"
            style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 4, padding: '6px 14px', cursor: 'pointer', fontSize: 14 }}
            onClick={() => setShowCopies((v) => !v)}
          >
            {showCopies ? 'Hide' : 'Show'} Previous Copies ({otherCopies.length})
          </button>
        </div>
      )}
      {showCopies && otherCopies.length > 0 && (
        <div className="card" style={{ marginBottom: 12, padding: 16, maxHeight: 300, overflowY: 'auto' }}>
          <h2 style={S.panelTitle}>Previous copies</h2>
          {groupCopiesError ? (
            <p style={{ color: 'var(--color-red)', fontSize: 14 }}>Failed to load group copies.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th style={thStyle}>Ingested</th>
                  <th style={thStyle}>Source</th>
                  <th style={thStyle}>Updated</th>
                  <th style={thStyle}>Link</th>
                </tr>
              </thead>
              <tbody>
                {otherCopies.map((copy) => (
                  <tr key={copy.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={tdStyle}>{new Date(copy.ingestion_timestamp).toLocaleString()}</td>
                    <td style={tdStyle}>{copy.source_type}</td>
                    <td style={tdStyle}>{new Date(copy.updated_at).toLocaleString()}</td>
                    <td style={tdStyle}>
                      <a
                        href={`/waivers/${copy.id}`}
                        onClick={(e) => { e.preventDefault(); navigate(`/waivers/${copy.id}`); }}
                        style={{ color: 'var(--color-primary)' }}
                      >
                        View
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Reject reason modal */}
      {rejectModalOpen && (
        <div style={S.modalOverlay}>
          <div style={S.modal}>
            <h3 style={{ margin: '0 0 12px' }}>Rejection Reason</h3>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Enter reason for rejection…"
              style={{ ...S.textarea, width: '100%' }}
              rows={4}
              aria-label="Rejection reason"
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" style={S.draftBtn} onClick={() => setRejectModalOpen(false)}>Cancel</button>
              <button className="btn" style={S.rejectBtn} onClick={handleRejectSubmit} disabled={!rejectReason.trim()}>
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full-screen panel overlay */}
      {expandedPanel && (
        <div style={S.modalOverlay}>
          <div style={{ background: 'var(--color-card)', borderRadius: 8, width: '95vw', height: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{expandedPanel === 'source' ? 'Source Document' : 'Extracted Data'}</h2>
              <button onClick={() => setExpandedPanel(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, padding: '4px 8px' }} aria-label="Close fullscreen">✕</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
              {expandedPanel === 'source' && (
                <SourceViewer
                  waiverId={waiver.id}
                  sourceType={waiver.source_type}
                  extractedFields={form}
                  fieldColorMap={fieldColorMap}
                  fieldLabelMap={fieldLabelMap}
                  onContentLoaded={setSourceContent}
                />
              )}
              {expandedPanel === 'data' && (
                <div>
                  {schema.map((fieldDef) => {
                    const key = fieldDef.key;
                    const isTextArea = fieldDef.type === 'textarea';
                    const isArray = fieldDef.type === 'array';
                    const isDate = fieldDef.type === 'date';
                    const useTextArea = isTextArea || isArray;
                    const confidence = confidenceScores[key];
                    const fieldValue = form[key] ?? '';
                    return (
                      <div key={key} style={{ marginBottom: 14, padding: '8px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                          <label style={S.fieldLabel}>
                            {fieldDef.label}
                            {fieldDef.required && <span style={{ color: 'var(--color-red)', marginLeft: 2 }}>*</span>}
                          </label>
                          {confidence !== undefined && <FieldConfidenceBadge value={confidence} />}
                        </div>
                        {useTextArea ? (
                          <>
                            <textarea value={fieldValue} onChange={(e) => setField(key, e.target.value)} style={S.textarea} rows={isArray ? 2 : 3} aria-label={fieldDef.label} readOnly={!isAdmin} disabled={!isAdmin} {...(key === 'release_notes' ? { maxLength: 500 } : {})} />
                            {key === 'release_notes' && (
                              <div style={{ fontSize: 11, color: fieldValue.length > 480 ? 'var(--color-red)' : 'var(--color-text-secondary)', textAlign: 'right', marginTop: 2 }}>
                                {fieldValue.length}/500
                              </div>
                            )}
                          </>
                        ) : (
                          <input type={isDate ? 'date' : 'text'} value={fieldValue} onChange={(e) => setField(key, e.target.value)} style={S.input} aria-label={fieldDef.label} readOnly={!isAdmin} disabled={!isAdmin} />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: 'var(--color-text-secondary)' };
const tdStyle: React.CSSProperties = { padding: '8px 10px', wordBreak: 'break-word' };

/* ── Sub-components ────────────────────────────────── */

/** Detect if text content is likely binary garbage (images, PDFs read as text). */
function isBinaryText(text: string): boolean {
  if (!text || text.length < 20) return false;
  const sample = text.slice(0, 200);
  let nonPrintable = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) nonPrintable++;
    if (code > 65533) nonPrintable++;
  }
  return nonPrintable / sample.length > 0.05;
}

/** Detect if text content is a CDN/WAF error page rather than real content. */
function isErrorPageContent(text: string): boolean {
  if (!text || text.length > 2000) return false;
  const lower = text.toLowerCase();
  return ['access denied', 'you don\'t have permission', 'errors.edgesuite.net',
    'reference #18.', 'request blocked', 'error 403'].some((p) => lower.includes(p));
}

/** Source viewer: shows screenshot, rendered text, and source page link */
function SourceViewer({ waiverId, sourceType, extractedFields, fieldColorMap, fieldLabelMap, onContentLoaded }: {
  waiverId: string;
  sourceType: string;
  extractedFields: Record<string, string> | null;
  fieldColorMap: Record<string, string>;
  fieldLabelMap: Record<string, string>;
  onContentLoaded?: (content: string) => void;
}) {
  const [tab, setTab] = useState<'screenshot' | 'text' | 'source'>('text');
  const [zoom, setZoom] = useState(1);
  const [autoSwitched, setAutoSwitched] = useState(false);

  const { data, isLoading, error } = useQuery<{
    data: {
      content: string;
      type: string;
      sourceUrl?: string;
      sourceType?: string;
      screenshotKey?: string;
      screenshotUrl?: string;
      pdfUrl?: string;
      htmlContent?: string;
    };
  }>({
    queryKey: ['waiver-source', waiverId],
    queryFn: () => apiGet(`/v1/waivers/${waiverId}/source`),
    enabled: !!waiverId,
  });

  // Auto-switch to best available tab based on content
  useEffect(() => {
    if (data && !autoSwitched) {
      const content = data.data?.content ?? '';
      const sourceUrl = data.data?.sourceUrl ?? '';
      const screenshotUrl = data.data?.screenshotUrl ?? '';
      const pdfUrl = data.data?.pdfUrl ?? '';
      const resolvedType = data.data?.sourceType ?? '';

      if (resolvedType === 'pdf' && pdfUrl) {
        setTab('screenshot');
        setAutoSwitched(true);
      } else if (resolvedType === 'email') {
        setTab('text');
        setAutoSwitched(true);
      } else if ((isErrorPageContent(content) || isBinaryText(content) || !content.trim()) && sourceUrl) {
        setTab('source');
        setAutoSwitched(true);
      } else if (screenshotUrl) {
        setTab('screenshot');
        setAutoSwitched(true);
      }
    }
  }, [data, autoSwitched]);

  const content = data?.data?.content ?? '';
  useEffect(() => {
    if (content && onContentLoaded) onContentLoaded(content);
  }, [content, onContentLoaded]);

  if (isLoading) return <div style={S.textViewer}><p>Loading source content…</p></div>;
  if (error) return <div style={S.textViewer}><p style={{ color: 'var(--color-red)' }}>Failed to load source.</p></div>;

  const sourceUrl = data?.data?.sourceUrl ?? '';
  const screenshotUrl = data?.data?.screenshotUrl ?? '';
  const pdfUrl = data?.data?.pdfUrl ?? '';
  const htmlContent = data?.data?.htmlContent ?? '';
  const resolvedSourceType = data?.data?.sourceType ?? sourceType;

  const isPdf = resolvedSourceType === 'pdf';
  const isEmail = resolvedSourceType === 'email';

  const tabs: { key: typeof tab; label: string }[] = isPdf
    ? [
        { key: 'screenshot', label: 'PDF Document' },
        { key: 'text', label: 'Extracted Text' },
      ]
    : isEmail
      ? [
          { key: 'text', label: 'Email Content' },
        ]
      : [
          { key: 'screenshot', label: 'Screenshot' },
          { key: 'text', label: 'Rendered Text' },
          { key: 'source', label: 'Source Page' },
        ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '6px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              border: 'none', borderBottom: tab === t.key ? '2px solid var(--color-primary)' : '2px solid transparent',
              background: 'none', color: tab === t.key ? 'var(--color-primary)' : 'var(--color-text-secondary)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Screenshot / PDF tab */}
      {tab === 'screenshot' && (
        isPdf && pdfUrl ? (
          <iframe
            src={pdfUrl}
            title="PDF Document"
            style={{ flex: 1, width: '100%', border: 'none', borderRadius: 4, background: '#fafafa', minHeight: 400 }}
          />
        ) : screenshotUrl ? (
          <div style={{ flex: 1, overflow: 'auto', padding: 12, background: '#fafafa', borderRadius: 4 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <button className="btn" style={{ fontSize: 12, padding: '4px 10px', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', background: 'none' }} onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} aria-label="Zoom out">−</button>
              <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', minWidth: 40, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
              <button className="btn" style={{ fontSize: 12, padding: '4px 10px', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', background: 'none' }} onClick={() => setZoom((z) => Math.min(3, z + 0.25))} aria-label="Zoom in">+</button>
              <button className="btn" style={{ fontSize: 12, padding: '4px 10px', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', background: 'none' }} onClick={() => setZoom(1)}>Reset</button>
            </div>
            <img src={screenshotUrl} alt="Page screenshot" style={{ width: `${zoom * 100}%`, maxWidth: 'none', border: '1px solid var(--color-border)', borderRadius: 4 }} />
          </div>
        ) : (
          <div style={S.placeholder}>No screenshot available. The page may have been fetched without Chromium rendering.</div>
        )
      )}

      {/* Rendered text tab */}
      {tab === 'text' && (
        <div style={{ ...S.textViewer, flex: 1 }}>
          {content ? (
            isBinaryText(content) ? (
              <div style={S.placeholder}>The fetched content appears to be binary (image or PDF) rather than readable text. Try the Source Page tab to view the original page directly.</div>
            ) : isErrorPageContent(content) ? (
              <div style={S.placeholder}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ marginBottom: 8 }}>The source site blocked server-side access to this page.</div>
                  <div>Use the Source Page tab to view the original content in your browser.</div>
                </div>
              </div>
            ) : (
              <HighlightedContent content={content} extractedFields={extractedFields} fieldColorMap={fieldColorMap} fieldLabelMap={fieldLabelMap} />
            )
          ) : (
            <p style={{ color: 'var(--color-text-secondary)' }}>No fetched content available.</p>
          )}
        </div>
      )}

      {/* Source page tab */}
      {tab === 'source' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {sourceUrl && (
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <a href={sourceUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--color-primary)' }}>Open live page ↗</a>
              <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sourceUrl}</span>
            </div>
          )}
          {htmlContent ? (
            <iframe srcDoc={htmlContent} title="HTML Snapshot" sandbox="" style={{ flex: 1, width: '100%', border: 'none', background: '#fff' }} />
          ) : sourceUrl ? (
            <div style={S.placeholder}>No HTML snapshot available. Use the link above to view the live page.</div>
          ) : (
            <div style={S.placeholder}>Original URL not available for this waiver.</div>
          )}
        </div>
      )}
    </div>
  );
}

/** Highlight extracted field values in the source content text — now schema-driven. */
function HighlightedContent({ content, extractedFields, fieldColorMap, fieldLabelMap }: {
  content: string;
  extractedFields: Record<string, string> | null;
  fieldColorMap: Record<string, string>;
  fieldLabelMap: Record<string, string>;
}) {
  if (!extractedFields) {
    return <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontSize: 13, lineHeight: 1.6 }}>{content}</pre>;
  }

  const highlights: { value: string; color: string; label: string }[] = [];

  for (const [key, value] of Object.entries(extractedFields)) {
    if (!value || value.length < 2) continue;
    const items = value.includes(',') ? value.split(',').map((s: string) => s.trim()).filter((s: string) => s.length >= 2) : [value];
    for (const item of items) {
      highlights.push({ value: item, color: fieldColorMap[key] ?? '#e0e0e0', label: fieldLabelMap[key] ?? key });
    }
  }

  highlights.sort((a, b) => b.value.length - a.value.length);

  if (highlights.length === 0) {
    return <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontSize: 13, lineHeight: 1.6 }}>{content}</pre>;
  }

  const escaped = highlights.map((h) => h.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = content.split(regex);

  return (
    <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontSize: 13, lineHeight: 1.6 }}>
      {parts.map((part, i) => {
        const match = highlights.find((h) => h.value.toLowerCase() === part.toLowerCase());
        if (match) {
          return (
            <mark key={i} title={match.label} style={{ background: match.color, borderRadius: 2, padding: '0 2px', cursor: 'help' }}>
              {part}
            </mark>
          );
        }
        return part;
      })}
    </pre>
  );
}

/** Per-field confidence badge: green >0.85, yellow 0.6–0.85, red <0.6 */
function FieldConfidenceBadge({ value }: { value: number }) {
  const pct = (value * 100).toFixed(0);
  const cls =
    value > 0.85
      ? 'badge badge-green'
      : value >= 0.6
        ? 'badge badge-yellow'
        : 'badge badge-red';
  return <span className={cls} style={{ fontSize: 11 }}>{pct}%</span>;
}

/* ── Styles ────────────────────────────────────────── */

const S: Record<string, React.CSSProperties> = {
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
    flexShrink: 0,
  },
  heading: { fontSize: 20, fontWeight: 600, margin: 0 },
  backBtn: {
    background: 'none',
    border: '1px solid var(--color-border)',
    borderRadius: 4,
    padding: '6px 12px',
    cursor: 'pointer',
    fontSize: 14,
  },
  draftBtn: {
    background: 'var(--color-card)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
  },
  rejectBtn: {
    background: 'var(--color-red)',
    color: '#fff',
  },
  bannerStyle: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 16px',
    borderRadius: 4,
    marginBottom: 8,
    fontSize: 14,
    flexShrink: 0,
  },
  bannerClose: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 16,
    lineHeight: 1,
    padding: 0,
  },
  splitContainer: {
    display: 'flex',
    flex: 1,
    minHeight: 0,
    gap: 0,
    background: 'var(--color-bg)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--color-card)',
    borderRadius: 8,
    boxShadow: 'var(--color-card-shadow)',
    padding: 16,
    overflow: 'hidden',
  },
  panelTitle: { fontSize: 16, fontWeight: 600, marginBottom: 12, flexShrink: 0 },
  divider: {
    width: 6,
    cursor: 'col-resize',
    background: 'var(--color-border)',
    flexShrink: 0,
    transition: 'background 0.15s',
  },
  formScroll: { flex: 1, overflowY: 'auto' },
  fieldGroup: {
    marginBottom: 14,
    padding: '8px 10px',
    borderRadius: 4,
    border: '1px solid transparent',
  },
  fieldModified: {
    background: '#fff8e1',
    border: '1px solid var(--color-yellow)',
  },
  fieldLabelRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--color-text-secondary)',
  },
  input: {
    width: '100%',
    padding: '6px 10px',
    border: '1px solid var(--color-border)',
    borderRadius: 4,
    fontSize: 14,
    outline: 'none',
  },
  textarea: {
    width: '100%',
    padding: '6px 10px',
    border: '1px solid var(--color-border)',
    borderRadius: 4,
    fontSize: 14,
    outline: 'none',
    resize: 'vertical',
    fontFamily: 'inherit',
  },
  placeholder: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--color-text-secondary)',
    fontStyle: 'italic',
    fontSize: 16,
    background: '#fafafa',
    borderRadius: 4,
  },
  textViewer: {
    flex: 1,
    overflowY: 'auto',
    padding: 12,
    background: '#fafafa',
    borderRadius: 4,
    fontSize: 14,
    lineHeight: 1.6,
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: 'var(--color-card)',
    borderRadius: 8,
    padding: 24,
    width: 420,
    maxWidth: '90vw',
    boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
  },
};
