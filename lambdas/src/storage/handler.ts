import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { docClient, TableNames } from '../shared/db';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { dispatchWebhook } from '../webhooks/dispatcher';
import { checkForDuplicate } from './duplicate-detector';

const s3 = new S3Client({});
const BUCKET = process.env.INGESTION_BUCKET!;

export interface StoreEvent {
  extractedS3Key: string;
  recordId: string;
  overallConfidence: number;
  status: 'auto_approved' | 'pending_review';
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
    airline_code: record.airline_code,
    waiver_title: record.waiver_title,
    waiver_code: record.waiver_code,
    effective_date: record.effective_date,
    expiration_date: record.expiration_date,
    applicable_routes: record.applicable_routes,
    fare_classes: record.fare_classes,
    rebooking_rules: record.rebooking_rules,
    refund_rules: record.refund_rules,
    confidence_scores: record.confidence_scores,
    overall_confidence: record.overall_confidence,
    status,
    source_type: record.source_type,
    source_s3_key: record.source_s3_key,
    normalized_s3_key: record.normalized_s3_key,
    ingestion_timestamp: record.ingestion_timestamp,
    extraction_timestamp: record.extraction_timestamp,
    version_number: existing ? existing.existingVersionNumber + 1 : (record.version_number ?? 1),
    created_at: existing ? undefined : now,
    updated_at: now,
  };

  // Remove undefined values
  for (const key of Object.keys(item)) {
    if (item[key] === undefined) delete item[key];
  }

  await docClient.send(new PutCommand({
    TableName: TableNames.waivers,
    Item: item,
  }));
}

export async function handler(event: StoreEvent): Promise<StoreResult> {
  const { extractedS3Key, recordId, status } = event;

  console.log(`Storing: recordId=${recordId}, status=${status}, key=${extractedS3Key}`);

  const record = await fetchExtractedRecord(extractedS3Key);

  // Check for duplicate before persisting
  const airlineCode = (record.airline_code as string) ?? '';
  const waiverCode = (record.waiver_code as string) ?? '';
  const duplicateResult = await checkForDuplicate(airlineCode, waiverCode);

  // Always insert as a new record using the pipeline-assigned recordId.
  // The duplicate detection (same airline_code + waiver_code + effective_date)
  // was causing different waivers to overwrite each other when the AI extracted
  // similar fields. For the MVP, every ingested URL gets its own record.
  const now = new Date().toISOString();
  const item: Record<string, unknown> = {
    id: recordId,
    airline_code: record.airline_code,
    waiver_title: record.waiver_title,
    waiver_code: record.waiver_code,
    effective_date: record.effective_date,
    expiration_date: record.expiration_date,
    applicable_routes: record.applicable_routes,
    fare_classes: record.fare_classes,
    rebooking_rules: record.rebooking_rules,
    refund_rules: record.refund_rules,
    confidence_scores: record.confidence_scores,
    overall_confidence: record.overall_confidence,
    status,
    source_type: record.source_type,
    source_s3_key: record.source_s3_key,
    source_url: record.source_url ?? '',
    normalized_s3_key: record.normalized_s3_key,
    ingestion_timestamp: record.ingestion_timestamp,
    extraction_timestamp: record.extraction_timestamp,
    version_number: 1,
    is_duplicate: duplicateResult.isDuplicate,
    duplicate_of_id: duplicateResult.duplicateOfId,
    created_at: now,
    updated_at: now,
  };

  // Remove undefined values
  for (const key of Object.keys(item)) {
    if (item[key] === undefined) delete item[key];
  }

  await docClient.send(new PutCommand({
    TableName: TableNames.waivers,
    Item: item,
  }));

  console.log(`Stored record ${recordId} with status=${status}`);

  // Fire-and-forget webhook
  dispatchWebhook('waiver.created', { id: recordId, status }).catch(() => {});

  return { recordId, status, stored: true };
}
