import { S3Client, GetObjectCommand, PutObjectCommand, PutObjectTaggingCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DEFAULT_SCHEMA, FieldSchema, FieldDefinition } from '../shared/field-schema';

const s3 = new S3Client({});
const bedrock = new BedrockRuntimeClient({});
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const BUCKET = process.env.INGESTION_BUCKET!;
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'anthropic.claude-3-7-sonnet-20250219-v1:0';
const CORRECTIONS_TABLE = process.env.CORRECTIONS_TABLE ?? '';
const SETTINGS_TABLE = process.env.SETTINGS_TABLE ?? '';

export interface ExtractionEvent {
  normalizedS3Key: string;
  sourceType: 'email' | 'pdf' | 'web' | 'lumo';
  recordId: string;
}

export interface ExtractionResult {
  extractedS3Key: string;
  recordId: string;
  overallConfidence: number;
}

/**
 * Fetch the field schema from the Settings table.
 * Falls back to DEFAULT_SCHEMA if the table is unreachable or no entry exists.
 */
async function fetchFieldSchema(): Promise<FieldSchema> {
  if (!SETTINGS_TABLE) return DEFAULT_SCHEMA;

  try {
    const result = await docClient.send(new GetCommand({
      TableName: SETTINGS_TABLE,
      Key: { key: 'extraction_fields' },
    }));

    if (result.Item && result.Item.value) {
      const schema: FieldSchema = JSON.parse(result.Item.value as string);
      return schema.sort((a, b) => a.order - b.order);
    }
  } catch (err) {
    console.warn('Failed to fetch field schema from Settings table, falling back to DEFAULT_SCHEMA:', err);
  }

  return DEFAULT_SCHEMA;
}

export async function handler(event: ExtractionEvent): Promise<ExtractionResult> {
  const { normalizedS3Key, sourceType, recordId } = event;

  console.log(`Extracting: recordId=${recordId}, normalizedS3Key=${normalizedS3Key}`);

  try {
    const normalizedText = await getObjectText(BUCKET, normalizedS3Key);

    if (!normalizedText || !normalizedText.trim()) {
      throw new ExtractionError('Normalized text is empty or missing');
    }

    const schema = await fetchFieldSchema();
    const sourceUrl = (event as any).sourceUrl ?? '';
    const corrections = await fetchRecentCorrections(sourceType);
    const prompt = buildExtractionPrompt(normalizedText, schema, sourceUrl || undefined, corrections, sourceType);
    const bedrockResponse = await invokeModel(prompt);
    const extracted = parseBedrockResponse(bedrockResponse, schema);
    const overallConfidence = computeOverallConfidence(extracted.confidence_scores, schema);

    const record: Record<string, unknown> = {
      id: recordId,
      ...extracted.fields,
      confidence_scores: extracted.confidence_scores,
      overall_confidence: overallConfidence,
      status: 'pending_review' as const,
      source_type: sourceType,
      source_s3_key: (event as any).sourceS3Key ?? normalizedS3Key.replace('normalized/', 'raw/'),
      source_url: (event as any).sourceUrl ?? '',
      normalized_s3_key: normalizedS3Key,
      ingestion_timestamp: new Date().toISOString(),
      extraction_timestamp: new Date().toISOString(),
      approval_timestamp: null,
      reviewer_id: null,
      rejection_reason: null,
      version_number: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const extractedKey = `extracted/${recordId}.json`;

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: extractedKey,
      Body: JSON.stringify(record),
      ContentType: 'application/json',
      Metadata: {
        'record-id': recordId,
        'source-type': sourceType,
        'overall-confidence': String(overallConfidence),
      },
    }));

    console.log(`Stored extracted record: ${extractedKey}`);

    return { extractedS3Key: extractedKey, recordId, overallConfidence };
  } catch (err) {
    console.error(`Extraction failed for recordId=${recordId}:`, err);
    await markExtractionFailed(BUCKET, normalizedS3Key);
    throw err;
  }
}

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionError';
  }
}

async function getObjectText(bucket: string, key: string): Promise<string> {
  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await resp.Body!.transformToByteArray();
  return Buffer.from(bytes).toString('utf-8');
}

function getTypeInstruction(fieldDef: FieldDefinition): string {
  switch (fieldDef.type) {
    case 'date':
      return 'string (ISO 8601 date, e.g. "2024-01-15")';
    case 'array':
      return 'array of strings';
    case 'text':
    case 'textarea':
    default:
      return 'string';
  }
}

const LUMO_PREAMBLE = `The source document is structured JSON from the Lumo API (thinklumo.com).
Map the following Lumo fields to WaiverHub fields:
- id → waiver_code
- alert.summary → waiver_title
- location.airports → airports
- period.start → effective_date
- period.end → expiration_date
- waiver_codes → fare_classes (if applicable)
- remarks + alert.description → rebooking_rules, refund_rules, release_notes
- dom_intl → airports_qualifier (domestic="From", international="From-To")
Infer airline_code and airline_name from the waiver content where possible.
`;

