import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  APIGatewayClient,
  CreateApiKeyCommand,
  CreateUsagePlanKeyCommand,
  DeleteApiKeyCommand,
  GetUsageCommand,
} from '@aws-sdk/client-api-gateway';
import { docClient, TableNames } from '../shared/db';
import {
  GetCommand, PutCommand, UpdateCommand, ScanCommand, QueryCommand, DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import * as cache from '../shared/cache';
import { dispatchWebhook } from '../webhooks/dispatcher';
import { DEFAULT_SCHEMA, validateFieldSchema, FieldSchema } from '../shared/field-schema';
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminDeleteUserCommand,
  AdminListGroupsForUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const s3 = new S3Client({});
const apigw = new APIGatewayClient({});
const cognitoClient = new CognitoIdentityProviderClient({});
const INGESTION_BUCKET = process.env.INGESTION_BUCKET ?? '';
const USAGE_PLAN_ID = process.env.USAGE_PLAN_ID ?? '';
const REST_API_ID = process.env.REST_API_ID ?? '';
const USER_POOL_ID = process.env.USER_POOL_ID ?? '';

// --- RBAC ---

type Role = 'admin' | 'user';

const USER_ALLOWED_PATHS: string[] = [
  '/v1/waivers',
  '/v1/dashboard',
  '/v1/reports',
];

const USER_ALLOWED_EXACT: string[] = [
  '/v1/settings/extraction-fields',
];

function isUserAllowedPath(path: string): boolean {
  return USER_ALLOWED_PATHS.some(prefix => path.startsWith(prefix))
    || USER_ALLOWED_EXACT.includes(path);
}

export function extractRole(event: APIGatewayProxyEvent): Role | null {
  const groups: string =
    event.requestContext?.authorizer?.claims?.['cognito:groups'] ?? '';
  const list = groups
    .split(',')
    .map((g: string) => g.trim().toLowerCase())
    .filter(Boolean);

  if (list.includes('admin')) return 'admin';
  if (list.includes('user')) return 'user';
  return null;
}

export function isAuthorized(role: Role | null, method: string, path: string): boolean {
  if (!role) return false;
  if (role === 'admin') return true;
  if (role === 'user') {
    return method.toUpperCase() === 'GET' && isUserAllowedPath(path);
  }
  return false;
}

// --- Helpers ---

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': '*',
};

function json(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

function errorResponse(code: string, message: string, statusCode = 400): APIGatewayProxyResult {
  return json(statusCode, { error: { code, message } });
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}


// --- Grouping utility ---

interface GroupedWaiver extends Record<string, unknown> {
  duplicate_count: number;
}

/**
 * Group waiver records by airline_code + waiver_code composite key.
 * Returns only the "latest copy" per group with a duplicate_count field.
 * Latest copy = highest updated_at, then highest ingestion_timestamp as tiebreaker.
 * Records missing airline_code or waiver_code are treated as singletons.
 */
export function groupWaivers(items: Record<string, unknown>[]): GroupedWaiver[] {
  const groups = new Map<string, Record<string, unknown>[]>();

  for (const item of items) {
    const airline = item.airline_code as string | undefined;
    const waiverCode = item.waiver_code as string | undefined;

    if (!airline || !waiverCode) {
      // Treat as singleton — use a unique key
      const singletonKey = `__singleton__::${item.id ?? Math.random()}`;
      groups.set(singletonKey, [item]);
      continue;
    }

    const key = `${airline}::${waiverCode}`;
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  const result: GroupedWaiver[] = [];

  for (const group of groups.values()) {
    // Sort by updated_at DESC, then ingestion_timestamp DESC
    group.sort((a, b) => {
      const aUpdated = (a.updated_at as string) ?? (a.created_at as string) ?? '';
      const bUpdated = (b.updated_at as string) ?? (b.created_at as string) ?? '';
      const cmp = bUpdated.localeCompare(aUpdated);
      if (cmp !== 0) return cmp;
      const aIngestion = (a.ingestion_timestamp as string) ?? '';
      const bIngestion = (b.ingestion_timestamp as string) ?? '';
      return bIngestion.localeCompare(aIngestion);
    });

    const latestCopy = { ...group[0], duplicate_count: group.length } as GroupedWaiver;
    result.push(latestCopy);
  }

  return result;
}

// --- Route handlers ---

async function listWaivers(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const page = Math.max(1, parseInt(qs.page ?? '1', 10) || 1);
  const pageSize = clamp(parseInt(qs.pageSize ?? '20', 10) || 20, 1, 100);

  // Full scan to get all items (DynamoDB doesn't support SQL-style OFFSET)
  const allItems: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(new ScanCommand({
      TableName: TableNames.waivers,
      ExclusiveStartKey: lastKey,
    }));
    if (result.Items) allItems.push(...result.Items);
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  // Apply filters
  let filtered = allItems;

  if (qs.airline) {
    const airline = qs.airline.toUpperCase();
    filtered = filtered.filter((w) => (w.airline_code as string)?.toUpperCase() === airline);
  }
  if (qs.status) {
    filtered = filtered.filter((w) => (w.status as string) === qs.status);
  }
  if (qs.dateFrom) {
    filtered = filtered.filter((w) => (w.effective_date as string) >= qs.dateFrom!);
  }
  if (qs.dateTo) {
    filtered = filtered.filter((w) => (w.expiration_date as string) <= qs.dateTo!);
  }
  if (qs.search) {
    const term = qs.search.toLowerCase();
    filtered = filtered.filter((w) =>
      (w.waiver_code as string)?.toLowerCase().includes(term) ||
      (w.airline_code as string)?.toLowerCase().includes(term) ||
      (w.waiver_title as string)?.toLowerCase().includes(term),
    );
  }
  if (qs.duplicate === 'true') {
    filtered = filtered.filter((w) => w.is_duplicate === true);
  } else if (qs.duplicate === 'false') {
    filtered = filtered.filter((w) => !w.is_duplicate);
  }

  // Sort by created_at descending
  filtered.sort((a, b) => {
    const aDate = (a.created_at as string) ?? '';
    const bDate = (b.created_at as string) ?? '';
    return bDate.localeCompare(aDate);
  });

  // Group by airline_code + waiver_code before pagination
  const grouped = groupWaivers(filtered);

  const totalCount = grouped.length;
  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  const offset = (page - 1) * pageSize;
  const data = grouped.slice(offset, offset + pageSize);

  return json(200, {
    data,
    pagination: { page, pageSize, totalCount, totalPages },
  });
}

async function getWaiverById(id: string): Promise<APIGatewayProxyResult> {
  const result = await docClient.send(new GetCommand({
    TableName: TableNames.waivers,
    Key: { id },
  }));

  if (!result.Item) {
    return errorResponse('NOT_FOUND', `Waiver with ID ${id} not found`, 404);
  }
  return json(200, { data: result.Item });
}

async function getActiveWaivers(): Promise<APIGatewayProxyResult> {
  const cached = cache.get<APIGatewayProxyResult>('waivers:active');
  if (cached) return cached;

  const now = new Date().toISOString();
  const result = await docClient.send(new QueryCommand({
    TableName: TableNames.waivers,
    IndexName: 'status-index',
    KeyConditionExpression: '#s = :status',
    FilterExpression: 'expiration_date > :now',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':status': 'active', ':now': now },
  }));

  const items = result.Items ?? [];
  items.sort((a, b) => {
    const aDate = (a.created_at as string) ?? '';
    const bDate = (b.created_at as string) ?? '';
    return bDate.localeCompare(aDate);
  });

  const activeResult = json(200, { data: items });
  cache.set('waivers:active', activeResult, 15_000);
  return activeResult;
}

async function searchWaivers(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const filters: string[] = [];
  const exprValues: Record<string, unknown> = {};
  const exprNames: Record<string, string> = {};

  if (qs.airline) {
    filters.push('airline_code = :airline');
    exprValues[':airline'] = qs.airline;
  }
  if (qs.dateFrom) {
    filters.push('effective_date >= :dateFrom');
    exprValues[':dateFrom'] = qs.dateFrom;
  }
  if (qs.dateTo) {
    filters.push('expiration_date <= :dateTo');
    exprValues[':dateTo'] = qs.dateTo;
  }
  if (qs.route) {
    filters.push('contains(applicable_routes, :route)');
    exprValues[':route'] = qs.route;
  }
  if (qs.status) {
    filters.push('#s = :status');
    exprNames['#s'] = 'status';
    exprValues[':status'] = qs.status;
  }

  const params: Record<string, unknown> = {
    TableName: TableNames.waivers,
  };
  if (filters.length > 0) {
    (params as any).FilterExpression = filters.join(' AND ');
    (params as any).ExpressionAttributeValues = exprValues;
    if (Object.keys(exprNames).length > 0) {
      (params as any).ExpressionAttributeNames = exprNames;
    }
  }

  const allItems: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(new ScanCommand({
      ...params as any,
      ExclusiveStartKey: lastKey,
    }));
    if (result.Items) allItems.push(...result.Items);
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  allItems.sort((a, b) => {
    const aDate = (a.created_at as string) ?? '';
    const bDate = (b.created_at as string) ?? '';
    return bDate.localeCompare(aDate);
  });

  // Group by airline_code + waiver_code before returning
  const grouped = groupWaivers(allItems);

  return json(200, { data: grouped });
}

async function getGroupCopies(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const airline = qs.airline;
  const waiverCode = qs.waiverCode;

  if (!airline || !waiverCode) {
    return errorResponse('VALIDATION_ERROR', 'Both airline and waiverCode query parameters are required', 400);
  }

  try {
    const result = await docClient.send(new QueryCommand({
      TableName: TableNames.waivers,
      IndexName: 'airline_code-waiver_code-index',
      KeyConditionExpression: 'airline_code = :ac AND waiver_code = :wc',
      ExpressionAttributeValues: {
        ':ac': airline,
        ':wc': waiverCode,
      },
    }));

    const items = result.Items ?? [];

    // Sort by ingestion_timestamp descending
    items.sort((a, b) => {
      const aTs = (a.ingestion_timestamp as string) ?? '';
      const bTs = (b.ingestion_timestamp as string) ?? '';
      return bTs.localeCompare(aTs);
    });

    const data = items.map((item) => ({
      id: item.id,
      ingestion_timestamp: item.ingestion_timestamp,
      source_type: item.source_type,
      status: item.status,
      created_at: item.created_at,
      updated_at: item.updated_at,
    }));

    return json(200, { data });
  } catch (err) {
    console.error('getGroupCopies error:', err);
    return errorResponse('INTERNAL_ERROR', 'Internal server error', 500);
  }
}

async function approveWaiver(id: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const existing = await docClient.send(new GetCommand({
    TableName: TableNames.waivers,
    Key: { id },
  }));

  if (!existing.Item) {
    return errorResponse('NOT_FOUND', `Waiver with ID ${id} not found`, 404);
  }

  const claims = event.requestContext?.authorizer?.claims ?? {};
  const reviewerId = claims.sub ?? claims.email ?? 'unknown';

  await docClient.send(new UpdateCommand({
    TableName: TableNames.waivers,
    Key: { id },
    UpdateExpression: 'SET #s = :status, approval_timestamp = :now, reviewer_id = :reviewer, updated_at = :now',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':status': 'active',
      ':now': new Date().toISOString(),
      ':reviewer': reviewerId,
    },
  }));

  cache.invalidate('waivers:active');
  cache.invalidate('dashboard:metrics');

  // Fire-and-forget webhook
  dispatchWebhook('waiver.approved', { id, status: 'active' }).catch(() => {});

  return json(200, { data: { id, status: 'active' } });
}

