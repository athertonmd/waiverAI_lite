import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { docClient, TableNames } from '../shared/db';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { dispatchWebhook } from '../webhooks/dispatcher';
import { checkForDuplicate } from './duplicate-detector';
import { DEFAULT_SCHEMA } from '../shared/field-schema';
import { getRule } from '../shared/rules';

const s3 = new S3Client({});
const BUCKET = process.env.INGESTION_BUCKET!;

export interface StoreEvent {
  extractedS3Key: string;
  recordId: string;
  overallConfidence: number;
}

export interface StoreResult {
  recordId: string;
  status: string;
  stored: boolean;
}

/**
 * Fetches the extracted record from S3.
 */
export async function fetchExtractedRecord(extractedS3Key: string): Promise<Record<string, unknown>> {
  const resp = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: extractedS3Key }));
  const body = await resp.Body!.transformToString('utf-8');
  return JSON.parse(body);
}

/**
 * If a waiver already exists for the same (airline_code, waiver_code, effective_date),
 * snapshot the current item into WaiverVersions before the upsert overwrites it.
 */
export async function snapshotExistingVersion(
  record: Record<string, unknown>,
): Promise<{ existingId: string; existingVersionNumber: number } | null> {
  // Scan for existing waiver with same composite key
  const result = await docClient.send(new QueryCommand({
    TableName: TableNames.waivers,
    IndexName: 'airline_code-index',
    KeyConditionExpression: 'airline_code = :ac',
    FilterExpression: 'waiver_code = :wc AND effective_date = :ed',
    ExpressionAttributeValues: {
      ':ac': record.airline_code,
      ':wc': record.waiver_code,
      ':ed': record.effective_date,
    },
  }));

  if (result.Items && result.Items.length > 0) {
    const old = result.Items[0];
    const versionNumber = (old.version_number as number) ?? 1;

    await docClient.send(new PutCommand({
      TableName: TableNames.waiverVersions,
      Item: {
        waiver_id: old.id,
        version_number: versionNumber,
        data: JSON.stringify(old),
        changed_by: (record.reviewer_id as string) ?? 'system',
        changed_at: new Date().toISOString(),
      },
    }));

    console.log(`Archived version ${versionNumber} of waiver ${old.id}`);
    return { existingId: old.id as string, existingVersionNumber: versionNumber };
  }

  return null;
}

/**
 * Upserts a waiver record. If an existing record was found, increments version_number.
 */
export async function upsertWaiver(
  record: Record<string, unknown>,
  status: string,
  existing: { existingId: string; existingVersionNumber: number } | null,
): Promise<void> {
  const now = new Date().toISOString();
  const item: Record<string, unknown> = {
    id: existing?.existingId ?? record.id,
  };

  // Schema-driven field persistence
  for (const field of DEFAULT_SCHEMA) {
    if (record[field.key] !== undefined) {
      item[field.key] = record[field.key];
    }
  }

  // Backward compat: map applicable_routes → airports
  if (!item.airports && record.applicable_routes) {
    item.airports = record.applicable_routes;
  }

  // System fields
  item.confidence_scores = record.confidence_scores;
  item.overall_confidence = record.overall_confidence;
  item.status = status;
  item.source_type = record.source_type;
  item.source_s3_key = record.source_s3_key;
  item.normalized_s3_key = record.normalized_s3_key;
  item.ingestion_timestamp = record.ingestion_timestamp;
  item.extraction_timestamp = record.extraction_timestamp;
  item.version_number = existing ? existing.existingVersionNumber + 1 : (record.version_number ?? 1);
  item.created_at = existing ? undefined : now;
  item.updated_at = now;

  // Remove undefined values
  for (const key of Object.keys(item)) {
    if (item[key] === undefined) delete item[key];
  }

  // Store a snapshot of the original AI extraction for few-shot learning.
  // When a reviewer edits fields and saves a draft, the saveDraft handler
  // compares the edited values against this snapshot to record corrections.
  const checkFields = DEFAULT_SCHEMA.map(f => f.key);
  const aiExtraction: Record<string, unknown> = {};
  for (const field of checkFields) {
    if (item[field] !== undefined) {
      aiExtraction[field] = item[field];
    }
  }
  item.ai_extraction = aiExtraction;

  await docClient.send(new PutCommand({
    TableName: TableNames.waivers,
    Item: item,
  }));
}

