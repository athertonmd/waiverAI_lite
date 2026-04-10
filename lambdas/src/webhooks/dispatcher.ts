import { docClient } from '../shared/db';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';

const WEBHOOK_TABLE = process.env.WEBHOOK_SUBSCRIPTIONS_TABLE ?? '';

interface WebhookSubscription {
  id: string;
  url: string;
  events: string[];
  active: boolean;
}

/**
 * Dispatches a webhook event to all matching active subscribers.
 * Failures are logged but never block the caller.
 */
export async function dispatchWebhook(
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!WEBHOOK_TABLE) return;

  try {
    const result = await docClient.send(new ScanCommand({
      TableName: WEBHOOK_TABLE,
      FilterExpression: 'active = :t',
      ExpressionAttributeValues: { ':t': true },
    }));

    const subs = (result.Items ?? []) as unknown as WebhookSubscription[];
    const matching = subs.filter((s) => s.events.includes(eventType));

    if (matching.length === 0) return;

    const body = JSON.stringify({ event: eventType, timestamp: new Date().toISOString(), data: payload });

    await Promise.allSettled(
      matching.map(async (sub) => {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          await fetch(sub.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal: controller.signal,
          });
          clearTimeout(timeout);
        } catch (err) {
          console.warn(`Webhook delivery failed for ${sub.id} → ${sub.url}:`, err);
        }
      }),
    );
  } catch (err) {
    console.warn('Webhook dispatch error (non-blocking):', err);
  }
}