async function rejectWaiver(id: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const existing = await docClient.send(new GetCommand({
    TableName: TableNames.waivers,
    Key: { id },
  }));

  if (!existing.Item) {
    return errorResponse('NOT_FOUND', `Waiver with ID ${id} not found`, 404);
  }

  let body: { reason?: string } = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    // ignore parse errors
  }

  const reason = body.reason ?? '';
  const claims = event.requestContext?.authorizer?.claims ?? {};
  const reviewerId = claims.sub ?? claims.email ?? 'unknown';

  await docClient.send(new UpdateCommand({
    TableName: TableNames.waivers,
    Key: { id },
    UpdateExpression: 'SET #s = :status, rejection_reason = :reason, reviewer_id = :reviewer, updated_at = :now',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':status': 'rejected',
      ':reason': reason,
      ':reviewer': reviewerId,
      ':now': new Date().toISOString(),
    },
  }));

  cache.invalidate('waivers:active');
  cache.invalidate('dashboard:metrics');

  // Fire-and-forget webhook
  dispatchWebhook('waiver.rejected', { id, status: 'rejected', rejection_reason: reason }).catch(() => {});

  return json(200, { data: { id, status: 'rejected', rejection_reason: reason } });
}

async function saveDraft(id: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const existing = await docClient.send(new GetCommand({
    TableName: TableNames.waivers,
    Key: { id },
  }));

  if (!existing.Item) {
    return errorResponse('NOT_FOUND', `Waiver with ID ${id} not found`, 404);
  }

  let body: Record<string, unknown> = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    // ignore parse errors
  }

  // Validate release_notes length
  if (body.release_notes !== undefined) {
    const notes = String(body.release_notes);
    if (notes.length > 500) {
      return errorResponse('VALIDATION_ERROR', 'release_notes must not exceed 500 characters', 400);
    }
  }

  // Fetch schema dynamically to determine editable fields
  let editable: string[];
  try {
    const settingsResult = await docClient.send(new GetCommand({
      TableName: TableNames.settings,
      Key: { key: 'extraction_fields' },
    }));
    if (settingsResult.Item && settingsResult.Item.value) {
      const schema: FieldSchema = JSON.parse(settingsResult.Item.value as string);
      editable = schema.map((f) => f.key);
    } else {
      editable = DEFAULT_SCHEMA.map((f) => f.key);
    }
  } catch {
    editable = DEFAULT_SCHEMA.map((f) => f.key);
  }

  const setExprs: string[] = ['updated_at = :now'];
  const exprValues: Record<string, unknown> = { ':now': new Date().toISOString() };
  const exprNames: Record<string, string> = {};
  let idx = 0;

  for (const field of editable) {
    if (body[field] !== undefined) {
      const alias = `:v${idx}`;
      const nameAlias = `#f${idx}`;
      setExprs.push(`${nameAlias} = ${alias}`);
      exprValues[alias] = body[field];
      exprNames[nameAlias] = field;
      idx++;
    }
  }

  if (idx === 0) {
    return json(200, { data: { id, message: 'No fields to update' } });
  }

  await docClient.send(new UpdateCommand({
    TableName: TableNames.waivers,
    Key: { id },
    UpdateExpression: `SET ${setExprs.join(', ')}`,
    ExpressionAttributeValues: exprValues,
    ExpressionAttributeNames: exprNames,
  }));

  // Record corrections by comparing draft edits against the original AI extraction snapshot.
  // This enables few-shot learning: the extraction prompt can include past corrections as examples.
  const aiExtraction = (existing.Item.ai_extraction as Record<string, string>) ?? {};
  if (Object.keys(aiExtraction).length > 0 && TableNames.corrections) {
    const correctedFields: Record<string, { ai: string; human: string }> = {};
    const checkFields = DEFAULT_SCHEMA.map(f => f.key);

    for (const field of checkFields) {
      if (body[field] !== undefined) {
        const aiVal = String(aiExtraction[field] ?? '');
        const humanVal = String(body[field] ?? '');
        if (aiVal !== humanVal && humanVal.trim()) {
          correctedFields[field] = { ai: aiVal, human: humanVal };
        }
      }
    }

    if (Object.keys(correctedFields).length > 0) {
      const correctionId = `corr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      docClient.send(new PutCommand({
        TableName: TableNames.corrections,
        Item: {
          id: correctionId,
          waiver_id: id,
          source_type: String(existing.Item.source_type ?? 'unknown'),
          airline_code: String(existing.Item.airline_code ?? ''),
          corrections: correctedFields,
          created_at: new Date().toISOString(),
        },
      })).catch((err) => console.error('Failed to record corrections:', err));
    }
  }

  return json(200, { data: { id, message: 'Draft saved' } });
}

async function archiveWaiver(id: string): Promise<APIGatewayProxyResult> {
  const existing = await docClient.send(new GetCommand({
    TableName: TableNames.waivers,
    Key: { id },
  }));
  if (!existing.Item) {
    return errorResponse('NOT_FOUND', `Waiver with ID ${id} not found`, 404);
  }

  await docClient.send(new UpdateCommand({
    TableName: TableNames.waivers,
    Key: { id },
    UpdateExpression: 'SET #s = :status, updated_at = :now',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':status': 'archived', ':now': new Date().toISOString() },
  }));

  cache.invalidate('waivers:active');
  cache.invalidate('dashboard:metrics');

  return json(200, { data: { id, status: 'archived' } });
}

async function reinstateWaiver(id: string): Promise<APIGatewayProxyResult> {
  const existing = await docClient.send(new GetCommand({
    TableName: TableNames.waivers,
    Key: { id },
  }));
  if (!existing.Item) {
    return errorResponse('NOT_FOUND', `Waiver with ID ${id} not found`, 404);
  }

  await docClient.send(new UpdateCommand({
    TableName: TableNames.waivers,
    Key: { id },
    UpdateExpression: 'SET #s = :status, updated_at = :now',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':status': 'pending_review', ':now': new Date().toISOString() },
  }));

  cache.invalidate('waivers:active');
  cache.invalidate('dashboard:metrics');

  return json(200, { data: { id, status: 'pending_review' } });
}


/**
 * Record human corrections for few-shot learning.
 * Compares the original AI extraction with the current (human-edited) waiver record.
 * Stores corrections so the extraction prompt can include them as examples.
 */
async function recordCorrections(originalItem: Record<string, unknown>, waiverId: string): Promise<void> {
  if (!TableNames.corrections) return;

  // Re-read the waiver to get the current (human-edited) values
  const current = await docClient.send(new GetCommand({ TableName: TableNames.waivers, Key: { id: waiverId } }));
  if (!current.Item) return;

  const correctedFields: Record<string, { ai: string; human: string }> = {};
  const checkFields = DEFAULT_SCHEMA.map(f => f.key);

  for (const field of checkFields) {
    const aiVal = String(originalItem[field] ?? '');
    const humanVal = String(current.Item[field] ?? '');
    if (aiVal !== humanVal && humanVal.trim()) {
      correctedFields[field] = { ai: aiVal, human: humanVal };
    }
  }

  if (Object.keys(correctedFields).length === 0) return;

  const correctionId = `corr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await docClient.send(new PutCommand({
    TableName: TableNames.corrections,
    Item: {
      id: correctionId,
      waiver_id: waiverId,
      source_type: String(current.Item.source_type ?? 'unknown'),
      airline_code: String(current.Item.airline_code ?? ''),
      corrections: correctedFields,
      created_at: new Date().toISOString(),
    },
  }));

  console.log(`Recorded ${Object.keys(correctedFields).length} correction(s) for waiver ${waiverId}`);
}


async function getDashboardMetrics(): Promise<APIGatewayProxyResult> {
  const cached = cache.get<APIGatewayProxyResult>('dashboard:metrics');
  if (cached) return cached;

  // Scan all waivers
  const allItems: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(new ScanCommand({
      TableName: TableNames.waivers,
      ExclusiveStartKey: lastKey,
    }));
    if (result.Items) allItems.push(...result.Items);
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  let activeCount = 0;
  let todayCount = 0;
  let pendingCount = 0;
  let confidenceSum = 0;
  let confidenceCount = 0;
  const volumeMap: Record<string, number> = {};
  const airlineMap: Record<string, number> = {};
  const recent: Record<string, unknown>[] = [];

  for (const item of allItems) {
    const status = item.status as string;
    if (status === 'active') activeCount++;
    if (status === 'pending_review') pendingCount++;

    const ingestionTs = (item.ingestion_timestamp as string) ?? '';
    const ingestionDate = ingestionTs.split('T')[0];
    if (ingestionDate === today) todayCount++;

    if (item.overall_confidence !== undefined) {
      confidenceSum += item.overall_confidence as number;
      confidenceCount++;
    }

    if (ingestionDate >= thirtyDaysAgo) {
      volumeMap[ingestionDate] = (volumeMap[ingestionDate] ?? 0) + 1;
    }

    const airline = item.airline_code as string;
    if (airline) {
      airlineMap[airline] = (airlineMap[airline] ?? 0) + 1;
    }

    recent.push(item);
  }

  // Sort recent by ingestion_timestamp desc, group, then take top 10
  recent.sort((a, b) => {
    const aTs = (a.ingestion_timestamp as string) ?? '';
    const bTs = (b.ingestion_timestamp as string) ?? '';
    return bTs.localeCompare(aTs);
  });
  const groupedRecent = groupWaivers(recent);
  // Re-sort grouped results by ingestion_timestamp desc
  groupedRecent.sort((a, b) => {
    const aTs = (a.ingestion_timestamp as string) ?? '';
    const bTs = (b.ingestion_timestamp as string) ?? '';
    return bTs.localeCompare(aTs);
  });
  const recentWaivers = groupedRecent.slice(0, 10).map((w) => ({
    id: w.id,
    waiver_code: w.waiver_code,
    airline_code: w.airline_code,
    status: w.status,
    ingestion_timestamp: w.ingestion_timestamp,
    is_duplicate: w.is_duplicate ?? false,
    duplicate_count: w.duplicate_count ?? 1,
  }));

  const ingestionVolume = Object.entries(volumeMap)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const airlineDistribution = Object.entries(airlineMap)
    .map(([airline, count]) => ({ airline, count }))
    .sort((a, b) => b.count - a.count);

  const averageConfidence = confidenceCount > 0
    ? parseFloat((confidenceSum / confidenceCount).toFixed(2))
    : 0;

  const result = json(200, {
    data: {
      activeWaivers: activeCount,
      processedToday: todayCount,
      pendingReview: pendingCount,
      averageConfidence,
      ingestionVolume,
      airlineDistribution,
      recentWaivers,
    },
  });
  cache.set('dashboard:metrics', result, 30_000);
  return result;
}

async function getThreshold(): Promise<APIGatewayProxyResult> {
  const cached = cache.get<APIGatewayProxyResult>('settings:threshold');
  if (cached) return cached;

  const result = await docClient.send(new GetCommand({
    TableName: TableNames.settings,
    Key: { key: 'confidence_threshold' },
  }));

  const value = result.Item ? parseFloat(result.Item.value as string) : 0.85;
  const resp = json(200, { data: { threshold: value } });
  cache.set('settings:threshold', resp, 60_000);
  return resp;
}

async function updateThreshold(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  let body: { threshold?: number } = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    // ignore
  }
  const threshold = body.threshold;
  if (threshold === undefined || typeof threshold !== 'number' || threshold < 0 || threshold > 1) {
    return errorResponse('VALIDATION_ERROR', 'threshold must be a number between 0 and 1', 400);
  }

  await docClient.send(new PutCommand({
    TableName: TableNames.settings,
    Item: {
      key: 'confidence_threshold',
      value: threshold.toString(),
      updated_at: new Date().toISOString(),
    },
  }));

  cache.invalidate('settings:threshold');

  return json(200, { data: { threshold } });
}

