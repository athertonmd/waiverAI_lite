import { S3Event, Context } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand, PutObjectTaggingCommand } from '@aws-sdk/client-s3';
import { simpleParser, ParsedMail, Attachment } from 'mailparser';
import { sendArrivalNotification } from './notification';

const s3 = new S3Client({});
const BUCKET = process.env.INGESTION_BUCKET!;

export async function handler(event: S3Event, context: Context): Promise<void> {
  for (const record of event.Records) {
    const key = record.s3.object.key;
    const messageId = extractMessageId(key);

    console.log(`Processing email: bucket=${BUCKET}, key=${key}, messageId=${messageId}`);

    try {
      const rawEmail = await getObject(BUCKET, key);
      const parsed = await simpleParser(rawEmail);

      const subject = parsed.subject ?? 'No subject';
      const from = parsed.from?.text ?? 'unknown';
      console.log(`Email from=${from}, subject="${subject}"`);

      // Store the email body text for pipeline processing
      // The body text often contains the waiver details
      const bodyText = parsed.text ?? (parsed.html ? parsed.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '');

      if (bodyText.trim()) {
        // Store as a .eml text file under raw/email/ so the pipeline trigger picks it up
        // The pipeline trigger already handles raw/email/ prefix → sourceType: 'email'
        const bodyKey = `raw/email/${messageId}/body.txt`;
        await s3.send(new PutObjectCommand({
          Bucket: BUCKET,
          Key: bodyKey,
          Body: bodyText,
          ContentType: 'text/plain',
          Metadata: {
            'email-from': from.substring(0, 200),
            'email-subject': subject.substring(0, 200),
            'source-type': 'email',
          },
        }));
        console.log(`Stored email body: ${bodyKey} (${bodyText.length} chars)`);
      }

      // Also extract and store PDF attachments
      const pdfAttachments = extractPdfAttachments(parsed);

      if (pdfAttachments.length > 0) {
        console.log(`Found ${pdfAttachments.length} PDF attachment(s) for messageId=${messageId}`);
        for (const attachment of pdfAttachments) {
          const filename = sanitizeFilename(attachment.filename ?? `attachment-${Date.now()}.pdf`);
          const attachmentKey = `raw/pdf/${messageId}-${filename}`;
          await s3.send(new PutObjectCommand({
            Bucket: BUCKET,
            Key: attachmentKey,
            Body: attachment.content,
            ContentType: 'application/pdf',
            Metadata: {
              'email-from': from.substring(0, 200),
              'email-subject': subject.substring(0, 200),
              'source-type': 'pdf',
            },
          }));
          console.log(`Stored PDF attachment: ${attachmentKey}`);
        }
      }

      if (!bodyText.trim() && pdfAttachments.length === 0) {
        console.log(`No usable content for messageId=${messageId}, tagging as unprocessable`);
        await tagUnprocessable(BUCKET, key);
      }

      // Send arrival notification (fire-and-forget)
      try {
        await sendArrivalNotification({
          from,
          subject,
          timestamp: new Date().toISOString(),
          pdfAttachmentCount: pdfAttachments.length,
          messageId,
        });
      } catch (err) {
        console.error('Notification failed (non-blocking):', err);
      }
    } catch (err) {
      console.error(`Error processing email messageId=${messageId}:`, err);
      throw err;
    }
  }
}

function extractMessageId(key: string): string {
  const parts = key.split('/');
  return parts[2] ?? key;
}

async function getObject(bucket: string, key: string): Promise<Buffer> {
  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await resp.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

function extractPdfAttachments(parsed: ParsedMail): Attachment[] {
  if (!parsed.attachments || parsed.attachments.length === 0) return [];
  return parsed.attachments.filter(
    (a) => a.contentType === 'application/pdf' || a.filename?.toLowerCase().endsWith('.pdf'),
  );
}

async function tagUnprocessable(bucket: string, key: string): Promise<void> {
  await s3.send(new PutObjectTaggingCommand({
    Bucket: bucket,
    Key: key,
    Tagging: { TagSet: [{ Key: 'status', Value: 'unprocessable' }] },
  }));
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}
