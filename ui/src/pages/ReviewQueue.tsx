import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../api/client';

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

interface Waiver {
  id: string;
  overall_confidence: number;
  source_type: string;
  ingestion_timestamp: string;
  high_impact?: boolean;
  is_duplicate?: boolean;
  duplicate_count?: number;
  status: string;
  [field: string]: unknown;
}

interface WaiverListResponse {
  data: Waiver[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
}

/* ── Component ─────────────────────────────────────── */

export function ReviewQueue() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  /* Fetch schema */
  const { data: schemaData } = useQuery<FieldSchemaResponse>({
    queryKey: ['settings-extraction-fields'],
    queryFn: () => apiGet<FieldSchemaResponse>('/v1/settings/extraction-fields'),
  });
  const schema = schemaData?.data ? [...schemaData.data].sort((a, b) => a.order - b.order) : [];
  // Show only key triage columns in the review queue (not all required fields)
  const REVIEW_QUEUE_KEYS = new Set(['airline_code', 'waiver_title', 'waiver_code', 'effective_date', 'expiration_date']);
  const visibleFields = schema.filter((f) => REVIEW_QUEUE_KEYS.has(f.key));

  /* Filters */
  const [airlineFilter, setAirlineFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [confMin, setConfMin] = useState('');
  const [confMax, setConfMax] = useState('');

  /* Selection */
  const [selected, setSelected] = useState<Set<string>>(new Set());

  /* Error / success banners */
  const [banner, setBanner] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);

  const params: Record<string, string> = {
    status: 'pending_review',
    pageSize: '100',
  };
  if (airlineFilter) params.airline = airlineFilter;
  if (dateFrom) params.dateFrom = dateFrom;
  if (dateTo) params.dateTo = dateTo;

  const { data, isLoading, error } = useQuery<WaiverListResponse>({
    queryKey: ['review-queue', params],
    queryFn: () => apiGet<WaiverListResponse>('/v1/waivers/search', params),
  });

  const today = new Date().toISOString().split('T')[0];

  const allWaivers = (data?.data ?? [])
    .filter((w) => {
      if (confMin && w.overall_confidence < Number(confMin)) return false;
      if (confMax && w.overall_confidence > Number(confMax)) return false;
      return true;
    })
    .sort((a, b) => {
      // In-date waivers (expiration_date >= today) first
      const aInDate = (a.expiration_date as string ?? '') >= today;
      const bInDate = (b.expiration_date as string ?? '') >= today;
      if (aInDate && !bInDate) return -1;
      if (!aInDate && bInDate) return 1;
      // Then high impact
      if (a.high_impact && !b.high_impact) return -1;
      if (!a.high_impact && b.high_impact) return 1;
      // Then by ingestion timestamp desc
      const aTs = a.ingestion_timestamp ?? '';
      const bTs = b.ingestion_timestamp ?? '';
      return bTs.localeCompare(aTs);
    });

