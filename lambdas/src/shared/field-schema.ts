export interface FieldDefinition {
  key: string;
  label: string;
  type: 'text' | 'date' | 'array' | 'textarea';
  definition: string;
  required: boolean;
  order: number;
}

export type FieldSchema = FieldDefinition[];

const VALID_TYPES = new Set(['text', 'date', 'array', 'textarea']);
const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

export function validateFieldSchema(schema: unknown): { valid: true } | { valid: false; error: string } {
  if (!Array.isArray(schema)) {
    return { valid: false, error: 'Schema must be an array' };
  }
  if (schema.length === 0) {
    return { valid: false, error: 'Schema must contain at least 1 field' };
  }

  const keys = new Set<string>();

  for (let i = 0; i < schema.length; i++) {
    const field = schema[i];
    if (!field || typeof field !== 'object') {
      return { valid: false, error: `Field at index ${i} must be an object` };
    }

    const f = field as Record<string, unknown>;

    // Check required properties exist
    for (const prop of ['key', 'label', 'type', 'definition', 'required', 'order'] as const) {
      if (f[prop] === undefined || f[prop] === null) {
        return { valid: false, error: `Field at index ${i} is missing required property '${prop}'` };
      }
    }

    if (typeof f.key !== 'string' || !KEY_PATTERN.test(f.key)) {
      return { valid: false, error: `Field at index ${i} has invalid key '${f.key}'. Key must match /^[a-z][a-z0-9_]*$/` };
    }

    if (keys.has(f.key as string)) {
      return { valid: false, error: `Duplicate key '${f.key}' at index ${i}` };
    }
    keys.add(f.key as string);

    if (typeof f.label !== 'string' || !f.label.trim()) {
      return { valid: false, error: `Field at index ${i} has invalid or empty label` };
    }

    if (!VALID_TYPES.has(f.type as string)) {
      return { valid: false, error: `Field at index ${i} has invalid type '${f.type}'. Must be one of: text, date, array, textarea` };
    }

    if (typeof f.definition !== 'string' || !f.definition.trim()) {
      return { valid: false, error: `Field at index ${i} has invalid or empty definition` };
    }

    if (typeof f.required !== 'boolean') {
      return { valid: false, error: `Field at index ${i} has invalid required value. Must be a boolean` };
    }

    if (typeof f.order !== 'number' || !Number.isInteger(f.order) || f.order < 0) {
      return { valid: false, error: `Field at index ${i} has invalid order. Must be an integer >= 0` };
    }
  }

  return { valid: true };
}

export const DEFAULT_SCHEMA: FieldSchema = [
  {
    key: 'airline_code',
    label: 'Airline Code',
    type: 'text',
    definition: 'The IATA 2-letter airline code, e.g. AA for American Airlines, UA for United Airlines, DL for Delta Air Lines',
    required: true,
    order: 0,
  },
  {
    key: 'waiver_title',
    label: 'Waiver Title',
    type: 'text',
    definition: 'The official title or name of the waiver advisory as published by the airline',
    required: true,
    order: 1,
  },
  {
    key: 'waiver_code',
    label: 'Waiver Code',
    type: 'text',
    definition: 'The official waiver or advisory code as shown on the source page, e.g. "2024-001"',
    required: true,
    order: 2,
  },
  {
    key: 'effective_date',
    label: 'Effective Date',
    type: 'date',
    definition: 'The start date when the waiver becomes effective, in ISO 8601 format (YYYY-MM-DD)',
    required: true,
    order: 3,
  },
  {
    key: 'expiration_date',
    label: 'Expiration Date',
    type: 'date',
    definition: 'The end date when the waiver expires, in ISO 8601 format (YYYY-MM-DD)',
    required: true,
    order: 4,
  },
  {
    key: 'applicable_routes',
    label: 'Applicable Routes',
    type: 'array',
    definition: 'Origin-destination route pairs that the waiver applies to, e.g. ["JFK-LAX", "ORD-SFO"]',
    required: false,
    order: 5,
  },
  {
    key: 'fare_classes',
    label: 'Fare Classes',
    type: 'array',
    definition: 'Applicable fare class codes that the waiver covers, e.g. ["Y", "B", "M"]',
    required: false,
    order: 6,
  },
  {
    key: 'rebooking_rules',
    label: 'Rebooking Rules',
    type: 'textarea',
    definition: 'Free-text summary of the rebooking policies and conditions under this waiver',
    required: false,
    order: 7,
  },
  {
    key: 'refund_rules',
    label: 'Refund Rules',
    type: 'textarea',
    definition: 'Free-text summary of the refund policies and conditions under this waiver',
    required: false,
    order: 8,
  },
];