async function getWaiverVersions(waiverId: string): Promise<APIGatewayProxyResult> {
  const existing = await docClient.send(new GetCommand({
    TableName: TableNames.waivers,
    Key: { id: waiverId },
  }));

  if (!existing.Item) {
    return errorResponse('NOT_FOUND', `Waiver with ID ${waiverId} not found`, 404);
  }

  const result = await docClient.send(new QueryCommand({
    TableName: TableNames.waiverVersions,
    KeyConditionExpression: 'waiver_id = :wid',
    ExpressionAttributeValues: { ':wid': waiverId },
    ScanIndexForward: false,
  }));

  return json(200, { data: result.Items ?? [] });
}

async function getWaiverSource(waiverId: string): Promise<APIGatewayProxyResult> {
  const existing = await docClient.send(new GetCommand({
    TableName: TableNames.waivers,
    Key: { id: waiverId },
  }));

  if (!existing.Item) {
    return errorResponse('NOT_FOUND', `Waiver with ID ${waiverId} not found`, 404);
  }

  const normalizedKey = existing.Item.normalized_s3_key as string;
  const sourceKey = existing.Item.source_s3_key as string;
  const sourceType = existing.Item.source_type as string;
  const sourceUrl = (existing.Item.source_url as string) ?? '';
  const screenshotKey = (existing.Item.screenshot_s3_key as string) ?? '';

  if (!INGESTION_BUCKET) {
    return json(200, { data: { content: 'Source content not available.', type: 'text', sourceUrl } });
  }

  // If sourceUrl not in DynamoDB, try S3 metadata as fallback
  let resolvedSourceUrl = sourceUrl;
  if (!resolvedSourceUrl && sourceKey) {
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: INGESTION_BUCKET, Key: sourceKey }));
      resolvedSourceUrl = head.Metadata?.['source-url'] ?? '';
    } catch {
      // No metadata available
    }
  }

  // For PDFs and emails, only use normalized text (the raw source is binary/MIME).
  // For web, get both the visible text (.txt) and the HTML separately.
  let content = '';
  let contentType = 'text';
  let s3Key = '';
  let htmlContent = '';

  if (sourceType === 'pdf' || sourceType === 'email') {
    if (normalizedKey) {
      try {
        const resp = await s3.send(new GetObjectCommand({ Bucket: INGESTION_BUCKET, Key: normalizedKey }));
        content = await resp.Body!.transformToString('utf-8');
        contentType = 'text';
        s3Key = normalizedKey;
      } catch { /* not found */ }
    }
  } else {
    // Web: prefer .txt (visible rendered text), fall back to normalized, then HTML
    const textKey = sourceKey ? sourceKey.replace(/\.html$/, '.txt') : '';
    const textKeys = [textKey, normalizedKey].filter(Boolean);
    for (const key of textKeys) {
      try {
        const resp = await s3.send(new GetObjectCommand({ Bucket: INGESTION_BUCKET, Key: key }));
        const text = await resp.Body!.transformToString('utf-8');
        if (text.trim().length > content.trim().length) {
          content = text;
          contentType = 'text';
          s3Key = key;
        }
      } catch { /* try next */ }
    }
    // Also fetch HTML for the Source Page tab
    if (sourceKey) {
      try {
        const resp = await s3.send(new GetObjectCommand({ Bucket: INGESTION_BUCKET, Key: sourceKey }));
        htmlContent = await resp.Body!.transformToString('utf-8');
      } catch { /* no HTML */ }
    }
  }

  if (!content) {
    content = 'Source content could not be retrieved.';
  }

  // Derive screenshot key from source key if not stored in the record
  let resolvedScreenshotKey = screenshotKey;
  if (!resolvedScreenshotKey && sourceKey) {
    resolvedScreenshotKey = sourceKey.replace(/\.html$/, '.png');
  }

  // Generate presigned URL for screenshot if key exists
  let screenshotUrl = '';
  if (resolvedScreenshotKey && INGESTION_BUCKET) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: INGESTION_BUCKET, Key: resolvedScreenshotKey }));
      screenshotUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: INGESTION_BUCKET, Key: resolvedScreenshotKey }),
        { expiresIn: 300 },
      );
    } catch {
      // Try .jpg fallback (browser-capture saves as .jpg)
      if (resolvedScreenshotKey.endsWith('.png')) {
        const jpgKey = resolvedScreenshotKey.replace(/\.png$/, '.jpg');
        try {
          await s3.send(new HeadObjectCommand({ Bucket: INGESTION_BUCKET, Key: jpgKey }));
          resolvedScreenshotKey = jpgKey;
          screenshotUrl = await getSignedUrl(
            s3,
            new GetObjectCommand({ Bucket: INGESTION_BUCKET, Key: jpgKey }),
            { expiresIn: 300 },
          );
        } catch {
          // No screenshot available
        }
      }
    }
  }

  // Generate presigned URL for the source PDF (for inline viewing)
  let pdfUrl = '';
  if (sourceType === 'pdf' && sourceKey && INGESTION_BUCKET) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: INGESTION_BUCKET, Key: sourceKey }));
      pdfUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: INGESTION_BUCKET, Key: sourceKey }),
        { expiresIn: 300 },
      );
    } catch {
      // PDF doesn't exist
    }
  }

  return json(200, {
    data: {
      content,
      type: contentType,
      s3Key,
      sourceUrl: resolvedSourceUrl,
      sourceType,
      screenshotKey: resolvedScreenshotKey || undefined,
      screenshotUrl: screenshotUrl || undefined,
      pdfUrl: pdfUrl || undefined,
      htmlContent: htmlContent || undefined,
    },
  });
}

