/**
 * Canonical WaiverRecord type and serialization utilities.
 */

export interface ConfidenceScores {
  airline_code: number;
  waiver_title: number;
  waiver_code: number;
  effective_date: number;
  expiration_date: number;
  applicable_routes: number;
  fare_classes: number;
  rebooking_rules: number;
  refund_rules: number;
}

export const CONFIDENCE_FIELDS: (keyof ConfidenceScores)[] = [
  'airline_code',
  'waiver_title',
  'waiver_code',
  'effective_date',
  'expiration_date',
  'applicable_routes',
  'fare_classes',
  'rebooking_rules',
  'refund_rules',
];

export interface WaiverRecord {
  id: string;
  airline_code: string;
  waiver_title: string;
  waiver_code: string;
  effective_date: string;
  expiration_date: string;
  applicable_routes: string[];
  fare_classes: string[];
  rebooking_rules: string;
  refund_rules: string;
  confidence_scores: ConfidenceScores;
  overall_confidence: number;
  status: 'pending_review' | 'active' | 'rejected' | 'expired' | 'auto_approved';
  source_type: 'email' | 'pdf' | 'web';
  source_s3_key: string;
  normalized_s3_key: string;
  ingestion_timestamp: string;
  extraction_timestamp: string;
  approval_timestamp: string | null;
  reviewer_id: string | null;
  rejection_reason: string | null;
  version_number: number;
  created_at: string;
  updated_at: string;
  is_duplicate?: boolean;
  duplicate_of_id?: string | null;
}

/** Serialize a WaiverRecord to a canonical JSON string. */
export function serializeWaiverRecord(record: WaiverRecord): string {
  return JSON.stringify(record);
}

/** Deserialize a JSON string into a WaiverRecord. */
export function deserializeWaiverRecord(json: string): WaiverRecord {
  const parsed = JSON.parse(json);
  return parsed as WaiverRecord;
}

/** Compute overall confidence as the minimum of all field scores. */
export function computeOverallConfidence(scores: ConfidenceScores): number {
  return Math.min(...CONFIDENCE_FIELDS.map((f) => scores[f]));
}
