export const SENSITIVE_FIELDS = ['source_s3_key', 'normalized_s3_key', 'reviewer_id'] as const;

export function redactWaiver(waiver: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...waiver };
  for (const field of SENSITIVE_FIELDS) {
    delete copy[field];
  }
  return copy;
}

export function redactWaivers(waivers: Record<string, unknown>[]): Record<string, unknown>[] {
  return waivers.map(redactWaiver);
}