// --- Extraction Fields Schema ---

async function getExtractionFields(): Promise<APIGatewayProxyResult> {
  try {
    const result = await docClient.send(new GetCommand({
      TableName: TableNames.settings,
      Key: { key: 'extraction_fields' },
    }));

    if (result.Item && result.Item.value) {
      const schema: FieldSchema = JSON.parse(result.Item.value as string);
      schema.sort((a, b) => a.order - b.order);
      return json(200, { data: schema });
    }
  } catch (err) {
    console.warn('Failed to fetch extraction fields from Settings table, returning default:', err);
  }

  return json(200, { data: [...DEFAULT_SCHEMA].sort((a, b) => a.order - b.order) });
}

async function updateExtractionFields(event: APIGatewayProxyEvent, role: Role | null): Promise<APIGatewayProxyResult> {
  if (role !== 'admin') {
    return errorResponse('FORBIDDEN', 'Only admins can update extraction fields', 403);
  }

  let body: unknown;
  try {
    body = event.body ? JSON.parse(event.body) : null;
  } catch {
    return errorResponse('VALIDATION_ERROR', 'Invalid JSON body', 400);
  }

  const validation = validateFieldSchema(body);
  if (!validation.valid) {
    return errorResponse('VALIDATION_ERROR', validation.error, 400);
  }

  const schema = body as FieldSchema;

  await docClient.send(new PutCommand({
    TableName: TableNames.settings,
    Item: {
      key: 'extraction_fields',
      value: JSON.stringify(schema),
      updated_at: new Date().toISOString(),
    },
  }));

  schema.sort((a, b) => a.order - b.order);
  return json(200, { data: schema });
}

