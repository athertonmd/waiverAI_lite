import { useState, useRef } from 'react';
import { apiPost } from '../api/client';

interface UrlEntry {
  id: number;
  url: string;
  status: 'pending' | 'submitting' | 'success' | 'error';
  message?: string;
  schedule?: boolean;
  intervalMinutes?: number;
  endDateTime?: string;
}

interface PdfUpload {
  file: File;
  status: 'pending' | 'uploading' | 'success' | 'error';
  message?: string;
}

let nextId = 1;

export function Ingest() {
  const [entries, setEntries] = useState<UrlEntry[]>([
    { id: nextId++, url: '', status: 'pending' },
  ]);
  const [bulkInput, setBulkInput] = useState('');
  const [showBulk, setShowBulk] = useState(false);

  const updateEntry = (id: number, url: string) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, url, status: 'pending', message: undefined } : e)));
  };

  const removeEntry = (id: number) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const addEntry = () => {
    setEntries((prev) => [...prev, { id: nextId++, url: '', status: 'pending' }]);
  };

  const addBulkUrls = () => {
    const urls = bulkInput
      .split('\n')
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
    if (urls.length === 0) return;
    const newEntries = urls.map((url) => ({ id: nextId++, url, status: 'pending' as const }));
    setEntries((prev) => [...prev, ...newEntries]);
    setBulkInput('');
    setShowBulk(false);
  };

  const submitAll = async () => {
    const toSubmit = entries.filter((e) => e.url.trim() && e.status !== 'success');
    if (toSubmit.length === 0) return;

    // Mark all as submitting
    setEntries((prev) =>
      prev.map((e) =>
        toSubmit.some((s) => s.id === e.id) ? { ...e, status: 'submitting' } : e,
      ),
    );

    // Submit each URL
    for (const entry of toSubmit) {
      try {
        await apiPost('/v1/ingestion/web-url', { url: entry.url.trim() });

        // Create a monitor schedule if auto-fetch is enabled
        if (entry.schedule && entry.endDateTime) {
          try {
            await apiPost('/v1/monitoring/schedules', {
              url: entry.url.trim(),
              intervalMinutes: entry.intervalMinutes ?? 60,
              endDateTime: new Date(entry.endDateTime).toISOString(),
            });
          } catch {
            // Schedule creation failed but the initial fetch succeeded
          }
        }

        setEntries((prev) =>
          prev.map((e) =>
            e.id === entry.id ? { ...e, status: 'success', message: entry.schedule ? 'Submitted + scheduled' : 'Submitted for ingestion' } : e,
          ),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to submit';
        setEntries((prev) =>
          prev.map((e) =>
            e.id === entry.id ? { ...e, status: 'error', message: msg } : e,
          ),
        );
      }
    }
  };

  const pendingCount = entries.filter((e) => e.url.trim() && e.status !== 'success').length;
  const successCount = entries.filter((e) => e.status === 'success').length;
  const submitting = entries.some((e) => e.status === 'submitting');

  return (
    <div>
      <h1 style={S.heading}>Ingest Waivers</h1>
      <p style={S.subtitle}>
        Submit airline waiver URLs or upload PDF documents. Each source will be processed through the extraction pipeline.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Web URLs</h2>
      <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
        Enter one or more airline waiver page URLs.
      </p>

      {/* URL entries */}
      <div className="card" style={{ marginBottom: 16 }}>
        {entries.map((entry, idx) => (
          <div key={entry.id} style={{ marginBottom: 12 }}>
            <div style={S.row}>
              <span style={S.rowNum}>{idx + 1}.</span>
              <input
                type="url"
                placeholder="https://airline.com/waiver-page"
                value={entry.url}
                onChange={(e) => updateEntry(entry.id, e.target.value)}
                disabled={entry.status === 'submitting' || entry.status === 'success'}
                style={{
                  ...S.input,
                  ...(entry.status === 'success' ? S.inputSuccess : {}),
                  ...(entry.status === 'error' ? S.inputError : {}),
                }}
                aria-label={`URL ${idx + 1}`}
              />
              <StatusIcon status={entry.status} />
              {entry.status !== 'submitting' && entry.status !== 'success' && (
                <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  <input
                    type="checkbox"
                    checked={entry.schedule ?? false}
                    onChange={(e) => setEntries((prev) => prev.map((en) => en.id === entry.id ? { ...en, schedule: e.target.checked } : en))}
                  />
                  Auto-fetch
                </label>
              )}
              {entries.length > 1 && entry.status !== 'submitting' && (
                <button onClick={() => removeEntry(entry.id)} style={S.removeBtn} aria-label="Remove URL">
                  ✕
                </button>
              )}
            </div>
            {entry.schedule && entry.status !== 'success' && (
              <div style={{ display: 'flex', gap: 12, marginLeft: 28, marginTop: 4, alignItems: 'center' }}>
                <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  Fetch every
                  <select
                    value={entry.intervalMinutes ?? 60}
                    onChange={(e) => setEntries((prev) => prev.map((en) => en.id === entry.id ? { ...en, intervalMinutes: Number(e.target.value) } : en))}
                    style={{ padding: '4px 8px', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: 13 }}
                    aria-label="Fetch interval"
                  >
                    <option value={15}>15 minutes</option>
                    <option value={30}>30 minutes</option>
                    <option value={60}>1 hour</option>
                    <option value={360}>6 hours</option>
                    <option value={720}>12 hours</option>
                    <option value={1440}>24 hours</option>
                  </select>
                </label>
                <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  Until
                  <input
                    type="datetime-local"
                    value={entry.endDateTime ?? ''}
                    onChange={(e) => setEntries((prev) => prev.map((en) => en.id === entry.id ? { ...en, endDateTime: e.target.value } : en))}
                    style={{ padding: '4px 8px', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: 13 }}
                    aria-label="End date time"
                  />
                </label>
              </div>
            )}
          </div>
        ))}
        {entries.some((e) => e.message) && (
          <div style={{ marginTop: 8 }}>
            {entries.filter((e) => e.message).map((e) => (
              <div key={e.id} style={{ fontSize: 12, color: e.status === 'error' ? 'var(--color-red)' : 'var(--color-green)', marginBottom: 2 }}>
                {e.url.substring(0, 50)}… — {e.message}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={S.actions}>
        <button onClick={addEntry} style={S.addBtn} disabled={submitting}>
          + Add URL
        </button>
        <button onClick={() => setShowBulk(!showBulk)} style={S.addBtn} disabled={submitting}>
          {showBulk ? 'Hide Bulk' : 'Bulk Paste'}
        </button>
        <div style={{ flex: 1 }} />
        {successCount > 0 && (
          <span style={{ fontSize: 13, color: 'var(--color-green)', alignSelf: 'center' }}>
            {successCount} submitted
          </span>
        )}
        <button
          className="btn btn-primary"
          onClick={submitAll}
          disabled={pendingCount === 0 || submitting}
          style={pendingCount === 0 || submitting ? { opacity: 0.5 } : {}}
        >
          {submitting ? 'Submitting…' : `Submit ${pendingCount} URL${pendingCount !== 1 ? 's' : ''}`}
        </button>
      </div>

      {/* Bulk paste area */}
      {showBulk && (
        <div className="card" style={{ marginTop: 16 }}>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
            Paste multiple URLs, one per line:
          </p>
          <textarea
            value={bulkInput}
            onChange={(e) => setBulkInput(e.target.value)}
            placeholder={"https://airline1.com/waiver\nhttps://airline2.com/waiver\nhttps://airline3.com/waiver"}
            style={S.textarea}
            rows={6}
            aria-label="Bulk URL input"
          />
          <button onClick={addBulkUrls} className="btn btn-primary" style={{ marginTop: 8 }}>
            Add URLs
          </button>
        </div>
      )}

      {/* Info */}
      <div className="card" style={{ marginTop: 20, background: '#f0f4ff', border: '1px dashed var(--color-primary)' }}>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>
          After submission, each URL or PDF is fetched/uploaded and stored in S3. The pipeline then normalises the content,
          extracts waiver fields using AI, scores confidence, and routes to auto-approval or the review queue.
          Check the Waivers page or Review Queue after a few minutes.
        </p>
      </div>

      {/* PDF Upload Section */}
      <PdfUploadSection />
    </div>
  );
}

function PdfUploadSection() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<PdfUpload[]>([]);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const pdfs = files.filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (pdfs.length === 0) {
      setBanner({ type: 'error', msg: 'Please select PDF files only.' });
      return;
    }
    const tooLarge = pdfs.filter((f) => f.size > 25 * 1024 * 1024);
    if (tooLarge.length > 0) {
      setBanner({ type: 'error', msg: `${tooLarge.length} file(s) exceed 25 MB limit.` });
      return;
    }
    setBanner(null);
    setUploads((prev) => [...prev, ...pdfs.map((file) => ({ file, status: 'pending' as const }))]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const uploadAll = async () => {
    const toUpload = uploads.filter((u) => u.status === 'pending');
    if (toUpload.length === 0) return;

    setUploads((prev) =>
      prev.map((u) => (u.status === 'pending' ? { ...u, status: 'uploading' } : u)),
    );

    for (const upload of toUpload) {
      try {
        const resp = await apiPost<{ presignedUrl: string; uploadId: string; key: string }>(
          '/v1/ingestion/upload',
          { contentType: 'application/pdf', fileSize: upload.file.size },
        );

        await fetch(resp.presignedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/pdf' },
          body: upload.file,
        }).then((r) => {
          if (!r.ok) throw new Error(`S3 upload failed with status ${r.status}`);
        });

        setUploads((prev) =>
          prev.map((u) =>
            u.file === upload.file ? { ...u, status: 'success', message: 'Uploaded — processing in pipeline' } : u,
          ),
        );
        setBanner({ type: 'success', msg: `${upload.file.name} uploaded successfully. It will appear in the Review Queue after processing.` });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        setUploads((prev) =>
          prev.map((u) =>
            u.file === upload.file ? { ...u, status: 'error', message: msg } : u,
          ),
        );
      }
    }
  };

  const removeUpload = (file: File) => {
    setUploads((prev) => prev.filter((u) => u.file !== file));
  };

  const pendingCount = uploads.filter((u) => u.status === 'pending').length;
  const uploading = uploads.some((u) => u.status === 'uploading');

  return (
    <div style={{ marginTop: 32 }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Upload PDF Documents</h2>
      <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
        Upload one or more PDF waiver documents (max 25 MB each). Each PDF will be processed through OCR and the extraction pipeline.
      </p>

      {banner && (
        <div style={{
          padding: '8px 14px', borderRadius: 4, marginBottom: 12, fontSize: 13,
          background: banner.type === 'error' ? '#fce8e6' : '#e6f4ea',
          color: banner.type === 'error' ? 'var(--color-red)' : 'var(--color-green)',
        }}>
          {banner.msg}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: uploads.length > 0 ? 16 : 0 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            multiple
            onChange={handleFileSelect}
            style={{ display: 'none' }}
            aria-label="Select PDF files"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: '10px 20px', fontSize: 14, cursor: 'pointer',
              border: '2px dashed var(--color-border)', borderRadius: 8,
              background: '#fafafa', color: 'var(--color-primary)', fontWeight: 500,
              flex: 1, textAlign: 'center',
            }}
          >
            📄 Click to select PDF files or drag and drop
          </button>
        </div>

        {uploads.map((u, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 14 }}>📄</span>
            <span style={{ flex: 1, fontSize: 14 }}>{u.file.name}</span>
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
              {(u.file.size / 1024).toFixed(0)} KB
            </span>
            {u.status === 'uploading' && <span>⏳</span>}
            {u.status === 'success' && <span style={{ color: 'var(--color-green)' }}>✓</span>}
            {u.status === 'error' && <span style={{ color: 'var(--color-red)' }} title={u.message}>✗</span>}
            {u.status === 'pending' && (
              <button onClick={() => removeUpload(u.file)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>✕</button>
            )}
          </div>
        ))}
      </div>

      {uploads.length > 0 && (
        <button
          className="btn btn-primary"
          onClick={uploadAll}
          disabled={pendingCount === 0 || uploading}
          style={pendingCount === 0 || uploading ? { opacity: 0.5 } : {}}
        >
          {uploading ? 'Uploading…' : `Upload ${pendingCount} PDF${pendingCount !== 1 ? 's' : ''}`}
        </button>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: UrlEntry['status'] }) {
  if (status === 'submitting') return <span style={{ fontSize: 16 }}>⏳</span>;
  if (status === 'success') return <span style={{ fontSize: 16, color: 'var(--color-green)' }}>✓</span>;
  if (status === 'error') return <span style={{ fontSize: 16, color: 'var(--color-red)' }}>✗</span>;
  return <span style={{ width: 16 }} />;
}

const S: Record<string, React.CSSProperties> = {
  heading: { fontSize: 24, fontWeight: 600, marginBottom: 4 },
  subtitle: { fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 20 },
  row: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  rowNum: { fontSize: 13, color: 'var(--color-text-secondary)', minWidth: 20, textAlign: 'right' },
  input: {
    flex: 1,
    padding: '8px 12px',
    border: '1px solid var(--color-border)',
    borderRadius: 4,
    fontSize: 14,
    outline: 'none',
  },
  inputSuccess: { borderColor: 'var(--color-green)', background: '#f0faf0' },
  inputError: { borderColor: 'var(--color-red)', background: '#fef0f0' },
  removeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 16,
    color: 'var(--color-text-secondary)',
    padding: '4px 8px',
  },
  actions: { display: 'flex', gap: 8, alignItems: 'center' },
  addBtn: {
    background: 'none',
    border: '1px solid var(--color-border)',
    borderRadius: 4,
    padding: '6px 14px',
    fontSize: 13,
    cursor: 'pointer',
    color: 'var(--color-primary)',
  },
  textarea: {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid var(--color-border)',
    borderRadius: 4,
    fontSize: 14,
    fontFamily: 'monospace',
    outline: 'none',
    resize: 'vertical',
  },
};
