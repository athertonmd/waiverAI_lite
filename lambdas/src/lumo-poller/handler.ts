import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { createHash, randomUUID } from 'node:crypto';
import type { ScheduledEvent } from 'aws-lambda';
import type { LumoWaiver, WaiverRegistry } from './types';

const secretsManager = new SecretsManagerClient({});
const s3 = new S3Client({});
const sfn = new SFNClient({});
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const LUMO_API_SECRET_ARN = process.env.LUMO_API_SECRET_ARN!;
const LUMO_API_BASE_URL = process.env.LUMO_API_BASE_URL || 'https://flifo-qa.flightstats.com/flex';
const INGESTION_BUCKET = process.env.INGESTION_BUCKET!;
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN!;
const SETTINGS_TABLE = process.env.SETTINGS_TABLE!;

/**
 * Retrieve the Lumo API key from Secrets Manager.
 * Returns the API key string, or null if missing/empty.
 */
export async function getLumoApiKey(secretArn: string): Promise<string | null> {
  const result = await secretsManager.send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );

  if (!result.SecretString) {
    console.error(`Lumo API key secret is empty (ARN: ${secretArn})`);
    return null;
  }

  try {
    const parsed = JSON.parse(result.SecretString);
    const apiKey = parsed.apiKey;
    if (!apiKey) {
      console.error(`Lumo API key is empty in secret (ARN: ${secretArn})`);
      return null;
    }
    return apiKey;
  } catch {
    // If the secret is a plain string (not JSON), use it directly
    const trimmed = result.SecretString.trim();
    if (!trimmed) {
      console.error(`Lumo API key is empty in secret (ARN: ${secretArn})`);
      return null;
    }
    return trimmed;
  }
}

/**
 * Call the Lumo waivers/search endpoint with a 10-second timeout.
 * Returns the array of waivers, or null if the request failed.
 */
export async function fetchLumoWaivers(apiKey: string): Promise<LumoWaiver[] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const url = `${LUMO_API_BASE_URL}/waivers/search`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'token': apiKey,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '(unable to read body)');
      console.error(
        `Lumo API returned HTTP ${response.status}: ${body}`,
      );
      return null;
    }

    const data: unknown = await response.json();
    if (Array.isArray(data)) return data as LumoWaiver[];
    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      const waivers = obj.waivers ?? obj.results;
      return Array.isArray(waivers) ? waivers as LumoWaiver[] : [];
    }
    return [];
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('Lumo API request timed out after 10 seconds');
    } else {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Lumo API request failed: ${message}`);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Compute SHA-256 content hash of a waiver payload (JSON-stringified).
 */
export function computeContentHash(waiver: LumoWaiver): string {
  return createHash('sha256')
    .update(JSON.stringify(waiver))
    .digest('hex');
}

/**
 * Load the active waiver registry from the Settings table.
 * On read failure, returns an empty registry (treats all waivers as new).
 */
export async function loadWaiverRegistry(): Promise<WaiverRegistry> {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: SETTINGS_TABLE,
        Key: { key: 'lumo_waiver_registry' },
      }),
    );

    if (!result.Item?.value) {
      return {};
    }

    return JSON.parse(result.Item.value as string) as WaiverRegistry;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to load waiver registry, treating all waivers as new: ${message}`);
    return {};
  }
}

/**
 * Save the updated waiver registry to the Settings table.
 */
