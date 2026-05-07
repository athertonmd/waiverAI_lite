import { ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TableNames } from '../shared/db';
import { getRule } from '../shared/rules';
import * as cache from '../shared/cache';

/**
 * Expiry Checker Lambda — triggered daily by EventBridge.
 * Scans for active waivers past their expiration date and marks them as expired.
 * Behaviour is controlled by the `expired_waiver_flagging` rule.
 */
export async function handler(): Promise<void> {
  try {
    const rule = await getRule('expired_waiver_flagging');
    if (!rule.enabled) {
      console.log('expired_waiver_flagging rule is disabled, skipping');
      return;
    }

    const today = new Date().toISOString().split('T')[0];

    const scanResult = await docClient.send(new ScanCommand({
      TableName: TableNames.waivers,
      FilterExpression: '#status <> :expired AND #expDate < :today',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#expDate': 'expiration_date',
      },
      ExpressionAttributeValues: {
        ':expired': 'expired',
        ':today': today,
      },
    }));

    const items = scanResult.Items ?? [];

    let updatedCount = 0;
    const now = new Date().toISOString();

    for (const item of items) {
      try {
        await docClient.send(new UpdateCommand({
          TableName: TableNames.waivers,
          Key: { id: item.id },
          UpdateExpression: 'SET #status = :expired, #updatedAt = :now',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#updatedAt': 'updated_at',
          },
          ExpressionAttributeValues: {
            ':expired': 'expired',
            ':now': now,
          },
        }));
        updatedCount++;
      } catch (error) {
        console.error(`Failed to update waiver ${item.id} to expired:`, error);
      }
    }

    console.log(`Expiry checker complete: ${updatedCount} waiver(s) transitioned to expired`);
    cache.invalidate('dashboard:metrics');
  } catch (error) {
    console.error('Expiry checker failed:', error);
  }
}