export async function handler(event: StoreEvent): Promise<StoreResult> {
  const { extractedS3Key, recordId, overallConfidence } = event;

  // Read rules at the start — getRule falls back to defaults on DynamoDB errors
  const [autoApproveRule, duplicateRule, highImpactRule] = await Promise.all([
    getRule('auto_approve_threshold'),
    getRule('duplicate_detection'),
    getRule('high_impact_priority_boost'),
  ]);

  // Determine final status based on auto-approve rule
  let finalStatus: string;
  if (autoApproveRule.enabled) {
    const threshold = (autoApproveRule.parameters.threshold as number) ?? 0.85;
    finalStatus = overallConfidence >= threshold ? 'auto_approved' : 'pending_review';
  } else {
    finalStatus = 'pending_review';
  }

  console.log(`Storing: recordId=${recordId}, status=${finalStatus}, key=${extractedS3Key}`);

  const record = await fetchExtractedRecord(extractedS3Key);

  // Conditional duplicate detection based on rule
  let duplicateResult = { isDuplicate: false, duplicateOfId: null as string | null };
  if (duplicateRule.enabled) {
    const airlineCode = (record.airline_code as string) ?? '';
    const waiverCode = (record.waiver_code as string) ?? '';
    duplicateResult = await checkForDuplicate(airlineCode, waiverCode);
  }

  // Always insert as a new record using the pipeline-assigned recordId.
  // The duplicate detection (same airline_code + waiver_code + effective_date)
  // was causing different waivers to overwrite each other when the AI extracted
  // similar fields. For the MVP, every ingested URL gets its own record.
  const now = new Date().toISOString();
  const item: Record<string, unknown> = {
    id: recordId,
  };

  // Schema-driven field persistence
  for (const field of DEFAULT_SCHEMA) {
    if (record[field.key] !== undefined) {
      item[field.key] = record[field.key];
    }
  }

  // Backward compat: map applicable_routes → airports
  if (!item.airports && record.applicable_routes) {
    item.airports = record.applicable_routes;
  }

  // System fields
  item.confidence_scores = record.confidence_scores;
  item.overall_confidence = record.overall_confidence;
  item.status = finalStatus;
  item.source_type = record.source_type;
  item.source_s3_key = record.source_s3_key;
  item.source_url = record.source_url ?? '';
  item.normalized_s3_key = record.normalized_s3_key;
  item.ingestion_timestamp = record.ingestion_timestamp;
  item.extraction_timestamp = record.extraction_timestamp;
  item.version_number = 1;
  item.is_duplicate = duplicateResult.isDuplicate;
  item.duplicate_of_id = duplicateResult.duplicateOfId;
  item.created_at = now;
  item.updated_at = now;

  // Conditional high-impact priority boost
  if (highImpactRule.enabled && record.high_impact === true) {
    item.priority = 'high';
  }

  // Remove undefined values
  for (const key of Object.keys(item)) {
    if (item[key] === undefined) delete item[key];
  }

  // Store a snapshot of the original AI extraction for few-shot learning.
  const aiCheckFields = DEFAULT_SCHEMA.map(f => f.key);
  const aiExtraction: Record<string, unknown> = {};
  for (const field of aiCheckFields) {
    if (item[field] !== undefined) {
      aiExtraction[field] = item[field];
    }
  }
  item.ai_extraction = aiExtraction;

  await docClient.send(new PutCommand({
    TableName: TableNames.waivers,
    Item: item,
  }));

  console.log(`Stored record ${recordId} with status=${finalStatus}`);

  // Fire-and-forget webhook
  dispatchWebhook('waiver.created', { id: recordId, status: finalStatus }).catch(() => {});

  return { recordId, status: finalStatus, stored: true };
}
