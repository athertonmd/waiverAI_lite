import { isHighImpactChange, flagHighImpact } from '../detector';
import { WaiverRecord } from '@waiver-data-hub/shared/src/waiver-record';

/** Helper to build a minimal WaiverRecord for testing. */
function makeRecord(overrides: Partial<WaiverRecord> = {}): WaiverRecord {
  return {
    id: 'test-id',
    airline_code: 'AA',
    waiver_title: 'Test Waiver',
    waiver_code: 'WVR-001',
    effective_date: '2024-06-01',
    expiration_date: '2024-12-31',
    applicable_routes: ['JFK-LAX', 'ORD-SFO'],
    fare_classes: ['Y', 'B'],
    rebooking_rules: 'Free rebooking allowed',
    refund_rules: 'Full refund within 24h',
    confidence_scores: {
      airline_code: 0.95,
      waiver_title: 0.9,
      waiver_code: 0.92,
      effective_date: 0.97,
      expiration_date: 0.91,
      applicable_routes: 0.88,
      fare_classes: 0.85,
      rebooking_rules: 0.8,
      refund_rules: 0.78,
    },
    overall_confidence: 0.78,
    status: 'active',
    source_type: 'web',
    source_s3_key: 'raw/web/abc/1.html',
    normalized_s3_key: 'normalized/web/abc.txt',
    ingestion_timestamp: '2024-06-01T00:00:00Z',
    extraction_timestamp: '2024-06-01T00:01:00Z',
    approval_timestamp: null,
    reviewer_id: null,
    rejection_reason: null,
    version_number: 1,
    created_at: '2024-06-01T00:00:00Z',
    updated_at: '2024-06-01T00:01:00Z',
    ...overrides,
  };
}

describe('isHighImpactChange', () => {
  it('returns false when no fields changed', () => {
    const prev = makeRecord();
    const curr = makeRecord();
    expect(isHighImpactChange(prev, curr)).toBe(false);
  });

  it('returns true when effective_date changes', () => {
    const prev = makeRecord();
    const curr = makeRecord({ effective_date: '2024-07-01' });
    expect(isHighImpactChange(prev, curr)).toBe(true);
  });

  it('returns true when expiration_date changes', () => {
    const prev = makeRecord();
    const curr = makeRecord({ expiration_date: '2025-01-15' });
    expect(isHighImpactChange(prev, curr)).toBe(true);
  });

  it('returns true when applicable_routes changes', () => {
    const prev = makeRecord();
    const curr = makeRecord({ applicable_routes: ['JFK-LAX', 'ORD-SFO', 'DFW-MIA'] });
    expect(isHighImpactChange(prev, curr)).toBe(true);
  });

  it('returns true when fare_classes changes', () => {
    const prev = makeRecord();
    const curr = makeRecord({ fare_classes: ['Y', 'B', 'F'] });
    expect(isHighImpactChange(prev, curr)).toBe(true);
  });

  it('returns true when waiver_code changes', () => {
    const prev = makeRecord();
    const curr = makeRecord({ waiver_code: 'WVR-002' });
    expect(isHighImpactChange(prev, curr)).toBe(true);
  });

  it('returns false when only non-key fields change (rebooking_rules)', () => {
    const prev = makeRecord();
    const curr = makeRecord({ rebooking_rules: 'Updated rebooking policy' });
    expect(isHighImpactChange(prev, curr)).toBe(false);
  });

  it('returns false when only non-key fields change (refund_rules)', () => {
    const prev = makeRecord();
    const curr = makeRecord({ refund_rules: 'No refunds' });
    expect(isHighImpactChange(prev, curr)).toBe(false);
  });

  it('treats reordered arrays as equal (not high impact)', () => {
    const prev = makeRecord({ applicable_routes: ['JFK-LAX', 'ORD-SFO'] });
    const curr = makeRecord({ applicable_routes: ['ORD-SFO', 'JFK-LAX'] });
    expect(isHighImpactChange(prev, curr)).toBe(false);
  });
});

describe('flagHighImpact', () => {
  it('calls pool.query with correct SQL and params', async () => {
    const mockPool = { query: jest.fn().mockResolvedValue({}) };
    await flagHighImpact(mockPool, 'version-123', true);
    expect(mockPool.query).toHaveBeenCalledWith(
      'UPDATE web_content_versions SET high_impact = $1 WHERE id = $2',
      [true, 'version-123'],
    );
  });
});