// --- Webhook management ---

const VALID_WEBHOOK_EVENTS = ['waiver.created', 'waiver.approved', 'waiver.rejected'];

async function createWebhookSubscription(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  let body: { url?: string; events?: string[] } = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return errorResponse('VALIDATION_ERROR', 'Invalid JSON body', 400);
  }

  if (!body.url || typeof body.url !== 'string') {
    return errorResponse('VALIDATION_ERROR', 'url is required', 400);
  }
  if (!body.events || !Array.isArray(body.events) || body.events.length === 0) {
    return errorResponse('VALIDATION_ERROR', 'events must be a non-empty array', 400);
  }
  const invalid = body.events.filter((e) => !VALID_WEBHOOK_EVENTS.includes(e));
  if (invalid.length > 0) {
    return errorResponse('VALIDATION_ERROR', `Invalid event types: ${invalid.join(', ')}`, 400);
  }

  const id = `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const item = {
    id,
    url: body.url,
    events: body.events,
    active: true,
    created_at: new Date().toISOString(),
  };

  await docClient.send(new PutCommand({
    TableName: TableNames.webhookSubscriptions,
    Item: item,
  }));

  return json(201, { data: item });
}

async function listWebhookSubscriptions(): Promise<APIGatewayProxyResult> {
  const result = await docClient.send(new ScanCommand({
    TableName: TableNames.webhookSubscriptions,
  }));
  return json(200, { data: result.Items ?? [] });
}

async function deleteWebhookSubscription(id: string): Promise<APIGatewayProxyResult> {
  await docClient.send(new DeleteCommand({
    TableName: TableNames.webhookSubscriptions,
    Key: { id },
  }));
  return json(200, { data: { id, deleted: true } });
}

// --- Monitoring Schedules ---

async function listMonitorSchedules(): Promise<APIGatewayProxyResult> {
  const allItems: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await docClient.send(new ScanCommand({
      TableName: TableNames.monitorSchedules,
      FilterExpression: '#s IN (:active, :paused)',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':active': 'active', ':paused': 'paused' },
      ExclusiveStartKey: lastKey,
    }));
    if (result.Items) allItems.push(...result.Items);
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  allItems.sort((a, b) => {
    const aDate = (a.created_at as string) ?? '';
    const bDate = (b.created_at as string) ?? '';
    return bDate.localeCompare(aDate);
  });
  return json(200, { data: allItems });
}

async function updateMonitorSchedule(id: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  let body: { interval_minutes?: number; end_date_time?: string } = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch { /* ignore */ }

  const setExprs: string[] = ['updated_at = :now'];
  const exprValues: Record<string, unknown> = { ':now': new Date().toISOString() };

  if (body.interval_minutes !== undefined) {
    if (typeof body.interval_minutes !== 'number' || body.interval_minutes < 1) {
      return errorResponse('VALIDATION_ERROR', 'interval_minutes must be a positive integer', 400);
    }
    setExprs.push('interval_minutes = :im');
    exprValues[':im'] = body.interval_minutes;
  }
  if (body.end_date_time !== undefined) {
    const endDate = new Date(body.end_date_time);
    if (isNaN(endDate.getTime())) {
      return errorResponse('VALIDATION_ERROR', 'end_date_time must be a valid ISO 8601 datetime', 400);
    }
    setExprs.push('end_date_time = :edt');
    exprValues[':edt'] = endDate.toISOString();
  }
  if (setExprs.length === 1) {
    return errorResponse('VALIDATION_ERROR', 'Provide interval_minutes and/or end_date_time', 400);
  }

  try {
    const result = await docClient.send(new UpdateCommand({
      TableName: TableNames.monitorSchedules,
      Key: { id },
      UpdateExpression: `SET ${setExprs.join(', ')}`,
      ExpressionAttributeValues: exprValues,
      ConditionExpression: 'attribute_exists(id)',
      ReturnValues: 'ALL_NEW',
    }));
    return json(200, { data: result.Attributes });
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      return errorResponse('NOT_FOUND', `Schedule ${id} not found`, 404);
    }
    throw err;
  }
}

async function terminateMonitorSchedule(id: string): Promise<APIGatewayProxyResult> {
  try {
    const result = await docClient.send(new UpdateCommand({
      TableName: TableNames.monitorSchedules,
      Key: { id },
      UpdateExpression: 'SET #s = :status, updated_at = :now',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':status': 'terminated', ':now': new Date().toISOString() },
      ConditionExpression: 'attribute_exists(id)',
      ReturnValues: 'ALL_NEW',
    }));
    return json(200, { data: result.Attributes });
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      return errorResponse('NOT_FOUND', `Schedule ${id} not found`, 404);
    }
    throw err;
  }
}

// --- Notification Recipients ---

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function getNotificationRecipients(): Promise<APIGatewayProxyResult> {
  try {
    const result = await docClient.send(new GetCommand({
      TableName: TableNames.settings,
      Key: { key: 'notification_recipients' },
    }));
    if (result.Item?.value) {
      const recipients = JSON.parse(result.Item.value as string);
      return json(200, { data: { recipients } });
    }
  } catch (err) {
    console.warn('Failed to read notification recipients:', err);
  }
  return json(200, { data: { recipients: [] } });
}

async function updateNotificationRecipients(event: APIGatewayProxyEvent, role: Role | null): Promise<APIGatewayProxyResult> {
  if (role !== 'admin') {
    return errorResponse('FORBIDDEN', 'Only admins can update notification recipients', 403);
  }

  let body: { recipients?: unknown } = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return errorResponse('VALIDATION_ERROR', 'Invalid JSON body', 400);
  }

  if (!Array.isArray(body.recipients)) {
    return errorResponse('VALIDATION_ERROR', 'recipients must be an array', 400);
  }

  const recipients = body.recipients as unknown[];

  if (recipients.length > 20) {
    return errorResponse('VALIDATION_ERROR', 'Maximum 20 recipients allowed', 400);
  }

  for (const email of recipients) {
    if (typeof email !== 'string' || !EMAIL_REGEX.test(email)) {
      return errorResponse('VALIDATION_ERROR', `Invalid email address: ${email}`, 400);
    }
  }

  await docClient.send(new PutCommand({
    TableName: TableNames.settings,
    Item: {
      key: 'notification_recipients',
      value: JSON.stringify(recipients),
      updated_at: new Date().toISOString(),
    },
  }));

  return json(200, { data: { recipients } });
}

// --- API Key Management ---

async function createApiKey(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  let body: { name?: string } = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return errorResponse('VALIDATION_ERROR', 'Invalid JSON body', 400);
  }

  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return errorResponse('VALIDATION_ERROR', 'name is required', 400);
  }

  try {
    const createResult = await apigw.send(new CreateApiKeyCommand({
      name: body.name.trim(),
      enabled: true,
    }));

    const keyId = createResult.id!;
    const keyValue = createResult.value!;

    if (USAGE_PLAN_ID) {
      await apigw.send(new CreateUsagePlanKeyCommand({
        usagePlanId: USAGE_PLAN_ID,
        keyId,
        keyType: 'API_KEY',
      }));
    }

    const now = new Date().toISOString();
    await docClient.send(new PutCommand({
      TableName: TableNames.settings,
      Item: {
        key: `apikey#${keyId}`,
        name: body.name.trim(),
        apiGatewayKeyId: keyId,
        active: true,
        createdAt: now,
        usagePlanId: USAGE_PLAN_ID,
      },
    }));

    return json(200, { data: { keyId, name: body.name.trim(), value: keyValue, createdAt: now } });
  } catch (err) {
    console.error('Failed to create API key:', err);
    return errorResponse('INTERNAL_ERROR', 'Failed to create API key', 500);
  }
}

