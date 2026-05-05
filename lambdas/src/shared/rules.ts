import { docClient, TableNames } from './db';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

export type RuleId =
  | 'auto_approve_threshold'
  | 'duplicate_detection'
  | 'expired_waiver_flagging'
  | 'high_impact_priority_boost';

export interface RuleRecord {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  parameters: Record<string, unknown>;
  condition: string;
  action: string;
  updated_at: string;
}

const RULE_IDS: RuleId[] = [
  'auto_approve_threshold',
  'duplicate_detection',
  'expired_waiver_flagging',
  'high_impact_priority_boost',
];

export const DEFAULT_RULES: Record<RuleId, Omit<RuleRecord, 'updated_at'>> = {
  auto_approve_threshold: {
    key: 'rule:auto_approve_threshold',
    name: 'Auto-Approve Threshold',
    description: 'Routes high-confidence waivers to auto-approval based on a configurable confidence threshold.',
    enabled: true,
    parameters: { threshold: 0.85 },
    condition: 'Overall confidence score >= threshold',
    action: 'Auto-approve waiver without manual review',
  },
  duplicate_detection: {
    key: 'rule:duplicate_detection',
    name: 'Duplicate Detection',
    description: 'Tags incoming waivers that match existing records by airline code and waiver code.',
    enabled: true,
    parameters: {},
    condition: 'Matching airline_code and waiver_code found in existing records',
    action: 'Tag waiver as duplicate',
  },
  expired_waiver_flagging: {
    key: 'rule:expired_waiver_flagging',
    name: 'Expired Waiver Flagging',
    description: 'Marks active waivers past their expiration date as expired on a daily schedule.',
    enabled: true,
    parameters: {},
    condition: 'Waiver status is active and expiration_date < current date',
    action: 'Update waiver status to expired',
  },
  high_impact_priority_boost: {
    key: 'rule:high_impact_priority_boost',
    name: 'High-Impact Priority Boost',
    description: 'Prioritises waivers with material field changes in the review queue.',
    enabled: true,
    parameters: {},
    condition: 'Waiver flagged as high-impact by the detector',
    action: 'Set priority to high',
  },
};

/**
 * Read a single rule from the Settings table.
 * Falls back to defaults if the record is missing or on DynamoDB errors.
 */
export async function getRule(ruleId: RuleId): Promise<RuleRecord> {
  const defaultRule = DEFAULT_RULES[ruleId];
  try {
    const result = await docClient.send(new GetCommand({
      TableName: TableNames.settings,
      Key: { key: `rule:${ruleId}` },
    }));

    if (result.Item) {
      return result.Item as RuleRecord;
    }

    console.warn(`Rule record missing for "${ruleId}", falling back to defaults`);
    return { ...defaultRule, updated_at: new Date().toISOString() };
  } catch (error) {
    console.warn(`DynamoDB error reading rule "${ruleId}", falling back to defaults:`, error);
    return { ...defaultRule, updated_at: new Date().toISOString() };
  }
}

/**
 * Read all four rules from the Settings table.
 * Merges with defaults for any missing rules. Returns sorted by rule ID.
 */
export async function getAllRules(): Promise<RuleRecord[]> {
  const rules: RuleRecord[] = [];

  for (const ruleId of RULE_IDS) {
    const rule = await getRule(ruleId);
    rules.push(rule);
  }

  return rules.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Partial update of a rule's enabled/parameters fields.
 * Sets updated_at to the current ISO 8601 timestamp.
 */
export async function updateRule(
  ruleId: RuleId,
  updates: { enabled?: boolean; parameters?: Record<string, unknown> },
): Promise<RuleRecord> {
  const existing = await getRule(ruleId);

  const updated: RuleRecord = {
    ...existing,
    ...(updates.enabled !== undefined && { enabled: updates.enabled }),
    ...(updates.parameters !== undefined && { parameters: updates.parameters }),
    updated_at: new Date().toISOString(),
  };

  await docClient.send(new PutCommand({
    TableName: TableNames.settings,
    Item: updated,
  }));

  return updated;
}

/**
 * Writes default rules to the Settings table if they don't already exist.
 * Uses conditional PutItem to avoid overwriting existing records.
 */
export async function seedDefaultRules(): Promise<void> {
  const now = new Date().toISOString();

  for (const ruleId of RULE_IDS) {
    const item: RuleRecord = {
      ...DEFAULT_RULES[ruleId],
      updated_at: now,
    };

    try {
      await docClient.send(new PutCommand({
        TableName: TableNames.settings,
        Item: item,
        ConditionExpression: 'attribute_not_exists(#k)',
        ExpressionAttributeNames: { '#k': 'key' },
      }));
      console.log(`Seeded default rule: ${ruleId}`);
    } catch (error: unknown) {
      if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
        // Rule already exists, skip
        continue;
      }
      console.warn(`Failed to seed rule "${ruleId}":`, error);
    }
  }
}
