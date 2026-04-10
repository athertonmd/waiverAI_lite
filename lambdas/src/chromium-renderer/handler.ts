import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({});
const BUCKET = process.env.INGESTION_BUCKET!;

const MIN_CONTENT_LENGTH = 200; // Minimum chars of visible text to consider render complete
const MAX_WAIT_MS = 50_000; // Max time to wait for content to appear
const POLL_INTERVAL_MS = 2000; // Check every 2 seconds

export interface ChromiumRenderEvent {
  normalizedS3Key: string;
  sourceS3Key: string;
  sourceUrl: string;
  sourceType: string;
  recordId: string;
}

export interface ChromiumRenderResult {
  normalizedS3Key: string;
  sourceS3Key: string;
  sourceUrl: string;
  sourceType: string;
  recordId: string;
  chromiumRendered: boolean;
}

const ERROR_PATTERNS = [
  'access denied', 'you don\'t have permission', 'error 403',
  'errors.edgesuite.net', 'reference #18.', 'request blocked',
];

function isErrorPage(text: string): boolean {
  if (!text || text.length > 3000) return false;
  const lower = text.toLowerCase();
  return ERROR_PATTERNS.some((p) => lower.includes(p));
}

function isSpaShell(text: string): boolean {
  if (!text) return true;
  const trimmed = text.trim();
  // SPA shells have very little visible text
  return trimmed.length < MIN_CONTENT_LENGTH;
}

async function getObjectText(bucket: string, key: string): Promise<string> {
  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await resp.Body!.transformToByteArray();
  return Buffer.from(bytes).toString('utf-8');
}

async function getSourceUrl(bucket: string, sourceKey: string): Promise<string> {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: sourceKey }));
    return head.Metadata?.['source-url'] ?? '';
  } catch {
    return '';
  }
}

/**
 * Render a URL with headless Chromium, waiting for SPA content to fully load.
 * Uses polling to wait for meaningful visible text before capturing.
 */
async function renderWithChromium(url: string): Promise<{
  html: string;
  text: string;
  screenshot: Buffer;
  renderComplete: boolean;
}> {
  const chromium = (await import('@sparticuz/chromium')).default;
  const puppeteer = (await import('puppeteer-core')).default;

  chromium.setHeadlessMode = true;
  chromium.setGraphicsMode = false;

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1280, height: 900 },
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    );

    // Navigate and wait for network to settle
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45_000 });

    // Poll for meaningful visible text (SPA content rendering)
    let text = '';
    let renderComplete = false;
    const startTime = Date.now();

    while (Date.now() - startTime < MAX_WAIT_MS) {
      text = await page.evaluate('document.body ? document.body.innerText : ""') as string;

      if (text.trim().length >= MIN_CONTENT_LENGTH && !isErrorPage(text)) {
        renderComplete = true;
        console.log(`Content rendered after ${Date.now() - startTime}ms: ${text.trim().length} chars`);
        break;
      }

      // Wait before next poll
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    if (!renderComplete) {
      // Final attempt — get whatever we have
      text = await page.evaluate('document.body ? document.body.innerText : ""') as string;
      console.warn(`Render incomplete after ${MAX_WAIT_MS}ms: ${text.trim().length} chars`);
    }

    // Extra settle time after content appears
    await new Promise((r) => setTimeout(r, 2000));

    // Capture final state
    text = await page.evaluate('document.body ? document.body.innerText : ""') as string;
    const html = await page.content();
    const screenshot = (await page.screenshot({ fullPage: true, type: 'png' })) as Buffer;

    return { html, text, screenshot, renderComplete };
  } finally {
    await browser.close();
  }
}

export async function handler(event: ChromiumRenderEvent): Promise<ChromiumRenderResult> {
  const { normalizedS3Key, sourceS3Key, sourceUrl: eventSourceUrl, sourceType, recordId } = event;

  if (sourceType !== 'web') {
    console.log(`Skipping Chromium render for non-web source: ${sourceType}`);
    return { ...event, chromiumRendered: false };
  }

  // Read normalized text to check if it needs re-rendering
  let normalizedText = '';
  try {
    normalizedText = await getObjectText(BUCKET, normalizedS3Key);
  } catch (err) {
    console.error(`Failed to read normalized text at ${normalizedS3Key}:`, err);
    return { ...event, chromiumRendered: false };
  }

  // If content looks valid and substantial, skip Chromium
  if (!isErrorPage(normalizedText) && !isSpaShell(normalizedText)) {
    console.log(`Content looks valid for recordId=${recordId} (${normalizedText.trim().length} chars), skipping Chromium`);
    return { ...event, chromiumRendered: false };
  }

  const sourceUrl = eventSourceUrl || await getSourceUrl(BUCKET, sourceS3Key);
  if (!sourceUrl) {
    console.error(`No source URL for recordId=${recordId}`);
    return { ...event, chromiumRendered: false };
  }

  console.log(`Rendering with Chromium for recordId=${recordId}: ${sourceUrl}`);

  try {
    const { html, text, screenshot, renderComplete } = await renderWithChromium(sourceUrl);

    if (!text.trim() || isErrorPage(text)) {
      console.warn(`Chromium got error/empty page for ${sourceUrl}`);
      return { ...event, chromiumRendered: false };
    }

    // Store rendered HTML
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: sourceS3Key, Body: html,
      ContentType: 'text/html',
      Metadata: { 'source-url': sourceUrl, 'render-method': 'chromium', 'render-complete': String(renderComplete) },
    }));

    // Store visible text
    const textKey = sourceS3Key.replace(/\.html$/, '.txt');
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: textKey, Body: text,
      ContentType: 'text/plain',
      Metadata: { 'source-url': sourceUrl, 'render-method': 'chromium' },
    }));

    // Store screenshot
    const screenshotKey = sourceS3Key.replace(/\.html$/, '.png');
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: screenshotKey, Body: screenshot,
      ContentType: 'image/png',
      Metadata: { 'source-url': sourceUrl },
    }));

    // Overwrite normalized text with clean visible text
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: normalizedS3Key, Body: text,
      ContentType: 'text/plain',
      Metadata: { 'source-url': sourceUrl, 'render-method': 'chromium', 'record-id': recordId },
    }));

    console.log(`Chromium render done for recordId=${recordId}: ${text.length} chars, screenshot captured, complete=${renderComplete}`);
    return { ...event, sourceUrl, chromiumRendered: true };
  } catch (err) {
    console.error(`Chromium failed for recordId=${recordId}:`, err);
    return { ...event, chromiumRendered: false };
  }
}
