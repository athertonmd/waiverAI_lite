import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { publicApiGet } from '../api/publicClient';
import { RegistrationCTA } from '../components/RegistrationCTA';

interface PublicWaiver {
  id: string;
  airline_code?: string;
  waiver_title?: string;
  waiver_code?: string;
  effective_date?: string;
  expiration_date?: string;
  applicable_routes?: string[];
  status?: string;
  overall_confidence?: number;
  [key: string]: unknown;
}

interface ListResponse {
  data: PublicWaiver[];
  pagination?: { page: number; pageSize: number; totalCount: number; totalPages: number };
}

const PAGE_SIZE = 10;

export function PublicWaiverList() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  const params: Record<string, string> = { page: String(page), pageSize: String(PAGE_SIZE) };
  if (search) params.search = search;

  const { data, isLoading, error } = useQuery<ListResponse>({
    queryKey: ['publicWaivers', params],
    queryFn: () => publicApiGet('/v1/public/waivers', params),
  });

  const waivers = data?.data ?? [];
  const pagination = data?.pagination;
  const totalPages = pagination?.totalPages ?? 1;
  const totalCount = pagination?.totalCount ?? waivers.length;

  return (
    <div>
      <h1 style={S.heading}>Waivers</h1>

      {/* Search & Filters */}
      <div className="card" style={S.filtersCard}>
        <input
          type="text"
          placeholder="Search by code, airline, title, or route…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          style={S.searchInput}
          aria-label="Search waivers"
        />
      </div>

      {isLoading && <p style={{ padding: 24 }}>Loading waivers…</p>}
      {error && <p style={{ padding: 24, color: 'var(--color-red, #c00)' }}>Unable to load waivers. Please try again later.</p>}

      {!isLoading && !error && (
        <div className="card" style={{ marginTop: 16 }}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Airline Code</th>
                <th style={S.th}>Waiver Title</th>
                <th style={S.th}>Waiver Code</th>
                <th style={S.th}>Effective Date</th>
                <th style={S.th}>Expiration Date</th>
                <th style={S.th}>Applicable Routes</th>
              </tr>
            </thead>
            <tbody>
              {waivers.map((w) => (
                <tr
                  key={w.id}
                  style={S.tr}
                  onClick={() => navigate(`/browse/${w.id}`)}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f7fa'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                >
                  <td style={S.td}>{w.airline_code ?? '—'}</td>
                  <td style={{ ...S.td, fontWeight: 500 }}>{w.waiver_title ?? '—'}</td>
                  <td style={S.td}>{w.waiver_code ?? '—'}</td>
                  <td style={S.td}>{w.effective_date ?? '—'}</td>
                  <td style={S.td}>{w.expiration_date ?? '—'}</td>
                  <td style={S.td}>{w.applicable_routes?.join(', ') || '—'}</td>
                </tr>
              ))}
              {waivers.length === 0 && (
                <tr><td colSpan={6} style={{ ...S.td, textAlign: 'center', color: '#888' }}>No active waivers found.</td></tr>
              )}
            </tbody>
          </table>

          {/* Pagination */}
          <div style={S.paginationRow}>
            <span style={{ fontSize: 13, color: '#666' }}>{totalCount} total · Page {page} of {totalPages}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={S.pageBtn}>Previous</button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} style={S.pageBtn}>Next</button>
            </div>
          </div>
        </div>
      )}

      <RegistrationCTA />
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  heading: { fontSize: 24, fontWeight: 600, marginBottom: 16 },
  filtersCard: { padding: 16, marginBottom: 0 },
  searchInput: {
    width: '100%', padding: '10px 14px', fontSize: 14, border: '1px solid #ddd',
    borderRadius: 6, marginBottom: 12, boxSizing: 'border-box',
  },
  filterRow: { display: 'flex', gap: 16, flexWrap: 'wrap' },
  filterLabel: { fontSize: 12, color: '#666', display: 'flex', flexDirection: 'column', gap: 4 },
  filterInput: { padding: '6px 10px', fontSize: 14, border: '1px solid #ddd', borderRadius: 4, width: 80 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    textAlign: 'left', padding: '8px 12px', fontSize: 12, fontWeight: 600,
    color: '#666', borderBottom: '2px solid #e0e0e0', textTransform: 'uppercase',
  },
  tr: { cursor: 'pointer' },
  td: { padding: '10px 12px', fontSize: 14, borderBottom: '1px solid #eee' },
  paginationRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px', borderTop: '1px solid #eee',
  },
  pageBtn: {
    padding: '6px 16px', fontSize: 13, borderRadius: 4, border: '1px solid #ddd',
    background: '#1a73e8', color: '#fff', cursor: 'pointer',
  },
};
