import { WaiverRecord } from '@waiver-data-hub/shared/src/waiver-record';

/**
 * Key waiver fields that constitute a "material" change.
 * If any of these differ between two versions, the change is High Impact.
 */
const HIGH_IMPACT_FIELDS: (keyof WaiverRecord)[] = [
  'effective_date',
  'expiration_date',
  'applicable_routes',
  'fare_classes',
  'waiver_code',
];

/**
 * Compare two WaiverRecord objects and determine if the change is high-impact.
 * A change is high-impact if any of the key fields (dates, routes, fare classes,
 * waiver code) differ materially between the previous and current versions.
 */
export function isHighImpactChange(
  previous: WaiverRecord,
  current: WaiverRecord,
): boolean {
  for (const field of HIGH_IMPACT_FIELDS) {
    const prev = previous[field];
    const curr = current[field];

    // Array comparison for applicable_routes and fare_classes
    if (Array.isArray(prev) && Array.isArray(curr)) {
      if (prev.length !== curr.length) return true;
      const sortedPrev = [...prev].sort();
      const sortedCurr = [...curr].sort();
      if (sortedPrev.some((v, i) => v !== sortedCurr[i])) return true;
    } else if (prev !== curr) {
      return true;
    }
  }
  return false;
}

/**
 * Given a schedule_id and the detection result, update the web_content_versions
 * row to flag it as high_impact, and optionally mark the waiver for priority review.
 *
 * This function is intended to be called after extraction completes for a
 * monitored web URL that had a change detected.
 */
export async function flagHighImpact(
  pool: { query: (sql: string, params: unknown[]) => Promise<unknown> },
  contentVersionId: string,
  isHighImpact: boolean,
): Promise<void> {
  await pool.query(
    'UPDATE web_content_versions SET high_impact = $1 WHERE id = $2',
    [isHighImpact, contentVersionId],
  );
}