async function revokeApiKey(keyId: string): Promise<APIGatewayProxyResult> {
  const existing = await docClient.send(new GetCommand({
    TableName: TableNames.settings,
    Key: { key: `apikey#${keyId}` },
  }));

  if (!existing.Item) {
    return errorResponse('NOT_FOUND', `API key ${keyId} not found`, 404);
  }

  try {
    await apigw.send(new DeleteApiKeyCommand({ apiKey: keyId }));
  } catch (err) {
    console.error('Failed to delete API Gateway key:', err);
  }

  await docClient.send(new UpdateCommand({
    TableName: TableNames.settings,
    Key: { key: `apikey#${keyId}` },
    UpdateExpression: 'SET active = :inactive',
    ExpressionAttributeValues: { ':inactive': false },
  }));

  return json(200, { data: { keyId, deleted: true } });
}

async function listApiKeys(): Promise<APIGatewayProxyResult> {
  const allItems: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(new ScanCommand({
      TableName: TableNames.settings,
      FilterExpression: 'begins_with(#k, :prefix)',
      ExpressionAttributeNames: { '#k': 'key' },
      ExpressionAttributeValues: { ':prefix': 'apikey#' },
      ExclusiveStartKey: lastKey,
    }));
    if (result.Items) allItems.push(...result.Items);
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  // Fetch usage data for active keys
  const now = new Date();
  const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  for (const item of allItems) {
    if (item.active && USAGE_PLAN_ID && REST_API_ID) {
      try {
        const usage = await apigw.send(new GetUsageCommand({
          usagePlanId: USAGE_PLAN_ID,
          keyId: item.apiGatewayKeyId as string,
          startDate,
          endDate: startDate,
        }));
        const values = usage.items?.[item.apiGatewayKeyId as string];
        item.usageCount = values?.[0]?.[0] ?? 0;
      } catch {
        item.usageCount = 0;
      }
    } else {
      item.usageCount = 0;
    }
  }

  return json(200, { data: allItems });
}

// --- User Management ---

interface UserRecord {
  username: string;
  email: string;
  role: 'admin' | 'user';
  status: string;
  enabled: boolean;
  createdAt: string;
}

async function listUsers(): Promise<APIGatewayProxyResult> {
  try {
    const allUsers: UserRecord[] = [];
    let paginationToken: string | undefined;

    do {
      const result = await cognitoClient.send(new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        PaginationToken: paginationToken,
      }));

      for (const user of result.Users ?? []) {
        const emailAttr = user.Attributes?.find(a => a.Name === 'email');
        const email = emailAttr?.Value ?? user.Username ?? '';

        // Get user's groups to determine role
        let role: 'admin' | 'user' = 'user';
        try {
          const groupsResult = await cognitoClient.send(new AdminListGroupsForUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: user.Username!,
          }));
          const groupNames = (groupsResult.Groups ?? []).map(g => g.GroupName?.toLowerCase());
          if (groupNames.includes('admin')) {
            role = 'admin';
          }
        } catch {
          // Default to 'user' if groups can't be fetched
        }

        allUsers.push({
          username: user.Username ?? '',
          email,
          role,
          status: user.UserStatus ?? 'UNKNOWN',
          enabled: user.Enabled ?? false,
          createdAt: user.UserCreateDate?.toISOString() ?? '',
        });
      }

      paginationToken = result.PaginationToken;
    } while (paginationToken);

    return json(200, { data: allUsers });
  } catch (err) {
    console.error('listUsers error:', err);
    return errorResponse('INTERNAL_ERROR', 'Internal server error', 500);
  }
}

async function createUser(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  let body: { email?: string; role?: string } = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return errorResponse('VALIDATION_ERROR', 'Invalid JSON body', 400);
  }

  if (!body.email || typeof body.email !== 'string' || !EMAIL_REGEX.test(body.email)) {
    return errorResponse('VALIDATION_ERROR', 'Invalid email format', 400);
  }
  if (!body.role || (body.role !== 'admin' && body.role !== 'user')) {
    return errorResponse('VALIDATION_ERROR', 'Role is required (admin or user)', 400);
  }

  try {
    const createResult = await cognitoClient.send(new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: body.email,
      UserAttributes: [
        { Name: 'email', Value: body.email },
        { Name: 'email_verified', Value: 'true' },
      ],
      DesiredDeliveryMediums: ['EMAIL'],
    }));

    await cognitoClient.send(new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: body.email,
      GroupName: body.role,
    }));

    const user = createResult.User;
    return json(201, {
      data: {
        username: user?.Username ?? body.email,
        email: body.email,
        role: body.role,
        status: user?.UserStatus ?? 'FORCE_CHANGE_PASSWORD',
        enabled: user?.Enabled ?? true,
        createdAt: user?.UserCreateDate?.toISOString() ?? new Date().toISOString(),
      },
    });
  } catch (err: any) {
    if (err.name === 'UsernameExistsException') {
      return errorResponse('CONFLICT', 'User with this email already exists', 409);
    }
    console.error('createUser error:', err);
    return errorResponse('INTERNAL_ERROR', 'Internal server error', 500);
  }
}

