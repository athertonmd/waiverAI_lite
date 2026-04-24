import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { publicApiGet } from '../api/publicClient';
import { RegistrationCTA } from '../components/RegistrationCTA';

interface PublicWaiver {
  id: string;
  [key: string]: unknown;
}

interface DetailResponse { data: PublicWaiver }
interface SourceResponse { data: { content: string; type: string; sourceType?: string } }

/** Known field display order — fields not in this list are appended at the end. */
const KNOWN_FIELD_ORDER: string[] = [
  'airline_code', 'airline_name', 'waiver_title', 'waiver_code',
  'issued_date', 'effective_date', 'expiration_date',
  'travel_dates_qualifier', 'ticket_issued_qualifier', 'ticket_issued_date',
  'airports_qualifier', 'airports', 'fare_classes',
  'rebooking_rules', 'refund_rules', 'release_notes',
];

/** System/internal fields that should never be rendered in the public detail view. */
const SYSTEM_FIELDS = new Set([
  'id', 'status', 'overall_confidence', 'confidence_scores',
  'source_type', 'source_s3_key', 'normalized_s3_key',
  'ingestion_timestamp', 'extraction_timestamp', 'approval_timestamp',
  'reviewer_id', 'rejection_reason', 'version_number',
  'created_at', 'updated_at', 'is_duplicate', 'duplicate_of_id',
  'duplicate_count', 'ai_extraction', 'source_url', 'screenshot_s3_key',
]);

