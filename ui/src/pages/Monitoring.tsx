import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut, apiDelete } from '../api/client';

/* ── Types ─────────────────────────────────────────── */

interface Schedule {
  id: string;
  url: string;
  interval_minutes: number;
  end_date_time: string;
  status: string;
  failure_count: number;
  last_fetch_timestamp: string | null;
  created_at: string;
}

interface ContentVersion {
  id: string;
  s3_key: string;
  content_hash: string;
  change_detected: boolean;
  high_impact: boolean;
  fetched_at: string;
}

/* ── Component ─────────────────────────────────────── */

export function Monitoring() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editInterval, setEditInterval] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);

  const { data, isLoading, error } = useQuery<{ data: Schedule[] }>({
    queryKey: ['monitoring-schedules'],
    queryFn: () => apiGet('/v1/monitoring/schedules'),
  });

  const schedules = data?.data ?? [];

  /* Edit mutation */
  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; interval_minutes?: number; end_date_time?: string }) =>
      apiPut(`/v1/monitoring/schedules/${vars.id}`, {
        ...(vars.interval_minutes !== undefined && { interval_minutes: vars.interval_minutes }),
        ...(vars.end_date_time !== undefined && { end_date_time: vars.end_date_time }),
      }),
    onSuccess: () => {
      setEditingId(null);
      setBanner({ type: 'success', msg: 'Schedule updated.' });
      queryClient.invalidateQueries({ queryKey: ['monitoring-schedules'] });
    },
    onError: (err: Error) => setBanner({ type: 'error', msg: err.message }),
  });

  /* Pause / Terminate */
  const terminateMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/v1/monitoring/schedules/${id}`),
    onSuccess: () => {
      setBanner({ type: 'success', msg: 'Schedule terminated.' });
      queryClient.invalidateQueries({ queryKey: ['monitoring-schedules'] });
    },
    onError: (err: Error) => setBanner({ type: 'error', msg: err.message }),
  });

  const pauseMutation = useMutation({
    mutationFn: (id: string) =>
      apiPut(`/v1/monitoring/schedules/${id}`, { status: 'paused' }),
    onSuccess: () => {
      setBanner({ type: 'success', msg: 'Schedule paused.' });
      queryClient.invalidateQueries({ queryKey: ['monitoring-schedules'] });
    },
    onError: (err: Error) => setBanner({ type: 'error', msg: err.message }),
  });

  const startEdit = (s: Schedule) => {
    setEditingId(s.id);
    setEditInterval(String(s.interval_minutes));
    setEditEndDate(s.end_date_time.slice(0, 16)); // datetime-local format
  };

  const saveEdit = () => {
    if (!editingId) return;
    updateMutation.mutate({
      id: editingId,
      interval_minutes: Number(editInterval),
      end_date_time: new Date(editEndDate).toISOString(),
    });
  };

  return (
    <div>
      <h1 style={S.heading}>Monitoring</h1>

      {banner && (
        <div
          style={{
            ...S.banner,
            background: banner.type === 'error' ? '#fce8e6' : '#e6f4ea',
            color: banner.type === 'error' ? 'var(--color-red)' : 'var(--color-green)',
          }}
        >
          {banner.msg}
          <button onClick={() => setBanner(null)} style={S.bannerClose} aria-label="Dismiss">✕</button>
        </div>
      )}

      <div className="card">
        {isLoading && <p>Loading…</p>}
        {error && <p style={{ color: 'var(--color-red)' }}>Failed to load schedules.</p>}

        {!isLoading && !error && (
          <table style={S.table} aria-label="Monitoring schedules">
            <thead>
              <tr>
                <th style={S.th}>URL</th>
                <th style={S.th}>Interval (min)</th>
                <th style={S.th}>End Date</th>
                <th style={S.th}>Status</th>
                <th style={S.th}>Last Fetch</th>
                <th style={S.th}>Failures</th>
                <th style={S.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <ScheduleRow
                  key={s.id}
                  schedule={s}
                  isEditing={editingId === s.id}
                  editInterval={editInterval}
                  editEndDate={editEndDate}
                  onEditIntervalChange={setEditInterval}
                  onEditEndDateChange={setEditEndDate}
                  onStartEdit={() => startEdit(s)}
                  onCancelEdit={() => setEditingId(null)}
                  onSaveEdit={saveEdit}
                  onPause={() => pauseMutation.mutate(s.id)}
                  onTerminate={() => terminateMutation.mutate(s.id)}
                  isExpanded={expandedId === s.id}
                  onToggleExpand={() => setExpandedId(expandedId === s.id ? null : s.id)}
                  saving={updateMutation.isPending}
                />
              ))}
              {schedules.length === 0 && (
                <tr><td colSpan={7} style={{ ...S.td, textAlign: 'center' }}>No active schedules</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}


/* ── Schedule Row ──────────────────────────────────── */

interface ScheduleRowProps {
  schedule: Schedule;
  isEditing: boolean;
  editInterval: string;
  editEndDate: string;
  onEditIntervalChange: (v: string) => void;
  onEditEndDateChange: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onPause: () => void;
  onTerminate: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  saving: boolean;
}

function ScheduleRow({
  schedule: s,
  isEditing,
  editInterval,
  editEndDate,
  onEditIntervalChange,
  onEditEndDateChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onPause,
  onTerminate,
  isExpanded,
  onToggleExpand,
  saving,
}: ScheduleRowProps) {
  const statusCls =
    s.status === 'active' ? 'badge badge-green'
    : s.status === 'paused' ? 'badge badge-yellow'
    : 'badge badge-red';

  return (
    <>
      <tr>
        <td style={S.td}>
          <button onClick={onToggleExpand} style={S.expandBtn} aria-label="Toggle version history">
            {isExpanded ? '▾' : '▸'}
          </button>
          <span style={S.urlText} title={s.url}>{s.url}</span>
        </td>
        <td style={S.td}>
          {isEditing ? (
            <input
              type="number"
              min={1}
              value={editInterval}
              onChange={(e) => onEditIntervalChange(e.target.value)}
              style={S.editInput}
              aria-label="Polling interval"
            />
          ) : (
            s.interval_minutes
          )}
        </td>
        <td style={S.td}>
          {isEditing ? (
            <input
              type="datetime-local"
              value={editEndDate}
              onChange={(e) => onEditEndDateChange(e.target.value)}
              style={S.editInput}
              aria-label="End date"
            />
          ) : (
            new Date(s.end_date_time).toLocaleString()
          )}
        </td>
        <td style={S.td}><span className={statusCls}>{s.status}</span></td>
        <td style={S.td}>{s.last_fetch_timestamp ? new Date(s.last_fetch_timestamp).toLocaleString() : '—'}</td>
        <td style={S.td}>{s.failure_count}</td>
        <td style={S.td}>
          {isEditing ? (
            <span style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-primary" onClick={onSaveEdit} disabled={saving} style={S.smallBtn}>
                Save
              </button>
              <button className="btn" onClick={onCancelEdit} style={S.smallBtn}>Cancel</button>
            </span>
          ) : (
            <span style={{ display: 'flex', gap: 6 }}>
              <button className="btn" onClick={onStartEdit} style={S.smallBtn}>Edit</button>
              {s.status === 'active' && (
                <button className="btn" onClick={onPause} style={{ ...S.smallBtn, background: 'var(--color-yellow)', color: '#fff' }}>
                  Pause
                </button>
              )}
              <button className="btn" onClick={onTerminate} style={{ ...S.smallBtn, background: 'var(--color-red)', color: '#fff' }}>
                Terminate
              </button>
            </span>
          )}
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={7} style={{ padding: 0 }}>
            <VersionHistory scheduleId={s.id} />
          </td>
        </tr>
      )}
    </>
  );
}

/* ── Version History ───────────────────────────────── */

function VersionHistory({ scheduleId }: { scheduleId: string }) {
  const { data, isLoading } = useQuery<{ data: ContentVersion[] }>({
    queryKey: ['version-history', scheduleId],
    queryFn: () => apiGet(`/v1/monitoring/schedules/${scheduleId}/versions`),
  });

  const versions = data?.data ?? [];

  if (isLoading) return <div style={S.versionBox}>Loading versions…</div>;

  if (versions.length === 0) return <div style={S.versionBox}>No versions recorded yet.</div>;

  return (
    <div style={S.versionBox}>
      <table style={S.table} aria-label="Version history">
        <thead>
          <tr>
            <th style={S.thSub}>Fetched At</th>
            <th style={S.thSub}>Content Hash</th>
            <th style={S.thSub}>Change Detected</th>
            <th style={S.thSub}>High Impact</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.id}>
              <td style={S.td}>{new Date(v.fetched_at).toLocaleString()}</td>
              <td style={S.td}><code>{v.content_hash.slice(0, 12)}…</code></td>
              <td style={S.td}>
                {v.change_detected
                  ? <span className="badge badge-yellow">Yes</span>
                  : <span className="badge badge-green">No</span>}
              </td>
              <td style={S.td}>
                {v.high_impact
                  ? <span className="badge badge-red">High Impact</span>
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
  thSub: {
    textAlign: 'left',
    padding: '6px 10px',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--color-text-secondary)',
    borderBottom: '1px solid var(--color-border)',
    textTransform: 'uppercase',
  },
  td: {
    padding: '10px 12px',
    fontSize: 14,
    borderBottom: '1px solid var(--color-border)',
  },
  expandBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    marginRight: 6,
    padding: 0,
  },
  urlText: {
    maxWidth: 300,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    display: 'inline-block',
    verticalAlign: 'middle',
  },
  editInput: {
    padding: '4px 8px',
    border: '1px solid var(--color-border)',
    borderRadius: 4,
    fontSize: 13,
    width: 140,
  },
  smallBtn: {
    padding: '4px 10px',
    fontSize: 12,
  },
  versionBox: {
    padding: '12px 24px',
    background: '#fafafa',
    borderBottom: '2px solid var(--color-border)',
  },
};
