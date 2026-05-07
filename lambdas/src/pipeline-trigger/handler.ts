import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import type { S3Event } from 'aws-lambda';
import { sendArrivalNotification } from '../email-processor/notification';

const sfn = new SFNClient({});
const s3 = new S3Client({});
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN!;

/**
 * Determines the source type from the S3 key prefix.
 * Expected key patterns: raw/email/..., raw/pdf/..., raw/web/...
 */
function resolveSourceType(key: string): 'email' | 'pdf' | 'web' {
  if (key.startsWith('raw/email/')) return 'email';
  if (key.startsWith('raw/pdf/')) return 'pdf';
  if (key.startsWith('raw/web/')) return 'web';
  return 'email'; // default fallback
}

export async function handler(event: S3Event): Promise<void> {
  for (const record of event.Records) {
    const s3Key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    const bucket = record.s3.bucket.name;

    // Check if this is a browser-capture .txt file that should trigger the pipeline
    if (s3Key.startsWith('raw/web/') && s3Key.endsWith('.txt')) {
      try {
        const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: s3Key }));
        if (head.Metadata?.['render-method'] === 'browser-capture') {
          // Allow browser-capture .txt files through — they are the primary content
          console.log(`Browser-capture .txt file allowed through: ${s3Key}`);
          // Fall through to pipeline execution below
        } else {
          // Non-browser-capture .txt file — skip as before
          console.log(`Skipping auxiliary file: ${s3Key}`);
          continue;
        }
      } catch {
        // If we can't read metadata, skip as before (safe default)
        console.log(`Skipping auxiliary file (metadata unavailable): ${s3Key}`);
        continue;
      }
    } else {
      // Skip auxiliary files (text extracts, screenshots) but allow email body.txt
      const isEmailBody = s3Key.startsWith('raw/email/') && s3Key.endsWith('/body.txt');
      if (!isEmailBody && (s3Key.endsWith('.txt') || s3Key.endsWith('.png') || s3Key.endsWith('.jpg'))) {
        console.log(`Skipping auxiliary file: ${s3Key}`);
        continue;
      }
    }

    // Check if this is a browser-capture .html file that should be skipped
    if (s3Key.startsWith('raw/web/') && s3Key.endsWith('.html')) {
      try {
        const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: s3Key }));
        if (head.Metadata?.['render-method'] === 'browser-capture') {
          // Skip browser-capture .html files — the .txt file is the trigger
          console.log(`Skipping browser-capture .html file: ${s3Key}`);
          continue;
        }
      } catch {
        // If we can't read metadata, allow through (web-fetcher .html files should trigger)
      }
    }

    // Skip the raw MIME email file (SES stores it without extension) — the email processor handles it
    // and creates body.txt + PDF attachments which trigger the pipeline
    if (s3Key.startsWith('raw/email/') && !s3Key.includes('/') || false) {
      // Actually, the raw email key is like raw/email/{messageId} (no subdirectory)
      // The processed files are raw/email/{messageId}/body.txt and raw/pdf/{messageId}-*.pdf
      // So we skip raw/email/{messageId} (exactly 3 path segments) — that's the raw MIME
      const segments = s3Key.split('/');
      if (segments.length === 3 && !s3Key.endsWith('.txt')) {
        console.log(`Skipping raw MIME email (handled by email processor): ${s3Key}`);
        continue;
      }
    }

    const sourceType = resolveSourceType(s3Key);
    const recordId = randomUUID();

    console.log(`Starting pipeline: s3Key=${s3Key}, sourceType=${sourceType}, recordId=${recordId}`);

    await sfn.send(new StartExecutionCommand({
      stateMachineArn: STATE_MACHINE_ARN,
      name: `waiver-${recordId}`,
      input: JSON.stringify({ s3Key, sourceType, recordId }),
    }));

    // Send arrival notification for email sources
    if (sourceType === 'email') {
      try {
        let emailFrom = 'unknown';
        let emailSubject = 'No subject';
        try {
          const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: s3Key }));
          emailFrom = head.Metadata?.['email-from'] ?? 'unknown';
          emailSubject = head.Metadata?.['email-subject'] ?? 'No subject';
        } catch { /* metadata not available */ }

        await sendArrivalNotification({
          from: emailFrom,
          subject: emailSubject,
          timestamp: new Date().toISOString(),
          pdfAttachmentCount: 0,
          messageId: recordId,
        });
      } catch (err) {
        console.error('Notification failed (non-blocking):', err);
      }
    }
  }
}
