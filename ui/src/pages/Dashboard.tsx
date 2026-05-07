import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../api/client';

/* ── Types ─────────────────────────────────────────── */

interface IngestionDay {
  date: string;
  count: number;
}

interface AirlineSlice {
  airline: string;
  count: number;
}

interface RecentWaiver {
  id: string;
  waiver_code: string;
  airline_code: string;
  status: string;
  ingestion_timestamp: string;
  is_duplicate?: boolean;
  duplicate_count?: number;
}

interface DashboardMetrics {
  data: {
    activeWaivers: number;
    processedToday: number;
    pendingReview: number;
    expiredWaivers: number;
    averageConfidence: number;
    ingestionVolume: IngestionDay[];
    airlineDistribution: AirlineSlice[];
    recentWaivers: RecentWaiver[];
  };
}

/* ── Colours for pie slices ────────────────────────── */

const PIE_COLORS = [
  '#1A73E8', '#34A853', '#EA4335', '#FBBC04', '#8E24AA',
  '#00ACC1', '#FF7043', '#5C6BC0', '#26A69A', '#EC407A',
];

/* ── Component ─────────────────────────────────────── */

export function Dashboard() {
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery<DashboardMetrics>({
    queryKey: ['dashboard-metrics'],
    queryFn: () => apiGet<DashboardMetrics>('/v1/dashboard/metrics'),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return <p style={{ padding: 24 }}>Loading dashboard…</p>;
  }
  if (error) {
    return <p style={{ padding: 24, color: 'var(--color-red)' }}>Failed to load dashboard.</p>;
  }

  const m = data!.data;

  return (
    <div>
      <h1 style={S.heading}>Dashboard</h1>

      {/* KPI Cards */}
      <div style={S.kpiGrid}>
        <KpiCard label="Active Waivers" value={m.activeWaivers} onClick={() => navigate('/waivers?status=active')} />
        <KpiCard label="Processed Today" value={m.processedToday} onClick={() => {
          const today = new Date().toISOString().split('T')[0];
          navigate(`/waivers?dateFrom=${today}&dateTo=${today}`);
        }} />
        <KpiCard label="Pending Review" value={m.pendingReview} onClick={() => navigate('/review')} />
        <KpiCard label="Expired Waivers" value={m.expiredWaivers ?? 0} onClick={() => navigate('/waivers?status=expired')} />
        <KpiCard label="Avg Confidence" value={`${(m.averageConfidence * 100).toFixed(1)}%`} />
      </div>

      {/* Charts row */}
      <div style={S.chartsRow}>
        <div className="card" style={{ flex: 2 }}>
          <h2 style={S.sectionTitle}>Ingestion Volume (30 days)</h2>
          <BarChart data={m.ingestionVolume} />
        </div>
        <div className="card" style={{ flex: 1 }}>
          <h2 style={S.sectionTitle}>Airline Distribution</h2>
          <PieChart data={m.airlineDistribution} />
        </div>
      </div>

      {/* Recent waivers table */}
      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={S.sectionTitle}>Recent Waivers</h2>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Waiver Code</th>
              <th style={S.th}>Airline</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Ingested</th>
            </tr>
          </thead>
          <tbody>
            {m.recentWaivers.slice(0, 10).map((w) => (
              <tr
                key={w.id}
                style={S.tr}
                onClick={() => navigate(`/waivers/${w.id}`)}
              >
                <td style={S.td}>{w.waiver_code}</td>
                <td style={S.td}>{w.airline_code}</td>
                <td style={S.td}>
                  <StatusBadge status={w.status} />
                  <DuplicateCountBadge count={w.duplicate_count ?? 1} />
                </td>
                <td style={S.td}>{new Date(w.ingestion_timestamp).toLocaleString()}</td>
              </tr>
            ))}
            {m.recentWaivers.length === 0 && (
              <tr><td colSpan={4} style={{ ...S.td, textAlign: 'center' }}>No recent waivers</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}


/* ── Sub-components ────────────────────────────────── */

function KpiCard({ label, value, onClick }: { label: string; value: string | number; onClick?: () => void }) {
  return (
    <div className="card" style={{ ...S.kpiCard, cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}>
      <div style={S.kpiLabel}>{label}</div>
      <div style={S.kpiValue}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'active' || status === 'auto_approved' || status === 'approved'
      ? 'badge badge-green'
      : status === 'rejected' || status === 'pipeline_failed'
        ? 'badge badge-red'
        : 'badge badge-yellow';
  return <span className={cls}>{status.replace('_', ' ')}</span>;
}

function DuplicateCountBadge({ count }: { count: number }) {
  if (count <= 1) return null;
  return <span className="badge" style={{ background: '#fff3e0', color: '#e65100', marginLeft: 6 }}>Duplicate ({count})</span>;
}

/* ── Bar Chart (CSS-based) ─────────────────────────── */

function BarChart({ data }: { data: IngestionDay[] }) {
  if (!data.length) return <p style={{ color: 'var(--color-text-secondary)' }}>No data</p>;
  const max = Math.max(...data.map((d) => d.count), 1);

  return (
    <div style={S.barChartWrap}>
      {data.map((d) => {
        const pct = (d.count / max) * 100;
        return (
          <div key={d.date} style={S.barCol} title={`${d.date}: ${d.count}`}>
            <div style={{ ...S.bar, height: `${pct}%` }} />
            <span style={S.barLabel}>{d.date.slice(5)}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Pie Chart (SVG-based) ─────────────────────────── */

function PieChart({ data }: { data: AirlineSlice[] }) {
  if (!data.length) return <p style={{ color: 'var(--color-text-secondary)' }}>No data</p>;
  const total = data.reduce((s, d) => s + d.count, 0);
  let cumulative = 0;

  const slices = data.map((d, i) => {
    const start = cumulative;
    cumulative += d.count;
    return { ...d, start, color: PIE_COLORS[i % PIE_COLORS.length] };
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <svg viewBox="-1 -1 2 2" width={140} height={140} style={{ transform: 'rotate(-90deg)' }}>
        {slices.map((s) => {
          const startAngle = (s.start / total) * 2 * Math.PI;
          const endAngle = ((s.start + s.count) / total) * 2 * Math.PI;
          const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
          const x1 = Math.cos(startAngle);
          const y1 = Math.sin(startAngle);
          const x2 = Math.cos(endAngle);
          const y2 = Math.sin(endAngle);
          const d = `M 0 0 L ${x1} ${y1} A 1 1 0 ${largeArc} 1 ${x2} ${y2} Z`;
          return <path key={s.airline} d={d} fill={s.color} />;
        })}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {slices.map((s) => (
          <div key={s.airline} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, display: 'inline-block' }} />
            {s.airline} ({s.count})
          </div>
        ))}
      </div>
    </div>
  );
}


/* ── Styles ────────────────────────────────────────── */

const S: Record<string, React.CSSProperties> = {
  heading: { fontSize: 24, fontWeight: 600, marginBottom: 16 },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 16 },
  kpiCard: { textAlign: 'center' },
  kpiLabel: { fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 4 },
  kpiValue: { fontSize: 28, fontWeight: 700, color: 'var(--color-text)' },
  chartsRow: { display: 'flex', gap: 16, marginBottom: 0 },
  sectionTitle: { fontSize: 16, fontWeight: 600, marginBottom: 12 },

  /* Bar chart */
  barChartWrap: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 2,
    height: 160,
    borderBottom: '1px solid var(--color-border)',
    paddingBottom: 4,
  },
  barCol: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: '100%',
  },
  bar: {
    width: '70%',
    background: 'var(--color-primary)',
    borderRadius: '3px 3px 0 0',
    minHeight: 2,
    transition: 'height 0.3s',
  },
  barLabel: { fontSize: 9, color: 'var(--color-text-secondary)', marginTop: 2, whiteSpace: 'nowrap' },

  /* Table */
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
