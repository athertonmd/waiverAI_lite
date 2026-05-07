import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  status: string;
  overall_confidence: number;
  is_duplicate?: boolean;
  duplicate_count?: number;
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

const STATUS_OPTIONS = ['', 'active', 'pending_review', 'rejected', 'archived', 'expired'];
const PAGE_SIZE = 20;

/* ── Component ─────────────────────────────────────── */

export function WaiverList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(searchParams.get('search') ?? '');

  // Sync search from URL params (e.g. from TopNav search bar)
  useEffect(() => {
    const urlSearch = searchParams.get('search');
    if (urlSearch && urlSearch !== search) {
      setSearch(urlSearch);
      setPage(1);
    }
  }, [searchParams]);
  const [airlineFilter, setAirlineFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? 'active');
  const [dateFrom, setDateFrom] = useState(searchParams.get('dateFrom') ?? '');
  const [dateTo, setDateTo] = useState(searchParams.get('dateTo') ?? '');
  const [showArchived, setShowArchived] = useState(false);

  const handleShowArchivedToggle = (checked: boolean) => {
    setShowArchived(checked);
    if (checked) {
      setStatusFilter('');
      setPage(1);
    } else {
      setStatusFilter('active');
      setPage(1);
    }
  };

  /* Fetch schema */
  const { data: schemaData } = useQuery<FieldSchemaResponse>({
    queryKey: ['settings-extraction-fields'],
    queryFn: () => apiGet<FieldSchemaResponse>('/v1/settings/extraction-fields'),
  });
  const schema = schemaData?.data ? [...schemaData.data].sort((a, b) => a.order - b.order) : [];
  // Show only key columns in the waiver list table
  const WAIVER_LIST_KEYS = new Set(['airline_code', 'waiver_title', 'waiver_code', 'effective_date', 'expiration_date']);
  const visibleFields = schema.filter((f) => WAIVER_LIST_KEYS.has(f.key));

  const params: Record<string, string> = {
    page: String(page),
    pageSize: String(PAGE_SIZE),
  };
  if (search) params.search = search;
  if (airlineFilter) params.airline = airlineFilter;
  if (statusFilter) params.status = statusFilter;
  if (dateFrom) params.dateFrom = dateFrom;
  if (dateTo) params.dateTo = dateTo;

  const { data, isLoading, error } = useQuery<WaiverListResponse>({
    queryKey: ['waivers', params],
    queryFn: () => apiGet<WaiverListResponse>('/v1/waivers', params),
  });

  const pagination = data?.pagination;
  const allWaivers = data?.data ?? [];
  const waivers = allWaivers.filter((w) => {
    if (!showArchived && statusFilter !== 'archived' && w.status === 'archived') return false;
    return true;
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => apiPost(`/v1/waivers/${id}/archive`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['waivers'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['review-queue'] });
    },
  });

  const reinstateMutation = useMutation({
    mutationFn: (id: string) => apiPost(`/v1/waivers/${id}/reinstate`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['waivers'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['review-queue'] });
    },
  });

  const formatCellValue = (waiver: Waiver, field: FieldDefinition): string => {
    const raw = waiver[field.key];
    if (raw == null) return '';
    if (Array.isArray(raw)) return raw.join(', ');
    const str = String(raw);
    if (field.type === 'textarea' && str.length > 60) {
      return str.slice(0, 60) + '…';
    }
    return str;
  };

  return (
    <div>
      <h1 style={S.heading}>Waivers</h1>

      {/* Show archived toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
        <label style={{ fontSize: 13, color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => handleShowArchivedToggle(e.target.checked)}
          />
          Show archived waivers
        </label>
      </div>

      {/* Search & Filters */}
      <div className="card" style={S.filtersCard}>
        <input
          type="text"
          placeholder="Search by code, airline, or title…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          style={S.searchInput}
          aria-label="Search waivers"
        />

        <div style={S.filterRow}>
          <label style={S.filterLabel}>
            Airline
            <input
              type="text"
              placeholder="e.g. AA"
              value={airlineFilter}
              onChange={(e) => { setAirlineFilter(e.target.value.toUpperCase()); setPage(1); }}
              style={S.filterInput}
              maxLength={2}
            />
          </label>

          <label style={S.filterLabel}>
            Status
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              style={S.filterSelect}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s || 'All'}</option>
              ))}
            </select>
          </label>

          <label style={S.filterLabel}>
            From
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              style={S.filterInput}
            />
          </label>

          <label style={S.filterLabel}>
            To
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              style={S.filterInput}
            />
          </label>
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ marginTop: 16 }}>
        {isLoading && <p>Loading…</p>}
        {error && <p style={{ color: 'var(--color-red)' }}>Failed to load waivers.</p>}

        {!isLoading && !error && (
          <>
            <table style={S.table}>
              <thead>
                <tr>
                  {visibleFields.map((f) => (
                    <th key={f.key} style={S.th}>{f.label}</th>
                  ))}
                  <th style={S.th}>Status</th>
                  <th style={S.th}>Confidence</th>
                  <th style={S.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {waivers.map((w) => (
                  <tr
                    key={w.id}
                    style={S.tr}
                    onClick={() => navigate(`/waivers/${w.id}`)}
                  >
                    {visibleFields.map((f) => (
                      <td key={f.key} style={S.td}>{formatCellValue(w, f)}</td>
                    ))}
                    <td style={S.td}><StatusBadge status={w.status} /><DuplicateCountBadge count={w.duplicate_count ?? 1} /></td>
                    <td style={S.td}><ConfidenceBadge value={w.overall_confidence} /></td>
                    <td style={S.td} onClick={(e) => e.stopPropagation()}>
                      {(w.status === 'rejected') && (
                        <button
                          className="btn"
                          style={{ fontSize: 11, padding: '3px 8px', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', background: 'none', color: 'var(--color-text-secondary)' }}
                          onClick={() => archiveMutation.mutate(w.id)}
                          disabled={archiveMutation.isPending}
                        >
                          Archive
                        </button>
                      )}
                      {w.status === 'archived' && (
                        <button
                          className="btn"
                          style={{ fontSize: 11, padding: '3px 8px', border: '1px solid var(--color-primary)', borderRadius: 4, cursor: 'pointer', background: 'none', color: 'var(--color-primary)' }}
                          onClick={() => reinstateMutation.mutate(w.id)}
                          disabled={reinstateMutation.isPending}
                        >
                          Reinstate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {waivers.length === 0 && (
                  <tr><td colSpan={visibleFields.length + 3} style={{ ...S.td, textAlign: 'center' }}>No waivers found</td></tr>
                )}
              </tbody>
            </table>

            {/* Pagination footer */}
            {pagination && (
              <div style={S.paginationBar}>
                <span style={S.pageInfo}>
                  {pagination.totalCount} total &middot; Page {pagination.page} of {pagination.totalPages || 1}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-primary"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    style={page <= 1 ? S.btnDisabled : undefined}
                  >
                    Previous
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={page >= (pagination.totalPages || 1)}
                    onClick={() => setPage((p) => p + 1)}
                    style={page >= (pagination.totalPages || 1) ? S.btnDisabled : undefined}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}


/* ── Sub-components ────────────────────────────────── */

function DuplicateCountBadge({ count }: { count: number }) {
  if (count <= 1) return null;
  return <span className="badge" style={{ background: '#fff3e0', color: '#e65100', marginLeft: 6 }}>Duplicate ({count})</span>;
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'active' || status === 'auto_approved' || status === 'approved'
      ? 'badge badge-green'
      : status === 'rejected' || status === 'pipeline_failed'
        ? 'badge badge-red'
        : status === 'archived'
          ? 'badge'
          : 'badge badge-yellow';
  return <span className={cls} style={status === 'archived' ? { background: '#e0e0e0', color: '#666' } : undefined}>{status.replace('_', ' ')}</span>;
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = (value * 100).toFixed(0);
  const cls =
    value >= 0.85 ? 'badge badge-green'
      : value >= 0.6 ? 'badge badge-yellow'
        : 'badge badge-red';
  return <span className={cls}>{pct}%</span>;
}

/* ── Styles ────────────────────────────────────────── */

const S: Record<string, React.CSSProperties> = {
  heading: { fontSize: 24, fontWeight: 600, marginBottom: 16 },
  filtersCard: { display: 'flex', flexDirection: 'column', gap: 12 },
  searchInput: {
    width: '100%',
    padding: '10px 14px',
    border: '1px solid var(--color-border)',
    borderRadius: 4,
    fontSize: 14,
    outline: 'none',
  },
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
  filterSelect: {
    padding: '6px 10px',
    border: '1px solid var(--color-border)',
    borderRadius: 4,
    fontSize: 14,
    outline: 'none',
    minWidth: 120,
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
  paginationBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 0 0',
  },
  pageInfo: { fontSize: 13, color: 'var(--color-text-secondary)' },
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
};
