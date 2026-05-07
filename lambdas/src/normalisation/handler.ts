import { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand, PutObjectTaggingCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { simpleParser } from 'mailparser';
// Import the internal parser directly to avoid pdf-parse's index.js
// which tries to load a test PDF file on require()
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

const s3 = new S3Client({});
const sqs = new SQSClient({});

const BUCKET = process.env.INGESTION_BUCKET!;
const DLQ_URL = process.env.DLQ_URL!;

export interface NormalisationEvent {
  s3Key: string;
  sourceType: 'email' | 'pdf' | 'web';
  recordId: string;
}

export interface NormalisationResult {
  normalizedS3Key: string;
  sourceS3Key: string;
  sourceType: string;
  recordId: string;
  sourceUrl?: string;
}

export async function handler(event: NormalisationEvent): Promise<NormalisationResult> {
  const { s3Key, sourceType, recordId } = event;

  console.log(`Normalising: sourceType=${sourceType}, recordId=${recordId}, s3Key=${s3Key}`);

  try {
    const rawContent = await getObject(BUCKET, s3Key);
    let normalizedText: string;

    switch (sourceType) {
      case 'pdf':
        normalizedText = await normalisePdf(BUCKET, s3Key);
        break;
      case 'web': {
        const rawText = rawContent.toString('utf-8');
        // Detect binary content (images, PDFs served as HTML, etc.)
        if (isBinaryContent(rawContent)) {
          throw new Error(`Content at ${s3Key} appears to be binary (image/PDF), not text. Skipping normalisation.`);
        }

        // Check if this is a browser-capture source
        let renderMethod = '';
        try {
          const headResp = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: s3Key }));
          renderMethod = headResp.Metadata?.['render-method'] ?? '';
        } catch {
          // If metadata unavailable, fall through to default normaliseHtml
        }

        if (renderMethod === 'browser-capture') {
          if (s3Key.endsWith('.txt')) {
            // Browser-capture .txt file — use raw text directly (already clean)
            normalizedText = rawText;
          } else if (s3Key.endsWith('.html')) {
            // Browser-capture .html file (fallback) — read the companion .txt file instead
            const txtKey = s3Key.replace(/\.html$/, '.txt');
            const txtContent = await getObject(BUCKET, txtKey);
            normalizedText = txtContent.toString('utf-8');
          } else {
            normalizedText = normaliseHtml(rawText);
          }
        } else {
          normalizedText = normaliseHtml(rawText);
        }
        break;
      }
      case 'email':
        normalizedText = await normaliseEmail(rawContent);
        break;
      default:
        throw new Error(`Unsupported source type: ${sourceType}`);
    }

    if (!normalizedText.trim()) {
      throw new Error(`Normalisation produced empty text for recordId=${recordId}`);
    }

    const normalizedKey = `normalized/${sourceType}/${recordId}.txt`;

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: normalizedKey,
      Body: normalizedText,
      ContentType: 'text/plain',
      Metadata: {
        'source-s3-key': s3Key,
        'source-type': sourceType,
        'record-id': recordId,
      },
    }));

    console.log(`Stored normalized output: ${normalizedKey}`);

    // Try to get the original URL from the raw S3 object metadata
    let sourceUrl = '';
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: s3Key }));
      sourceUrl = head.Metadata?.['source-url'] ?? '';
    } catch {
      // No metadata available
    }

    return {
      normalizedS3Key: normalizedKey,
      sourceS3Key: s3Key,
      sourceType,
      recordId,
      sourceUrl,
    };
  } catch (err) {
    console.error(`Normalisation failed for recordId=${recordId}:`, err);

    await markNormalisationFailed(BUCKET, s3Key);
    await sendToDlq(event, err);

    throw err;
  }
}

/** Fetch an object from S3 as a Buffer. */
async function getObject(bucket: string, key: string): Promise<Buffer> {
  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await resp.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

/** Detect if a buffer contains binary content (images, PDFs, etc.) rather than text. */
function isBinaryContent(buf: Buffer): boolean {
  // Check common binary file signatures
  if (buf[0] === 0x89 && buf[1] === 0x50) return true; // PNG
  if (buf[0] === 0xFF && buf[1] === 0xD8) return true; // JPEG
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true; // GIF
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return true; // PDF
  // Check for high ratio of non-printable characters in first 512 bytes
  const sample = buf.subarray(0, Math.min(512, buf.length));
  let nonPrintable = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] < 32 && sample[i] !== 9 && sample[i] !== 10 && sample[i] !== 13) nonPrintable++;
  }
  return nonPrintable / sample.length > 0.1;
}

/** Normalise PDF by extracting text using pdf-parse. */
async function normalisePdf(bucket: string, key: string): Promise<string> {
  const pdfBuffer = await getObject(bucket, key);
  const result = await pdfParse(pdfBuffer);
  const text = result.text ?? '';

  if (!text.trim()) {
    throw new Error(`pdf-parse returned empty text for PDF at ${key} (${result.numpages} pages)`);
  }

  console.log(`Extracted ${text.length} chars from ${result.numpages}-page PDF using pdf-parse`);
  return text;
}

/** Normalise HTML by stripping tags, scripts, and styles. */
export function normaliseHtml(html: string): string {
  let text = html;
  // Remove script tags and content
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  // Remove style tags and content
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  // Replace block-level tags with newlines
  text = text.replace(/<\/(p|div|br|h[1-6]|li|tr)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, '');
  // Decode common HTML entities
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');
  // Collapse whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s*\n/g, '\n');
  return text.trim();
}

/** Normalise email by parsing MIME and extracting text body. */
async function normaliseEmail(raw: Buffer): Promise<string> {
  const parsed = await simpleParser(raw);
  return parsed.text ?? '';
}

/** Tag the raw S3 object as normalisation_failed. */
async function markNormalisationFailed(bucket: string, key: string): Promise<void> {
  try {
    await s3.send(new PutObjectTaggingCommand({
      Bucket: bucket,
      Key: key,
      Tagging: {
        TagSet: [{ Key: 'status', Value: 'normalisation_failed' }],
      },
    }));
  } catch (tagErr) {
    console.error('Failed to tag object as normalisation_failed:', tagErr);
  }
}

/** Send the failed event to the dead-letter queue. */
async function sendToDlq(event: NormalisationEvent, error: unknown): Promise<void> {
  try {
    await sqs.send(new SendMessageCommand({
      QueueUrl: DLQ_URL,
      MessageBody: JSON.stringify({
        event,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }),
    }));
  } catch (sqsErr) {
    console.error('Failed to send message to DLQ:', sqsErr);
  }
}
