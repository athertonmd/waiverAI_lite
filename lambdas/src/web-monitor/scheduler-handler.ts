import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { docClient, TableNames } from '../shared/db';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const s3 = new S3Client({});
const BUCKET = process.env.INGESTION_BUCKET!;
const DEFAULT_FAILURE_THRESHOLD = 5;

export interface ScheduleEvent {
  scheduleId: string;
}

export interface ScheduleResult {
  scheduleId: string;
  status: string;
  changeDetected: boolean;
  contentHash: string;
  s3Key: string;
}

export interface ScheduleSkipped {
  scheduleId: string;
  reason: string;
}

export interface ScheduleError {
  scheduleId: string;
  error: { code: string; message: string };
}

/**
 * Compute SHA-256 hash of content, returned as hex.
 */
export function computeContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Fetch HTML from a URL, store to S3, and return the HTML + metadata.
 */
async function fetchHtmlAndStore(url: string, urlHash: string): Promise<{ html: string; s3Key: string; timestamp: string }> {
  const timestamp = new Date().toISOString();
  const s3Key = `raw/web/${urlHash}/${timestamp}.html`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`URL returned HTTP ${response.status}: ${url}`);
  }

  const html = await response.text();

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
    Body: html,
    ContentType: 'text/html',
  }));

  return { html, s3Key, timestamp };
}

/**
 * Lambda handler invoked by EventBridge Scheduler at user-defined intervals.
 * Reads schedule from DynamoDB, fetches HTML, detects changes via SHA-256, stores version.
 */
export async function handler(
  event: ScheduleEvent,
): Promise<ScheduleResult | ScheduleSkipped | ScheduleError> {
  const { scheduleId } = event;

  if (!scheduleId) {
    return { scheduleId: '', error: { code: 'MISSING_ID', message: 'scheduleId is required' } };
  }

  try {
    // 1. Read schedule from DynamoDB
    const scheduleRes = await docClient.send(new GetCommand({
      TableName: TableNames.monitorSchedules,
      Key: { id: scheduleId },
    }));

    if (!scheduleRes.Item) {
      return { scheduleId, error: { code: 'NOT_FOUND', message: 'Schedule not found' } };
    }

    const schedule = scheduleRes.Item;

    // 2. Check if schedule is still active
    if (schedule.status !== 'active') {
      return { scheduleId, reason: `Schedule is ${schedule.status}, skipping` };
    }

    // 3. Check if past end date — auto-terminate
    const now = new Date();
    if (new Date(schedule.end_date_time as string) <= now) {
      await docClient.send(new UpdateCommand({
        TableName: TableNames.monitorSchedules,
        Key: { id: scheduleId },
        UpdateExpression: 'SET #s = :status, updated_at = :now',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':status': 'completed', ':now': now.toISOString() },
      }));
      return { scheduleId, reason: 'End date reached, schedule completed' };
    }

    // 4. Fetch HTML and store to S3
    let fetchResult: Awaited<ReturnType<typeof fetchHtmlAndStore>>;
    try {
      fetchResult = await fetchHtmlAndStore(schedule.url as string, schedule.url_hash as string);
    } catch (err) {
      const newFailureCount = ((schedule.failure_count as number) || 0) + 1;
      const threshold = Number(process.env.FAILURE_THRESHOLD) || DEFAULT_FAILURE_THRESHOLD;

      if (newFailureCount >= threshold) {
        await docClient.send(new UpdateCommand({
          TableName: TableNames.monitorSchedules,
          Key: { id: scheduleId },
          UpdateExpression: 'SET failure_count = :fc, #s = :status, updated_at = :now',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: {
            ':fc': newFailureCount,
            ':status': 'paused',
            ':now': new Date().toISOString(),
          },
        }));
        console.error(`Schedule ${scheduleId} paused after ${newFailureCount} failures`);
      } else {
        await docClient.send(new UpdateCommand({
          TableName: TableNames.monitorSchedules,
          Key: { id: scheduleId },
          UpdateExpression: 'SET failure_count = :fc, updated_at = :now',
          ExpressionAttributeValues: {
            ':fc': newFailureCount,
            ':now': new Date().toISOString(),
          },
        }));
      }

      const message = err instanceof Error ? err.message : String(err);
      console.error(`Fetch failed for schedule ${scheduleId}: ${message}`);
      return { scheduleId, error: { code: 'FETCH_FAILED', message } };
    }

    // 5. Compute SHA-256 and compare
    const contentHash = computeContentHash(fetchResult.html);
    const lastHash = schedule.last_content_hash as string | undefined;
    const changeDetected = !lastHash || lastHash !== contentHash;

    // 6. Store version in WebContentVersions
    await docClient.send(new PutCommand({
      TableName: TableNames.webContentVersions,
      Item: {
        schedule_id: scheduleId,
        fetched_at: fetchResult.timestamp,
        s3_key: fetchResult.s3Key,
        content_hash: contentHash,
        change_detected: changeDetected,
      },
    }));

    // 7. Update schedule metadata
    await docClient.send(new UpdateCommand({
      TableName: TableNames.monitorSchedules,
      Key: { id: scheduleId },
      UpdateExpression: 'SET last_content_hash = :hash, last_fetch_timestamp = :now, failure_count = :zero, updated_at = :now',
      ExpressionAttributeValues: {
        ':hash': contentHash,
        ':now': new Date().toISOString(),
        ':zero': 0,
      },
    }));

    console.log(
      `Schedule ${scheduleId}: fetched ${schedule.url}, change=${changeDetected}, hash=${contentHash.substring(0, 12)}...`,
    );

    return {
      scheduleId,
      status: 'fetched',
      changeDetected,
      contentHash,
      s3Key: fetchResult.s3Key,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Unexpected error for schedule ${scheduleId}: ${message}`);
    return { scheduleId, error: { code: 'INTERNAL_ERROR', message } };
  }
}