/** Convert a snake_case key to a human-readable label. */
function keyToLabel(key: string): string {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Build the ordered list of displayable fields from a waiver record. */
function getDisplayFields(waiver: PublicWaiver): { key: string; label: string }[] {
  // Collect all non-system keys present on the record
  const presentKeys = new Set(
    Object.keys(waiver).filter((k) => !SYSTEM_FIELDS.has(k) && waiver[k] != null && waiver[k] !== ''),
  );

  // Backward compat: if applicable_routes is present but airports is not, treat as airports
  if (presentKeys.has('applicable_routes') && !presentKeys.has('airports')) {
    presentKeys.delete('applicable_routes');
    presentKeys.add('airports');
  } else {
    // Don't show applicable_routes if airports is already present
    presentKeys.delete('applicable_routes');
  }

  // Remove confidence sub-fields (e.g. airline_code_confidence)
  for (const k of [...presentKeys]) {
    if (k.endsWith('_confidence')) presentKeys.delete(k);
  }

  const ordered: { key: string; label: string }[] = [];
  for (const key of KNOWN_FIELD_ORDER) {
    if (presentKeys.has(key)) {
      ordered.push({ key, label: keyToLabel(key) });
      presentKeys.delete(key);
    }
  }
  // Append any remaining unknown fields
  for (const key of [...presentKeys].sort()) {
    ordered.push({ key, label: keyToLabel(key) });
  }
  return ordered;
}

export function PublicWaiverDetail() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, error } = useQuery<DetailResponse>({
    queryKey: ['publicWaiver', id],
    queryFn: () => publicApiGet(`/v1/public/waivers/${id}`),
    enabled: !!id,
  });

  const { data: sourceData } = useQuery<SourceResponse>({
    queryKey: ['publicWaiverSource', id],
    queryFn: () => publicApiGet(`/v1/public/waivers/${id}/source`),
    enabled: !!id,
  });

  if (isLoading) return <p style={{ padding: 40, textAlign: 'center' }}>Loading waiver…</p>;

  if (error) {
    const msg = (error as Error).message ?? '';
    if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
      return (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <h2>Waiver not found</h2>
          <p style={{ color: '#666' }}>This waiver may have been removed or is not publicly available.</p>
          <Link to="/browse" style={{ color: '#1a73e8' }}>← Back to waivers</Link>
        </div>
      );
    }
    return <p style={{ padding: 40, textAlign: 'center', color: '#c00' }}>Unable to load waiver. Please try again later.</p>;
  }

  const waiver = data?.data;
  if (!waiver) return null;

  const sourceContent = sourceData?.data?.content ?? '';
  const sourceType = sourceData?.data?.sourceType ?? '';

  const displayFields = getDisplayFields(waiver);

  return (
    <div>
      {/* Header */}
      <div style={S.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link to="/browse" style={S.backBtn}>← Back</Link>
          <h1 style={S.title}>{(waiver.waiver_code as string) ?? '—'} — {(waiver.airline_code as string) ?? ''}</h1>
        </div>
      </div>

      {/* Two-panel layout: Source Document | Extracted Data */}
      <div style={S.panels}>
        {/* Left: Source Document */}
        <div className="card" style={S.panel}>
          <h2 style={S.panelTitle}>Source Document</h2>
          <div style={S.sourceLabel}>{sourceType === 'email' ? 'Email Content' : sourceType === 'pdf' ? 'PDF Content' : 'Web Content'}</div>
          <div style={S.sourceContent}>
            {sourceContent ? (
              <pre style={S.sourcePre}>{sourceContent}</pre>
            ) : (
              <p style={{ color: '#888', fontStyle: 'italic' }}>Source content loading…</p>
            )}
          </div>
        </div>

        {/* Right: Extracted Data */}
        <div className="card" style={S.panel}>
          <h2 style={S.panelTitle}>Extracted Data</h2>
          {displayFields.map(({ key, label }) => {
            // For backward compat: use applicable_routes value when displaying as airports
            const raw = key === 'airports'
              ? (waiver.airports ?? waiver.applicable_routes)
              : waiver[key];
            if (raw == null || raw === '') return null;
            const display = Array.isArray(raw) ? raw.join(', ') : String(raw);
            const conf = waiver[`${key}_confidence`] as number | undefined;

            return (
              <div key={key} style={S.fieldBlock}>
                <div style={S.fieldHeader}>
                  <span style={S.fieldLabel}>{label}</span>
                  {conf != null && (
                    <span style={{ fontSize: 12, fontWeight: 600, color: conf >= 0.8 ? '#34a853' : conf >= 0.6 ? '#ea8600' : '#ea4335' }}>
                      {Math.round(conf * 100)}%
                    </span>
                  )}
                </div>
                <div style={S.fieldValue}>{display}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Registration prompt */}
      <p style={S.registerNote}>
        Want to forward waivers via email or add your own? Register for a free account.
      </p>

      <RegistrationCTA />
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 0', borderBottom: '1px solid #e0e0e0', marginBottom: 16,
  },
  backBtn: {
    textDecoration: 'none', color: '#1a73e8', fontSize: 14,
    padding: '6px 12px', border: '1px solid #ddd', borderRadius: 6, background: '#fff',
  },
  title: { fontSize: 18, fontWeight: 600, margin: 0 },
  panels: { display: 'flex', gap: 16, alignItems: 'flex-start' },
  panel: { flex: 1, padding: 20, minHeight: 400, overflow: 'auto' },
  panelTitle: { fontSize: 16, fontWeight: 600, marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #eee' },
  sourceLabel: {
    display: 'inline-block', padding: '4px 12px', fontSize: 13, fontWeight: 500,
    background: '#e8f0fe', color: '#1a73e8', borderRadius: '4px 4px 0 0', marginBottom: 0,
  },
  sourceContent: {
    background: '#fafafa', border: '1px solid #e0e0e0', borderRadius: '0 4px 4px 4px',
    padding: 16, maxHeight: 500, overflow: 'auto',
  },
  sourcePre: { margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, lineHeight: 1.6, fontFamily: 'inherit' },
  fieldBlock: { marginBottom: 16 },
  fieldHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  fieldLabel: { fontSize: 12, fontWeight: 600, color: '#666' },
  fieldValue: {
    padding: '8px 12px', background: '#f9f9f9', border: '1px solid #e0e0e0',
    borderRadius: 4, fontSize: 14, minHeight: 36, lineHeight: '20px',
  },
  registerNote: {
    marginTop: 20, padding: '12px 16px', background: '#fff3cd',
    borderRadius: 6, fontSize: 14, color: '#856404',
  },
};
