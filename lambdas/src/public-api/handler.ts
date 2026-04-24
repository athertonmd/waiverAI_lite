import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { docClient, TableNames } from '../shared/db';
import { GetCommand, PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { redactWaiver, redactWaivers } from './redact';
import { getOpenApiSpec } from './openapi-spec';

const ses = new SESClient({});
const s3 = new S3Client({});
const NOTIFICATION_SENDER = process.env.NOTIFICATION_SENDER ?? '';
const INGESTION_BUCKET = process.env.INGESTION_BUCKET ?? '';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(statusCode: number, body: unknown): APIGatewayProxyResult {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

function errorResponse(code: string, message: string, statusCode = 400): APIGatewayProxyResult {
  return json(statusCode, { error: { code, message } });
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function extractPathSegments(event: APIGatewayProxyEvent): string[] {
  const path = event.path || event.resource || '';
  return path.split('/').filter(Boolean);
}

// --- Route handlers ---

async function listActiveWaivers(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const page = Math.max(1, parseInt(qs.page ?? '1', 10) || 1);
  const pageSize = clamp(parseInt(qs.pageSize ?? '20', 10) || 20, 1, 100);

  const now = new Date().toISOString();
  const allItems: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(new QueryCommand({
      TableName: TableNames.waivers,
      IndexName: 'status-index',
      KeyConditionExpression: '#s = :status',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':status': 'active' },
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

  // Apply search and airline filters
  let filtered = allItems;
  if (qs.airline) {
    const airline = qs.airline.toUpperCase();
    filtered = filtered.filter((w) => (w.airline_code as string)?.toUpperCase() === airline);
  }
  if (qs.search) {
    const term = qs.search.toLowerCase();
    filtered = filtered.filter((w) =>
      (w.waiver_code as string)?.toLowerCase().includes(term) ||
      (w.airline_code as string)?.toLowerCase().includes(term) ||
      (w.waiver_title as string)?.toLowerCase().includes(term) ||
      ((w.airports ?? w.applicable_routes) as string[] | undefined)?.some((a) => a.toLowerCase().includes(term)),
    );
  }

  const totalCount = filtered.length;
  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  const offset = (page - 1) * pageSize;
  const data = redactWaivers(filtered.slice(offset, offset + pageSize));

  return json(200, { data, pagination: { page, pageSize, totalCount, totalPages } });
}

async function getWaiverById(id: string): Promise<APIGatewayProxyResult> {
  const result = await docClient.send(new GetCommand({
    TableName: TableNames.waivers,
    Key: { id },
  }));

  if (!result.Item || result.Item.status !== 'active') {
    return errorResponse('NOT_FOUND', 'Waiver not found', 404);
  }

  return json(200, { data: redactWaiver(result.Item) });
}

async function searchWaivers(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const now = new Date().toISOString();

  // Query active waivers using status-index, then apply additional filters in-memory
  const allItems: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(new QueryCommand({
      TableName: TableNames.waivers,
      IndexName: 'status-index',
      KeyConditionExpression: '#s = :status',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':status': 'active' },
      ExclusiveStartKey: lastKey,
    }));
    if (result.Items) allItems.push(...result.Items);
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  let filtered = allItems;

  if (qs.airline) {
    const airline = qs.airline.toUpperCase();
    filtered = filtered.filter((w) => (w.airline_code as string)?.toUpperCase() === airline);
  }
  if (qs.dateFrom) {
    filtered = filtered.filter((w) => (w.expiration_date as string) >= qs.dateFrom!);
  }
  if (qs.dateTo) {
    filtered = filtered.filter((w) => (w.effective_date as string) <= qs.dateTo!);
  }
  if (qs.route) {
    filtered = filtered.filter((w) => {
      const airports = (w.airports ?? w.applicable_routes) as string[] | undefined;
      return airports?.some(a => a.toUpperCase() === qs.route!.toUpperCase()) ?? false;
    });
  }
  if (qs.airport) {
    filtered = filtered.filter((w) => {
      const airports = (w.airports ?? w.applicable_routes) as string[] | undefined;
      return airports?.some(a => a.toUpperCase() === qs.airport!.toUpperCase()) ?? false;
    });
  }
  if (qs.search) {
    const term = qs.search.toLowerCase();
    filtered = filtered.filter((w) =>
      (w.waiver_code as string)?.toLowerCase().includes(term) ||
      (w.airline_code as string)?.toLowerCase().includes(term) ||
      (w.waiver_title as string)?.toLowerCase().includes(term) ||
      ((w.airports ?? w.applicable_routes) as string[] | undefined)?.some((a) => a.toLowerCase().includes(term)),
    );
  }

  filtered.sort((a, b) => {
    const aDate = (a.created_at as string) ?? '';
    const bDate = (b.created_at as string) ?? '';
    return bDate.localeCompare(aDate);
  });

  return json(200, { data: redactWaivers(filtered) });
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function registerRequest(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  let body: { name?: string; email?: string; company?: string };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return errorResponse('INVALID_BODY', 'Request body must be valid JSON');
  }

  const name = body.name?.trim();
  const email = body.email?.trim();
  const company = body.company?.trim();

  if (!name || !email || !company) {
    return errorResponse('VALIDATION_ERROR', 'name, email, and company are required');
  }
  if (!EMAIL_REGEX.test(email)) {
    return errorResponse('VALIDATION_ERROR', 'Invalid email format');
  }

  // Check for duplicate pending registration
  const scanResult = await docClient.send(new ScanCommand({
    TableName: TableNames.settings,
    FilterExpression: 'begins_with(#k, :prefix) AND #email = :email AND #status = :pending',
    ExpressionAttributeNames: { '#k': 'key', '#email': 'email', '#status': 'status' },
    ExpressionAttributeValues: { ':prefix': 'REG#', ':email': email, ':pending': 'pending' },
  }));

  if (scanResult.Items && scanResult.Items.length > 0) {
    return errorResponse('DUPLICATE_REQUEST', 'A registration request is already pending for this email.', 409);
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await docClient.send(new PutCommand({
    TableName: TableNames.settings,
    Item: {
      key: `REG#${id}`,
      id,
      name,
      email,
      company,
      status: 'pending',
      createdAt,
    },
  }));

  // Notify admin users about the new access request (fire-and-forget)
  notifyAdminsOfAccessRequest(name, email, company).catch((err) =>
    console.error('Failed to send access request notification:', err),
  );

  return json(201, { data: { id, status: 'pending' } });
}

async function notifyAdminsOfAccessRequest(name: string, email: string, company: string): Promise<void> {
  if (!NOTIFICATION_SENDER || !TableNames.settings) return;

  let recipients: string[] = [];
  try {
    const result = await docClient.send(new GetCommand({
      TableName: TableNames.settings,
      Key: { key: 'notification_recipients' },
    }));
    if (result.Item?.value) {
      recipients = JSON.parse(result.Item.value as string);
    }
  } catch {
    return;
  }

  if (!Array.isArray(recipients) || recipients.length === 0) return;

  const body = [
    'A new access request has been submitted to Waiver Hub.',
    '',
    `Name: ${name}`,
    `Email: ${email}`,
    `Company: ${company}`,
    `Submitted: ${new Date().toISOString()}`,
    '',
    'Please review this request in the Users section of the application.',
  ].join('\n');

  await ses.send(new SendEmailCommand({
    Source: NOTIFICATION_SENDER,
    Destination: { ToAddresses: recipients },
    Message: {
      Subject: { Data: `New Access Request — ${name} (${company})` },
      Body: { Text: { Data: body } },
    },
  }));
}

// --- Public source content ---

async function getWaiverSource(id: string): Promise<APIGatewayProxyResult> {
  const result = await docClient.send(new GetCommand({
    TableName: TableNames.waivers,
    Key: { id },
  }));

  if (!result.Item || result.Item.status !== 'active') {
    return errorResponse('NOT_FOUND', 'Waiver not found', 404);
  }

  if (!INGESTION_BUCKET) {
    return json(200, { data: { content: 'Source content not available.', type: 'text' } });
  }

  const normalizedKey = result.Item.normalized_s3_key as string;
  const sourceKey = result.Item.source_s3_key as string;
  const sourceType = result.Item.source_type as string;

  let content = '';
  const keysToTry = [normalizedKey, sourceKey].filter(Boolean);
  for (const key of keysToTry) {
    try {
      const resp = await s3.send(new GetObjectCommand({ Bucket: INGESTION_BUCKET, Key: key }));
      content = await resp.Body!.transformToString('utf-8');
      if (content.trim()) break;
    } catch { /* try next */ }
  }

  if (!content) content = 'Source content could not be retrieved.';

  return json(200, { data: { content, type: 'text', sourceType } });
}

// --- Router ---

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod?.toUpperCase() ?? '';
  const segments = extractPathSegments(event);

  // Handle OPTIONS preflight
  if (method === 'OPTIONS') {
    return json(200, {});
  }

  try {
    // POST /v1/register
    if (segments[0] === 'v1' && segments[1] === 'register' && method === 'POST' && !segments[2]) {
      return await registerRequest(event);
    }

    // segments: ['v1', 'public', ...]
    if (segments[0] === 'v1' && segments[1] === 'public') {
      // GET /v1/public/docs
      if (method === 'GET' && segments[2] === 'docs' && !segments[3]) {
        return json(200, getOpenApiSpec());
      }

      // /v1/public/waivers/...
      if (segments[2] === 'waivers') {
        if (method === 'GET' && segments[3] === 'search') {
          return await searchWaivers(event);
        }
        if (method === 'GET' && segments[3] && segments[4] === 'source') {
          const wid = event.pathParameters?.id ?? segments[3];
          return await getWaiverSource(wid);
        }
        if (method === 'GET' && segments[3] && segments[3] !== 'search') {
          const wid = event.pathParameters?.id ?? segments[3];
          return await getWaiverById(wid);
        }
        if (method === 'GET' && !segments[3]) {
          return await listActiveWaivers(event);
        }
      }
    }

    return errorResponse('NOT_FOUND', 'Route not found', 404);
  } catch (err) {
    console.error('Public API handler error:', err);
    return errorResponse('INTERNAL_ERROR', 'Internal server error', 500);
  }
}