async function changeUserRole(username: string, event: APIGatewayProxyEvent, callerEmail: string): Promise<APIGatewayProxyResult> {
  if (username === callerEmail) {
    return errorResponse('SELF_ACTION', 'Cannot change role for your own account', 400);
  }

  let body: { role?: string } = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return errorResponse('VALIDATION_ERROR', 'Invalid JSON body', 400);
  }

  if (!body.role || (body.role !== 'admin' && body.role !== 'user')) {
    return errorResponse('VALIDATION_ERROR', 'Role is required (admin or user)', 400);
  }

  try {
    // Find current group
    const groupsResult = await cognitoClient.send(new AdminListGroupsForUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
    }));

    const currentGroups = (groupsResult.Groups ?? []).map(g => g.GroupName).filter(Boolean) as string[];

    // Remove from current groups
    for (const group of currentGroups) {
      await cognitoClient.send(new AdminRemoveUserFromGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        GroupName: group,
      }));
    }

    // Add to new group
    await cognitoClient.send(new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      GroupName: body.role,
    }));

    return json(200, { data: { username, role: body.role } });
  } catch (err: any) {
    if (err.name === 'UserNotFoundException') {
      return errorResponse('NOT_FOUND', 'User not found', 404);
    }
    console.error('changeUserRole error:', err);
    return errorResponse('INTERNAL_ERROR', 'Internal server error', 500);
  }
}

async function disableUser(username: string, callerEmail: string): Promise<APIGatewayProxyResult> {
  if (username === callerEmail) {
    return errorResponse('SELF_ACTION', 'Cannot disable your own account', 400);
  }

  try {
    await cognitoClient.send(new AdminDisableUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
    }));
    return json(200, { data: { username, enabled: false } });
  } catch (err: any) {
    if (err.name === 'UserNotFoundException') {
      return errorResponse('NOT_FOUND', 'User not found', 404);
    }
    console.error('disableUser error:', err);
    return errorResponse('INTERNAL_ERROR', 'Internal server error', 500);
  }
}

async function enableUser(username: string): Promise<APIGatewayProxyResult> {
  try {
    await cognitoClient.send(new AdminEnableUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
    }));
    return json(200, { data: { username, enabled: true } });
  } catch (err: any) {
    if (err.name === 'UserNotFoundException') {
      return errorResponse('NOT_FOUND', 'User not found', 404);
    }
    console.error('enableUser error:', err);
    return errorResponse('INTERNAL_ERROR', 'Internal server error', 500);
  }
}

async function deleteUser(username: string, callerEmail: string): Promise<APIGatewayProxyResult> {
  if (username === callerEmail) {
    return errorResponse('SELF_ACTION', 'Cannot delete your own account', 400);
  }

  try {
    await cognitoClient.send(new AdminDeleteUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
    }));
    return json(200, { data: { username, deleted: true } });
  } catch (err: any) {
    if (err.name === 'UserNotFoundException') {
      return errorResponse('NOT_FOUND', 'User not found', 404);
    }
    console.error('deleteUser error:', err);
    return errorResponse('INTERNAL_ERROR', 'Internal server error', 500);
  }
}

// --- Registration Request Management ---

async function listRegistrationRequests(): Promise<APIGatewayProxyResult> {
  const allItems: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(new ScanCommand({
      TableName: TableNames.settings,
      FilterExpression: 'begins_with(#k, :prefix) AND #s = :pending',
      ExpressionAttributeNames: { '#k': 'key', '#s': 'status' },
      ExpressionAttributeValues: { ':prefix': 'REG#', ':pending': 'pending' },
      ExclusiveStartKey: lastKey,
    }));
    if (result.Items) allItems.push(...result.Items);
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  allItems.sort((a, b) => {
    const aDate = (a.createdAt as string) ?? '';
    const bDate = (b.createdAt as string) ?? '';
    return bDate.localeCompare(aDate);
  });

  return json(200, { data: allItems });
}

async function approveRegistrationRequest(id: string): Promise<APIGatewayProxyResult> {
  const result = await docClient.send(new GetCommand({
    TableName: TableNames.settings,
    Key: { key: `REG#${id}` },
  }));

  if (!result.Item) {
    return errorResponse('NOT_FOUND', `Registration request ${id} not found`, 404);
  }

  if (result.Item.status !== 'pending') {
    return errorResponse('INVALID_STATUS', 'Request is not in pending status', 400);
  }

  const email = result.Item.email as string;

  try {
    await cognitoClient.send(new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
      ],
      DesiredDeliveryMediums: ['EMAIL'],
    }));

    await cognitoClient.send(new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      GroupName: 'user',
    }));
  } catch (err) {
    console.error('Failed to create Cognito user for registration approval:', err);
    return errorResponse('INTERNAL_ERROR', 'Failed to create user account', 500);
  }

  await docClient.send(new UpdateCommand({
    TableName: TableNames.settings,
    Key: { key: `REG#${id}` },
    UpdateExpression: 'SET #s = :status',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':status': 'approved' },
  }));

  return json(200, { data: { id, status: 'approved' } });
}

async function rejectRegistrationRequest(id: string): Promise<APIGatewayProxyResult> {
  const result = await docClient.send(new GetCommand({
    TableName: TableNames.settings,
    Key: { key: `REG#${id}` },
  }));

  if (!result.Item) {
    return errorResponse('NOT_FOUND', `Registration request ${id} not found`, 404);
  }

  if (result.Item.status !== 'pending') {
    return errorResponse('INVALID_STATUS', 'Request is not in pending status', 400);
  }

  await docClient.send(new UpdateCommand({
    TableName: TableNames.settings,
    Key: { key: `REG#${id}` },
    UpdateExpression: 'SET #s = :status',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':status': 'rejected' },
  }));

  return json(200, { data: { id, status: 'rejected' } });
}

// --- Router ---