  /* Bulk actions */
  const bulkApprove = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selected);
      await Promise.all(ids.map((id) => apiPost(`/v1/waivers/${id}/approve`)));
    },
    onSuccess: () => {
      setSelected(new Set());
      setBanner({ type: 'success', msg: 'Selected waivers approved.' });
      queryClient.invalidateQueries({ queryKey: ['review-queue'] });
    },
    onError: (err: Error) => setBanner({ type: 'error', msg: err.message }),
  });

  const bulkReject = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selected);
      await Promise.all(
        ids.map((id) => apiPost(`/v1/waivers/${id}/reject`, { reason: 'Bulk rejected' })),
      );
    },
    onSuccess: () => {
      setSelected(new Set());
      setBanner({ type: 'success', msg: 'Selected waivers rejected.' });
      queryClient.invalidateQueries({ queryKey: ['review-queue'] });
    },
    onError: (err: Error) => setBanner({ type: 'error', msg: err.message }),
  });

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === allWaivers.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allWaivers.map((w) => w.id)));
    }
  };

  const formatCellValue = (waiver: Waiver, field: FieldDefinition): string => {
    const raw = waiver[field.key];
    if (raw == null) return '';
    if (Array.isArray(raw)) return raw.join(', ');
    const str = String(raw);
    // Truncate long textarea fields in the table view
    if (field.type === 'textarea' && str.length > 60) {
      return str.slice(0, 60) + '…';
    }
    return str;
  };

  return (
    <div>
      <h1 style={S.heading}>Review Queue</h1>

      {/* Banner */}
      {banner && (
        <div
          style={{
            ...S.banner,
            background: banner.type === 'error' ? '#fce8e6' : '#e6f4ea',
            color: banner.type === 'error' ? 'var(--color-red)' : 'var(--color-green)',
          }}
        >
          {banner.msg}
          <button onClick={() => setBanner(null)} style={S.bannerClose}>✕</button>
        </div>
      )}

      {/* Filters */}
      <div className="card" style={S.filtersCard}>
        <div style={S.filterRow}>
          <label style={S.filterLabel}>
            Airline
            <input
              type="text"
              placeholder="e.g. AA"
              value={airlineFilter}
              onChange={(e) => setAirlineFilter(e.target.value.toUpperCase())}
              style={S.filterInput}
              maxLength={2}
              aria-label="Filter by airline"
            />
          </label>
          <label style={S.filterLabel}>
            From
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={S.filterInput} aria-label="Date from" />
          </label>
          <label style={S.filterLabel}>
            To
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={S.filterInput} aria-label="Date to" />
          </label>
          <label style={S.filterLabel}>
            Confidence Min
            <input type="number" step="0.1" min="0" max="1" placeholder="0.0" value={confMin} onChange={(e) => setConfMin(e.target.value)} style={S.filterInput} aria-label="Minimum confidence" />
          </label>
          <label style={S.filterLabel}>
            Confidence Max
            <input type="number" step="0.1" min="0" max="1" placeholder="1.0" value={confMax} onChange={(e) => setConfMax(e.target.value)} style={S.filterInput} aria-label="Maximum confidence" />
          </label>
        </div>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div style={S.bulkBar}>
          <span style={{ fontSize: 14 }}>{selected.size} selected</span>
          <button className="btn btn-primary" onClick={() => bulkApprove.mutate()} disabled={bulkApprove.isPending}>
            {bulkApprove.isPending ? 'Approving…' : 'Bulk Approve'}
          </button>
          <button className="btn" style={S.btnReject} onClick={() => bulkReject.mutate()} disabled={bulkReject.isPending}>
            {bulkReject.isPending ? 'Rejecting…' : 'Bulk Reject'}
          </button>
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ marginTop: 16 }}>
        {isLoading && <p>Loading…</p>}
        {error && <p style={{ color: 'var(--color-red)' }}>Failed to load review queue.</p>}

        {!isLoading && !error && (
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>
                  <input type="checkbox" checked={allWaivers.length > 0 && selected.size === allWaivers.length} onChange={toggleAll} aria-label="Select all" />
                </th>
                {visibleFields.map((f) => (
                  <th key={f.key} style={S.th}>{f.label}</th>
                ))}
                <th style={S.th}>Confidence</th>
                <th style={S.th}>Source</th>
                <th style={S.th}>Impact</th>
                <th style={S.th}>Ingested</th>
              </tr>
            </thead>
            <tbody>
              {allWaivers.map((w) => (
                <tr key={w.id} style={S.tr}>
                  <td style={S.td} onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(w.id)} onChange={() => toggleSelect(w.id)} aria-label={`Select waiver ${w.id}`} />
                  </td>
                  {visibleFields.map((f) => (
                    <td key={f.key} style={S.td} onClick={() => navigate(`/waivers/${w.id}`)}>{formatCellValue(w, f)}</td>
                  ))}
                  <td style={S.td} onClick={() => navigate(`/waivers/${w.id}`)}>
                    <ConfidenceBadge value={w.overall_confidence} />
                  </td>
                  <td style={S.td} onClick={() => navigate(`/waivers/${w.id}`)}>{w.source_type}</td>
                  <td style={S.td} onClick={() => navigate(`/waivers/${w.id}`)}>
                    {w.high_impact ? <span className="badge badge-red">High Impact</span> : '—'}
                    <DuplicateCountBadge count={w.duplicate_count ?? 1} />
                  </td>
                  <td style={S.td} onClick={() => navigate(`/waivers/${w.id}`)}>
                    {new Date(w.ingestion_timestamp).toLocaleString()}
                  </td>
                </tr>
              ))}
              {allWaivers.length === 0 && (
                <tr>
                  <td colSpan={visibleFields.length + 5} style={{ ...S.td, textAlign: 'center' }}>
                    No waivers pending review
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}


/* ── Sub-components ────────────────────────────────── */

function ConfidenceBadge({ value }: { value: number }) {
  const pct = (value * 100).toFixed(0);
  const cls =
    value > 0.7
      ? 'badge badge-green'
      : value >= 0.5
        ? 'badge badge-yellow'
        : 'badge badge-red';
  return <span className={cls}>{pct}%</span>;
}

function DuplicateCountBadge({ count }: { count: number }) {
  if (count <= 1) return null;
  return <span className="badge" style={{ background: '#fff3e0', color: '#e65100', marginLeft: 6 }}>Duplicate ({count})</span>;
}

/* ── Styles ────────────────────────────────────────── */

const S: Record<string, React.CSSProperties> = {
  heading: { fontSize: 24, fontWeight: 600, marginBottom: 16 },
  banner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 16px',
    borderRadius: 4,
    marginBottom: 12,
    fontSize: 14,
  },
  bannerClose: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 16,
    lineHeight: 1,
    padding: 0,
  },
  filtersCard: { display: 'flex', flexDirection: 'column', gap: 12 },
  filterRow: { display: 'flex', gap: 16, flexWrap: 'wrap' },
  filterLabel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--color-text-secondary)',
  },
  filterInput: {
    padding: '6px 10px',
    border: '1px solid var(--color-border)',
    borderRadius: 4,
    fontSize: 14,
    outline: 'none',
    minWidth: 100,
  },
  bulkBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    padding: '10px 16px',
    background: 'var(--color-card)',
    borderRadius: 4,
    boxShadow: 'var(--color-card-shadow)',
  },
  btnReject: {
    background: 'var(--color-red)',
    color: '#fff',
  },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    textAlign: 'left',
    padding: '8px 12px',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--color-text-secondary)',
    borderBottom: '2px solid var(--color-border)',
    textTransform: 'uppercase',
  },
  tr: { cursor: 'pointer' },
  td: {
    padding: '10px 12px',
    fontSize: 14,
    borderBottom: '1px solid var(--color-border)',
  },
};