export async function saveWaiverRegistry(registry: WaiverRegistry): Promise<void> {
  try {
    await docClient.send(
      new PutCommand({
        TableName: SETTINGS_TABLE,
        Item: {
          key: 'lumo_waiver_registry',
          value: JSON.stringify(registry),
        },
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to save waiver registry: ${message}`);
  }
}

/**
 * Store raw waiver JSON to S3 and return the S3 key.
 */
export async function storeRawJson(waiver: LumoWaiver, lumoWaiverId: string): Promise<string> {
  const timestamp = new Date().toISOString();
  const s3Key = `raw/lumo/${lumoWaiverId}/${timestamp}.json`;

  await s3.send(
    new PutObjectCommand({
      Bucket: INGESTION_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(waiver),
      ContentType: 'application/json',
      Metadata: {
        'source-type': 'lumo',
        'lumo-waiver-id': lumoWaiverId,
      },
    }),
  );

  return s3Key;
}

/**
 * Start the Step Functions pipeline execution for a Lumo waiver.
 */
export async function startPipeline(s3Key: string, recordId: string): Promise<void> {
  await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: STATE_MACHINE_ARN,
      name: `lumo-${recordId}`,
      input: JSON.stringify({
        sourceType: 'lumo',
        s3Key,
        recordId,
      }),
    }),
  );
}

/**
 * Update the last poll timestamp in the Settings table.
 */
export async function updateLastPollTimestamp(): Promise<void> {
  try {
    await docClient.send(
      new PutCommand({
        TableName: SETTINGS_TABLE,
        Item: {
          key: 'lumo_last_poll',
          value: new Date().toISOString(),
        },
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to update last poll timestamp: ${message}`);
  }
}

/**
 * Main handler triggered by EventBridge on a 2-minute schedule.
 * Polls the Lumo API, detects new/changed waivers, stores raw JSON,
 * and starts the pipeline for each new/changed waiver.
 */
export async function handler(event: ScheduledEvent): Promise<void> {
  console.log('Lumo poller triggered', { time: event.time });

  // 1. Retrieve API key from Secrets Manager
  let apiKey: string | null;
  try {
    apiKey = await getLumoApiKey(LUMO_API_SECRET_ARN);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to retrieve Lumo API key: ${message}`);
    return;
  }

  if (!apiKey) {
    return;
  }

  // 2. Fetch waivers from Lumo API
  const waivers = await fetchLumoWaivers(apiKey);
  if (!waivers) {
    return;
  }

  console.log(`Fetched ${waivers.length} waivers from Lumo API`);

  // 3. Load the waiver registry for change detection
  const registry = await loadWaiverRegistry();

  let ingestedCount = 0;
  let skippedCount = 0;
  const MAX_INGESTIONS_PER_CYCLE = 5; // Limit to avoid Lambda concurrency exhaustion

  // 4. Process each waiver
  for (const waiver of waivers) {
    const lumoWaiverId = waiver.id;
    const contentHash = computeContentHash(waiver);

    // Change detection: skip if hash matches
    const existingEntry = registry[lumoWaiverId];
    if (existingEntry && existingEntry.contentHash === contentHash) {
      // Update lastSeen but skip ingestion
      existingEntry.lastSeen = new Date().toISOString();
      skippedCount++;
      continue;
    }

    // Stop if we've hit the per-cycle limit
    if (ingestedCount >= MAX_INGESTIONS_PER_CYCLE) {
      console.log(`Reached max ingestions per cycle (${MAX_INGESTIONS_PER_CYCLE}), deferring remaining to next poll`);
      break;
    }

    // New or changed waiver — ingest
    try {
      const s3Key = await storeRawJson(waiver, lumoWaiverId);
      const recordId = randomUUID();

      try {
        await startPipeline(s3Key, recordId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `Failed to start pipeline for waiver ${lumoWaiverId}: ${message}`,
        );
        // Continue processing remaining waivers
        continue;
      }

      // Update registry entry
      registry[lumoWaiverId] = {
        contentHash,
        lastSeen: new Date().toISOString(),
        waiverHubRecordId: recordId,
      };

      ingestedCount++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `Failed to store raw JSON for waiver ${lumoWaiverId}: ${message}`,
      );
      // Continue processing remaining waivers
    }
  }

  console.log(
    `Lumo poll complete: ${ingestedCount} ingested, ${skippedCount} unchanged`,
  );

  // 5. Save updated registry
  await saveWaiverRegistry(registry);

  // 6. Update last poll timestamp
  await updateLastPollTimestamp();
}
