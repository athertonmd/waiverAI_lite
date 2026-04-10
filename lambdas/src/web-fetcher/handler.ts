import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';

const s3 = new S3Client({});
const BUCKET = process.env.INGESTION_BUCKET!;

export interface WebFetchEvent {
  url: string;
}

export interface WebFetchResult {
  s3Key: string;
  textS3Key: string;
  screenshotS3Key: string;
  urlHash: string;
  timestamp: string;
  contentLength: number;
  renderMethod: 'chromium' | 'fetch';
}

export interface WebFetchError {
  error: { code: string; message: string };
}

/**
 * Compute SHA-256 hash of a string, returned as hex.
 */
export function computeUrlHash(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

/** Content types we accept as valid HTML/text content */
const ALLOWED_CONTENT_TYPES = ['text/html', 'text/plain', 'application/xhtml+xml'];

/**
 * Check if a Content-Type header indicates HTML or text content.
 */
function isHtmlOrText(contentType: string | null): boolean {
  if (!contentType) return true; // assume HTML if no Content-Type header
  const mimeType = contentType.split(';')[0].trim().toLowerCase();
  return ALLOWED_CONTENT_TYPES.some((t) => mimeType.includes(t));
}

/**
 * Detect if content is likely binary (images, PDFs, etc.) rather than text.
 */
function isBinaryContent(content: string): boolean {
  // Check for common binary file signatures
  if (content.startsWith('\x89PNG') || content.startsWith('GIF8') ||
      content.startsWith('\xFF\xD8') || content.startsWith('%PDF')) {
    return true;
  }
  // Check for high ratio of non-printable characters in first 500 bytes
  const sample = content.slice(0, 500);
  let nonPrintable = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) nonPrintable++;
  }
  return nonPrintable / sample.length > 0.1;
}

/**
 * Detect CDN/WAF error pages that return HTTP 200 but contain access-denied content.
 * Common with Akamai, CloudFront, and similar CDNs protecting SPAs.
 */
function isErrorPage(text: string): boolean {
  const lower = text.toLowerCase();
  const errorPatterns = [
    'access denied',
    'you don\'t have permission',
    'you do not have permission',
    'error 403',
    'errors.edgesuite.net',
    'reference #18.',
    'the page cannot be displayed',
    'request blocked',
  ];
  // Must match at least one pattern AND be a short page (real content pages are longer)
  const matchesPattern = errorPatterns.some((p) => lower.includes(p));
  const isShortPage = text.length < 2000;
  return matchesPattern && isShortPage;
}

/**
 * Fallback: simple HTTP fetch (no JS rendering).
 */
async function fetchWithHttp(url: string): Promise<{ html: string; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      throw new FetchError('FETCH_FAILED', `URL returned HTTP ${response.status}: ${url}`);
    }

    // Validate Content-Type before reading body
    const contentType = response.headers.get('content-type');
    if (!isHtmlOrText(contentType)) {
      throw new FetchError(
        'INVALID_CONTENT_TYPE',
        `URL returned non-HTML content (${contentType}). Only HTML and text pages are supported: ${url}`,
      );
    }

    const html = await response.text();

    // Double-check: even if Content-Type says text/html, the body might be binary
    if (isBinaryContent(html)) {
      throw new FetchError(
        'BINARY_CONTENT',
        `URL returned binary content despite text Content-Type header. This may be an image or PDF: ${url}`,
      );
    }

    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Detect CDN/WAF error pages (Akamai, CloudFront, etc.) that return 200 with error body
    if (isErrorPage(text)) {
      throw new FetchError(
        'ACCESS_DENIED',
        `URL returned an access-denied or error page. The site may block server-side requests: ${url}`,
      );
    }

    return { html, text };
  } catch (err) {
    clearTimeout(timeout);
    if ((err as any)?.name === 'AbortError') {
      throw new FetchError('FETCH_TIMEOUT', `URL fetch timed out after 20 seconds: ${url}`);
    }
    throw err;
  }
}

/**
 * Core fetch logic: renders the page with Chromium (or falls back to HTTP fetch)
 * and stores HTML, text, and screenshot in S3.
 */
export async function fetchAndStore(url: string): Promise<WebFetchResult> {
  const urlHash = computeUrlHash(url);
  const timestamp = new Date().toISOString();
  const baseKey = `raw/web/${urlHash}/${timestamp}`;

  let html: string;
  let text: string;
  let screenshot: Buffer | null = null;
  let renderMethod: 'chromium' | 'fetch' = 'fetch';

  // For API Gateway calls (short timeout), skip Chromium and use simple fetch.
  // Chromium rendering happens in the pipeline's normalisation step instead.
  const result = await fetchWithHttp(url);
  html = result.html;
  text = result.text;

  const htmlKey = `${baseKey}.html`;
  const textKey = `${baseKey}.txt`;
  const screenshotKey = `${baseKey}.png`;

  // Store HTML
  const htmlUpload = s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: htmlKey,
    Body: html,
    ContentType: 'text/html',
    Metadata: { 'source-url': url, 'render-method': renderMethod },
  }));

  // Store text
  const textUpload = s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: textKey,
    Body: text,
    ContentType: 'text/plain',
    Metadata: { 'source-url': url, 'render-method': renderMethod },
  }));

  // Store screenshot (if available)
  const screenshotUpload = screenshot
    ? s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: screenshotKey,
        Body: screenshot,
        ContentType: 'image/png',
        Metadata: { 'source-url': url },
      }))
    : Promise.resolve();

  await Promise.all([htmlUpload, textUpload, screenshotUpload]);

  return {
    s3Key: htmlKey,
    textS3Key: textKey,
    screenshotS3Key: screenshot ? screenshotKey : '',
    urlHash,
    timestamp,
    contentLength: html.length,
    renderMethod,
  };
}

export class FetchError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'FetchError';
  }
}

/**
 * Lambda handler — accepts { url } event directly.
 */
export async function handler(event: WebFetchEvent): Promise<WebFetchResult | WebFetchError> {
  const { url } = event;

  if (!url) {
    console.error('Missing url in event');
    return { error: { code: 'MISSING_URL', message: 'url is required' } };
  }

  try {
    const result = await fetchAndStore(url);
    console.log(`Stored content for ${url} at ${result.s3Key} (method: ${result.renderMethod})`);
    return result;
  } catch (err) {
    if (err instanceof FetchError) {
      console.error(`Fetch error for ${url}: ${err.message}`);
      return { error: { code: err.code, message: err.message } };
    }

    const message = err instanceof Error ? err.message : String(err);
    console.error(`Unexpected error fetching ${url}: ${message}`);
    return { error: { code: 'FETCH_ERROR', message: `Failed to fetch URL: ${message}` } };
  }
}
