import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api/client';

interface DashboardMetrics {
  data: {
    activeWaivers: number;
    processedToday: number;
    pendingReview: number;
    averageConfidence: number;
    ingestionVolume: { date: string; count: number }[];
    airlineDistribution: { airline: string; count: number }[];
    recentWaivers: { id: string; waiver_code: string; airline_code: string; status: string; ingestion_timestamp: string }[];
  };
}

export function Reports() {
  const { data, isLoading, error } = useQuery<DashboardMetrics>({
    queryKey: ['reports-metrics'],
    queryFn: () => apiGet<DashboardMetrics>('/v1/dashboard/metrics'),
  });

  const m = data?.data;

  return (
    <div>
      <h1 style={S.heading}>Reports</h1>
      <p style={S.subtitle}>Pipeline performance and waiver processing analytics.</p>

      {isLoading && <p>Loading reports…</p>}
      {error && <p style={{ color: 'var(--color-red)' }}>Failed to load report data.</p>}

      {m && (
        <>
          {/* Summary cards */}
          <div style={S.grid}>
            <SummaryCard label="Total Active" value={m.activeWaivers} color="var(--color-green)" />
            <SummaryCard label="Pending Review" value={m.pendingReview} color="var(--color-yellow)" />
            <SummaryCard label="Processed Today" value={m.processedToday} color="var(--color-primary)" />
            <SummaryCard label="Avg Confidence" value={`${(m.averageConfidence * 100).toFixed(1)}%`} color="var(--color-text)" />
          </div>

          {/* Ingestion volume table */}
          <div className="card" style={{ marginTop: 20 }}>
            <h2 style={S.sectionTitle}>Daily Ingestion Volume (Last 30 Days)</h2>
            {m.ingestionVolume.length === 0 ? (
              <p style={S.empty}>No ingestion data yet.</p>
            ) : (
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Date</th>
                    <th style={S.th}>Waivers Ingested</th>
                    <th style={S.th}>Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {m.ingestionVolume.map((d) => (
                    <tr key={d.date}>
                      <td style={S.td}>{d.date}</td>
                      <td style={S.td}>{d.count}</td>
                      <td style={S.td}>
                        <div style={{ ...S.bar, width: `${Math.min(100, (d.count / Math.max(...m.ingestionVolume.map((v) => v.count), 1)) * 100)}%` }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Airline distribution */}
          <div className="card" style={{ marginTop: 20 }}>
            <h2 style={S.sectionTitle}>Waiver Distribution by Airline</h2>
            {m.airlineDistribution.length === 0 ? (
              <p style={S.empty}>No airline data yet.</p>
            ) : (
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Airline</th>
                    <th style={S.th}>Count</th>
                    <th style={S.th}>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {m.airlineDistribution.map((a) => {
                    const total = m.airlineDistribution.reduce((s, x) => s + x.count, 0);
                    const pct = total > 0 ? ((a.count / total) * 100).toFixed(1) : '0';
                    return (
                      <tr key={a.airline}>
                        <td style={S.td}>{a.airline}</td>
                        <td style={S.td}>{a.count}</td>
                        <td style={S.td}>{pct}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Recent activity */}
          <div className="card" style={{ marginTop: 20 }}>
            <h2 style={S.sectionTitle}>Recent Activity</h2>
            {m.recentWaivers.length === 0 ? (
              <p style={S.empty}>No recent waivers.</p>
            ) : (
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
                  {m.recentWaivers.map((w) => (
                    <tr key={w.id}>
                      <td style={S.td}>{w.waiver_code}</td>
                      <td style={S.td}>{w.airline_code}</td>
                      <td style={S.td}>
                        <StatusBadge status={w.status} />
                      </td>
                      <td style={S.td}>{new Date(w.ingestion_timestamp).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {!isLoading && !error && !m && (
        <div className="card">
          <p style={S.empty}>No data available. Process some waivers to see reports.</p>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
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

const S: Record<string, React.CSSProperties> = {
  heading: { fontSize: 24, fontWeight: 600, marginBottom: 4 },
  subtitle: { fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 20 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 },
  sectionTitle: { fontSize: 16, fontWeight: 600, marginBottom: 12 },
  empty: { fontSize: 14, color: 'var(--color-text-secondary)', fontStyle: 'italic' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '8px 12px', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '2px solid var(--color-border)', textTransform: 'uppercase' },
  td: { padding: '10px 12px', fontSize: 14, borderBottom: '1px solid var(--color-border)' },
  bar: { height: 8, background: 'var(--color-primary)', borderRadius: 4, minWidth: 4 },
};
