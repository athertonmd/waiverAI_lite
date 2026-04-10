/**
 * Property-based test for WaiverRecord round-trip serialization integrity.
 *
 * **Validates: Requirements 5.1, 5.2, 5.3**
 */
import * as fc from 'fast-check';
import {
  WaiverRecord,
  ConfidenceScores,
  CONFIDENCE_FIELDS,
  serializeWaiverRecord,
  deserializeWaiverRecord,
  computeOverallConfidence,
} from '../waiver-record';

const confidenceScoresArb: fc.Arbitrary<ConfidenceScores> = fc.record({
  airline_code: fc.double({ min: 0, max: 1, noNaN: true }),
  waiver_title: fc.double({ min: 0, max: 1, noNaN: true }),
  waiver_code: fc.double({ min: 0, max: 1, noNaN: true }),
  effective_date: fc.double({ min: 0, max: 1, noNaN: true }),
  expiration_date: fc.double({ min: 0, max: 1, noNaN: true }),
  applicable_routes: fc.double({ min: 0, max: 1, noNaN: true }),
  fare_classes: fc.double({ min: 0, max: 1, noNaN: true }),
  rebooking_rules: fc.double({ min: 0, max: 1, noNaN: true }),
  refund_rules: fc.double({ min: 0, max: 1, noNaN: true }),
});

const statusArb = fc.constantFrom(
  'pending_review' as const,
  'active' as const,
  'rejected' as const,
  'expired' as const,
  'auto_approved' as const,
);

const sourceTypeArb = fc.constantFrom(
  'email' as const,
  'pdf' as const,
  'web' as const,
);

const isoDateArb = fc.date({
  min: new Date('2020-01-01'),
  max: new Date('2030-12-31'),
}).map((d) => d.toISOString().split('T')[0]);

const isoDateTimeArb = fc.date({
  min: new Date('2020-01-01'),
  max: new Date('2030-12-31'),
}).map((d) => d.toISOString());

const nullableStringArb = fc.oneof(fc.string(), fc.constant(null));

const waiverRecordArb: fc.Arbitrary<WaiverRecord> = fc.record({
  id: fc.uuid(),
  airline_code: fc.stringOf(fc.constantFrom('A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'), { minLength: 2, maxLength: 2 }),
  waiver_title: fc.string({ minLength: 1, maxLength: 200 }),
  waiver_code: fc.string({ minLength: 1, maxLength: 50 }),
  effective_date: isoDateArb,
  expiration_date: isoDateArb,
  applicable_routes: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 10 }),
  fare_classes: fc.array(fc.string({ minLength: 1, maxLength: 5 }), { maxLength: 10 }),
  rebooking_rules: fc.string({ maxLength: 500 }),
  refund_rules: fc.string({ maxLength: 500 }),
  confidence_scores: confidenceScoresArb,
  overall_confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  status: statusArb,
  source_type: sourceTypeArb,
  source_s3_key: fc.string({ minLength: 1, maxLength: 200 }),
  normalized_s3_key: fc.string({ minLength: 1, maxLength: 200 }),
  ingestion_timestamp: isoDateTimeArb,
  extraction_timestamp: isoDateTimeArb,
  approval_timestamp: fc.oneof(isoDateTimeArb, fc.constant(null)),
  reviewer_id: nullableStringArb,
  rejection_reason: nullableStringArb,
  version_number: fc.integer({ min: 1, max: 1000 }),
  created_at: isoDateTimeArb,
  updated_at: isoDateTimeArb,
});

describe('WaiverRecord round-trip serialization', () => {
  it('should preserve all fields through serialize → deserialize round-trip', () => {
    fc.assert(
      fc.property(waiverRecordArb, (record) => {
        const serialized = serializeWaiverRecord(record);
        const deserialized = deserializeWaiverRecord(serialized);
        expect(deserialized).toEqual(record);
      }),
      { numRuns: 200 },
    );
  });
});

describe('computeOverallConfidence', () => {
  it('should always return the minimum of all field scores', () => {
    fc.assert(
      fc.property(confidenceScoresArb, (scores) => {
        const overall = computeOverallConfidence(scores);
        for (const field of CONFIDENCE_FIELDS) {
          expect(overall).toBeLessThanOrEqual(scores[field]);
        }
      }),
      { numRuns: 200 },
    );
  });
});
