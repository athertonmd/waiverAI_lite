import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { computeUrlHash } from '../web-fetcher/handler';

const s3 = new S3Client({});
const BUCKET = process.env.INGESTION_BUCKET!;

export interface CapturePayload {
  url: string;
  text: string;
  html: string;
  screenshot?: string;
}

export interface CaptureResult {
  s3Key: string;
  textS3Key: string;
  screenshotS3Key: string;
  urlHash: string;
  timestamp: string;
}

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': '*',
};

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      return errorResponse(400, 'MISSING_BODY', 'Request body is required');
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(event.body);
    } catch {
      return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON');
    }

    if (!body.url || typeof body.url !== 'string') {
      return errorResponse(400, 'MISSING_URL', 'url is required and must be a string');
    }

    let parsed: URL;
    try {
      parsed = new URL(body.url);
    } catch {
      return errorResponse(400, 'INVALID_URL', 'url must be a valid HTTP or HTTPS URL');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return errorResponse(400, 'INVALID_URL', 'url must be a valid HTTP or HTTPS URL');
    }

    if (!body.text || typeof body.text !== 'string') {
      return errorResponse(400, 'MISSING_TEXT', 'text is required and must be a string');
    }

    if ((body.text as string).length === 0) {
      return errorResponse(400, 'EMPTY_TEXT', 'text must not be empty');
    }

    if (!body.html || typeof body.html !== 'string') {
      return errorResponse(400, 'MISSING_HTML', 'html is required and must be a string');
    }

    const url = body.url as string;
    const text = body.text as string;
    const html = body.html as string;
    const screenshot = typeof body.screenshot === 'string' ? body.screenshot : undefined;

    const urlHash = computeUrlHash(url);
    const timestamp = new Date().toISOString();
    const baseKey = `raw/web/${urlHash}/${timestamp}`;

    const htmlKey = `${baseKey}.html`;
    const textKey = `${baseKey}.txt`;
    const screenshotKey = `${baseKey}.png`;

    const uploads: Promise<unknown>[] = [
      s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: htmlKey,
        Body: html,
        ContentType: 'text/html',
        Metadata: { 'source-url': url, 'render-method': 'browser-capture' },
      })),
      s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: textKey,
        Body: text,
        ContentType: 'text/plain',
        Metadata: { 'source-url': url, 'render-method': 'browser-capture' },
      })),
    ];

    if (screenshot) {
      const screenshotBuffer = Buffer.from(screenshot, 'base64');
      uploads.push(s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: screenshotKey,
        Body: screenshotBuffer,
        ContentType: 'image/png',
        Metadata: { 'source-url': url },
      })));
    }

    await Promise.all(uploads);

    const result: CaptureResult = {
      s3Key: htmlKey,
      textS3Key: textKey,
      screenshotS3Key: screenshot ? screenshotKey : '',
      urlHash,
      timestamp,
    };

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(result),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if ((err as any)?.name === 'S3ServiceException' || (err as any)?.$metadata?.httpStatusCode) {
      console.error('S3 storage error:', message);
      return errorResponse(500, 'STORAGE_ERROR', 'Failed to store captured content');
    }

    console.error('Unexpected error in browser-capture handler:', message);
    return errorResponse(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

function errorResponse(statusCode: number, code: string, message: string): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: { code, message } }),
  };
}