function extractPathSegments(event: APIGatewayProxyEvent): string[] {
  const path = event.path || event.resource || '';
  return path.split('/').filter(Boolean);
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod?.toUpperCase() ?? '';
  const path = event.path || event.resource || '';
  const segments = extractPathSegments(event);

  // RBAC check
  const role = extractRole(event);
  if (!role) {
    return errorResponse('FORBIDDEN', 'Forbidden: no valid role assigned', 403);
  }
  if (!isAuthorized(role, method, path)) {
    return errorResponse('FORBIDDEN', 'Forbidden: insufficient permissions', 403);
  }

  try {
    // GET /v1/dashboard/metrics
    if (method === 'GET' && segments[1] === 'dashboard' && segments[2] === 'metrics') {
      return await getDashboardMetrics();
    }

    // /v1/waivers/...
    if (segments[1] === 'waivers') {
      if (method === 'GET' && segments[2] === 'active') {
        return await getActiveWaivers();
      }
      if (method === 'GET' && segments[2] === 'search') {
        return await searchWaivers(event);
      }
      // GET /v1/waivers/group — must be before {id} route
      if (method === 'GET' && segments[2] === 'group' && !segments[3]) {
        return await getGroupCopies(event);
      }
      // Sub-resource routes must be checked before the single-item route
      if (method === 'GET' && segments[2] && segments[3] === 'versions') {
        const id = event.pathParameters?.id ?? segments[2];
        return await getWaiverVersions(id);
      }
      if (method === 'GET' && segments[2] && segments[3] === 'source') {
        const id = event.pathParameters?.id ?? segments[2];
        return await getWaiverSource(id);
      }
      if (method === 'GET' && segments[2] && !segments[3]) {
        const id = event.pathParameters?.id ?? segments[2];
        return await getWaiverById(id);
      }
      if (method === 'GET' && !segments[2]) {
        return await listWaivers(event);
      }
      if (method === 'POST' && segments[3] === 'approve') {
        const id = event.pathParameters?.id ?? segments[2];
        return await approveWaiver(id, event);
      }
      if (method === 'POST' && segments[3] === 'reject') {
        const id = event.pathParameters?.id ?? segments[2];
        return await rejectWaiver(id, event);
      }
      if (method === 'PUT' && segments[3] === 'draft') {
        const id = event.pathParameters?.id ?? segments[2];
        return await saveDraft(id, event);
      }
      if (method === 'POST' && segments[3] === 'archive') {
        const id = event.pathParameters?.id ?? segments[2];
        return await archiveWaiver(id);
      }
      if (method === 'POST' && segments[3] === 'reinstate') {
        const id = event.pathParameters?.id ?? segments[2];
        return await reinstateWaiver(id);
      }
    }

    // GET /v1/settings/threshold
    if (method === 'GET' && segments[1] === 'settings' && segments[2] === 'threshold') {
      return await getThreshold();
    }

    // PUT /v1/settings/threshold
    if (method === 'PUT' && segments[1] === 'settings' && segments[2] === 'threshold') {
      if (role !== 'admin') {
        return errorResponse('FORBIDDEN', 'Only admins can update settings', 403);
      }
      return await updateThreshold(event);
    }

    // GET /v1/settings/extraction-fields
    if (method === 'GET' && segments[1] === 'settings' && segments[2] === 'extraction-fields') {
      return await getExtractionFields();
    }

    // PUT /v1/settings/extraction-fields
    if (method === 'PUT' && segments[1] === 'settings' && segments[2] === 'extraction-fields') {
      return await updateExtractionFields(event, role);
    }

    // POST /v1/settings/api-keys
    if (method === 'POST' && segments[1] === 'settings' && segments[2] === 'api-keys' && !segments[3]) {
      if (role !== 'admin') {
        return errorResponse('FORBIDDEN', 'Only admins can manage API keys', 403);
      }
      return await createApiKey(event);
    }
    // DELETE /v1/settings/api-keys/{keyId}
    if (method === 'DELETE' && segments[1] === 'settings' && segments[2] === 'api-keys' && segments[3]) {
      if (role !== 'admin') {
        return errorResponse('FORBIDDEN', 'Only admins can manage API keys', 403);
      }
      return await revokeApiKey(segments[3]);
    }
    // GET /v1/settings/api-keys
    if (method === 'GET' && segments[1] === 'settings' && segments[2] === 'api-keys' && !segments[3]) {
      if (role !== 'admin') {
        return errorResponse('FORBIDDEN', 'Only admins can manage API keys', 403);
      }
      return await listApiKeys();
    }

    // GET /v1/settings/notification-recipients
    if (method === 'GET' && segments[1] === 'settings' && segments[2] === 'notification-recipients') {
      return await getNotificationRecipients();
    }
    // PUT /v1/settings/notification-recipients
    if (method === 'PUT' && segments[1] === 'settings' && segments[2] === 'notification-recipients') {
      return await updateNotificationRecipients(event, role);
    }

    // POST /v1/webhooks
    if (method === 'POST' && segments[1] === 'webhooks' && !segments[2]) {
      return await createWebhookSubscription(event);
    }
    // GET /v1/webhooks
    if (method === 'GET' && segments[1] === 'webhooks' && !segments[2]) {
      return await listWebhookSubscriptions();
    }
    // DELETE /v1/webhooks/{id}
    if (method === 'DELETE' && segments[1] === 'webhooks' && segments[2]) {
      const id = event.pathParameters?.id ?? segments[2];
      return await deleteWebhookSubscription(id);
    }

    // --- Monitoring schedules ---
    // GET /v1/monitoring/schedules
    if (method === 'GET' && segments[1] === 'monitoring' && segments[2] === 'schedules' && !segments[3]) {
      return await listMonitorSchedules();
    }
    // PUT /v1/monitoring/schedules/{id}
    if (method === 'PUT' && segments[1] === 'monitoring' && segments[2] === 'schedules' && segments[3]) {
      return await updateMonitorSchedule(segments[3], event);
    }
    // DELETE /v1/monitoring/schedules/{id}
    if (method === 'DELETE' && segments[1] === 'monitoring' && segments[2] === 'schedules' && segments[3]) {
      return await terminateMonitorSchedule(segments[3]);
    }

    // --- User management routes (admin-only) ---
    if (segments[1] === 'users') {
      if (role !== 'admin') {
        return errorResponse('FORBIDDEN', 'Forbidden: insufficient permissions', 403);
      }
      const callerEmail = event.requestContext?.authorizer?.claims?.email ?? '';

      // GET /v1/users
      if (method === 'GET' && !segments[2]) {
        return await listUsers();
      }
      // POST /v1/users
      if (method === 'POST' && !segments[2]) {
        return await createUser(event);
      }
      // PUT /v1/users/{username}/role
      if (method === 'PUT' && segments[2] && segments[3] === 'role') {
        const username = decodeURIComponent(event.pathParameters?.username ?? segments[2]);
        return await changeUserRole(username, event, callerEmail);
      }
      // POST /v1/users/{username}/disable
      if (method === 'POST' && segments[2] && segments[3] === 'disable') {
        const username = decodeURIComponent(event.pathParameters?.username ?? segments[2]);
        return await disableUser(username, callerEmail);
      }
      // POST /v1/users/{username}/enable
      if (method === 'POST' && segments[2] && segments[3] === 'enable') {
        const username = decodeURIComponent(event.pathParameters?.username ?? segments[2]);
        return await enableUser(username);
      }
      // DELETE /v1/users/{username}
      if (method === 'DELETE' && segments[2] && !segments[3]) {
        const username = decodeURIComponent(event.pathParameters?.username ?? segments[2]);
        return await deleteUser(username, callerEmail);
      }
    }

    // --- Registration request management routes (admin-only) ---
    if (segments[1] === 'registration-requests') {
      if (role !== 'admin') {
        return errorResponse('FORBIDDEN', 'Forbidden: insufficient permissions', 403);
      }

      // GET /v1/registration-requests
      if (method === 'GET' && !segments[2]) {
        return await listRegistrationRequests();
      }
      // POST /v1/registration-requests/{id}/approve
      if (method === 'POST' && segments[2] && segments[3] === 'approve') {
        return await approveRegistrationRequest(segments[2]);
      }
      // POST /v1/registration-requests/{id}/reject
      if (method === 'POST' && segments[2] && segments[3] === 'reject') {
        return await rejectRegistrationRequest(segments[2]);
      }
    }

    return errorResponse('NOT_FOUND', `Route ${method} ${path} not found`, 404);
  } catch (err) {
    console.error('API handler error:', err);
    return errorResponse('INTERNAL_ERROR', 'Internal server error', 500);
  }
}