export function buildExtractionPrompt(normalizedText: string, schema: FieldSchema, sourceUrl?: string, corrections?: CorrectionExample[], sourceType?: string): string {
  const lumoPreamble = sourceType === 'lumo' ? `\n${LUMO_PREAMBLE}` : '';

  const sourceHint = sourceUrl
    ? `\nSOURCE URL: ${sourceUrl}\nUse the source URL to help identify the airline. For example, "saleslink.aa.com" is American Airlines (AA), "etihadhub.com" is Etihad Airways (EY), "united.com" is United Airlines (UA), etc.\n`
    : '';

  // Build few-shot correction examples from human feedback
  let correctionHint = '';
  if (corrections && corrections.length > 0) {
    correctionHint = '\nIMPORTANT - LEARN FROM PAST CORRECTIONS:\nHuman reviewers have corrected the following extraction mistakes in the past. Use these to improve your accuracy:\n';
    for (const c of corrections.slice(0, 5)) {
      correctionHint += `\nAirline: ${c.airline_code}\n`;
      for (const [field, { ai, human }] of Object.entries(c.corrections)) {
        correctionHint += `  - ${field}: AI extracted "${ai}" → Human corrected to "${human}"\n`;
      }
    }
    correctionHint += '\nApply these lessons to the current extraction.\n';
  }

  const sortedSchema = [...schema].sort((a, b) => a.order - b.order);

  // Build per-field instructions
  const fieldInstructions = sortedSchema.map((f) => {
    return `- "${f.key}": ${getTypeInstruction(f)}\n  Description: ${f.definition}`;
  }).join('\n');

  // Build example confidence_scores
  const confidenceExample = sortedSchema.map((f) => `  "${f.key}": 0.85`).join(',\n');

  return `You are an airline waiver data extraction assistant. Extract structured waiver information from the following text and return ONLY a valid JSON object with no additional text.
${lumoPreamble}${sourceHint}${correctionHint}
The JSON object must have exactly these fields:
${fieldInstructions}
- "confidence_scores": object with a confidence score (0.0 to 1.0) for each field above

Example confidence_scores:
{
${confidenceExample}
}

TEXT TO EXTRACT FROM:
${normalizedText}

Return ONLY the JSON object.`;
}

async function invokeModel(prompt: string): Promise<string> {
  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const resp = await bedrock.send(new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: new TextEncoder().encode(body),
  }));

  const responseBody = JSON.parse(new TextDecoder().decode(resp.body));
  // Sonnet 3.7 may return thinking blocks — find the text block
  const textBlock = (responseBody.content ?? []).find((b: { type: string }) => b.type === 'text');
  return textBlock?.text ?? '';
}

export function parseBedrockResponse(responseText: string, schema: FieldSchema): { fields: Record<string, unknown>; confidence_scores: Record<string, number> } {
  if (!responseText || !responseText.trim()) {
    throw new ExtractionError('Bedrock returned empty response');
  }

  // Extract JSON from the response (may be wrapped in markdown code blocks)
  let jsonStr = responseText.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new ExtractionError(`Failed to parse Bedrock response as JSON: ${jsonStr.substring(0, 200)}`);
  }

  const fields: Record<string, unknown> = {};
  for (const fieldDef of schema) {
    const raw = parsed[fieldDef.key];
    switch (fieldDef.type) {
      case 'array':
        fields[fieldDef.key] = Array.isArray(raw) ? raw.map(String) : [];
        break;
      case 'date':
      case 'text':
      case 'textarea':
      default:
        fields[fieldDef.key] = String(raw ?? '');
        break;
    }
  }

  const confidence_scores = parseConfidenceScores(parsed.confidence_scores, schema);

  return { fields, confidence_scores };
}

function parseConfidenceScores(raw: unknown, schema: FieldSchema): Record<string, number> {
  const scores = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const result: Record<string, number> = {};
  for (const fieldDef of schema) {
    const val = Number(scores[fieldDef.key]);
    result[fieldDef.key] = isNaN(val) ? 0 : Math.max(0, Math.min(1, val));
  }
  return result;
}

export function computeOverallConfidence(scores: Record<string, number>, schema: FieldSchema): number {
  const values = schema.map((f) => scores[f.key] ?? 0);
  if (values.length === 0) return 0;
  return Math.min(...values);
}

async function markExtractionFailed(bucket: string, key: string): Promise<void> {
  try {
    await s3.send(new PutObjectTaggingCommand({
      Bucket: bucket,
      Key: key,
      Tagging: {
        TagSet: [{ Key: 'status', Value: 'extraction_failed' }],
      },
    }));
  } catch (tagErr) {
    console.error('Failed to tag object as extraction_failed:', tagErr);
  }
}

/** Correction example from human review feedback. */
export interface CorrectionExample {
  airline_code: string;
  corrections: Record<string, { ai: string; human: string }>;
}

/**
 * Fetch recent correction examples from DynamoDB for few-shot learning.
 * Returns the 5 most recent corrections matching the source type.
 */
async function fetchRecentCorrections(sourceType: string): Promise<CorrectionExample[]> {
  if (!CORRECTIONS_TABLE) return [];

  try {
    const result = await docClient.send(new QueryCommand({
      TableName: CORRECTIONS_TABLE,
      IndexName: 'created_at-index',
      KeyConditionExpression: 'source_type = :st',
      ExpressionAttributeValues: { ':st': sourceType },
      ScanIndexForward: false, // newest first
      Limit: 5,
    }));

    return (result.Items ?? []).map((item) => ({
      airline_code: String(item.airline_code ?? ''),
      corrections: (item.corrections as Record<string, { ai: string; human: string }>) ?? {},
    }));
  } catch (err) {
    console.warn('Failed to fetch corrections for few-shot learning:', err);
    return [];
  }
}
