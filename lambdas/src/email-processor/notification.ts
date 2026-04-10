import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const ses = new SESClient({});
const SETTINGS_TABLE_REGION = process.env.SETTINGS_TABLE_REGION ?? '';
const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient(SETTINGS_TABLE_REGION ? { region: SETTINGS_TABLE_REGION } : {}),
  { marshallOptions: { removeUndefinedValues: true } },
);

const SETTINGS_TABLE = process.env.SETTINGS_TABLE ?? '';
const NOTIFICATION_SENDER = process.env.NOTIFICATION_SENDER ?? '';

export interface NotificationParams {
  from: string;
  subject: string;
  timestamp: string;
  pdfAttachmentCount: number;
  messageId: string;
}

export function buildNotificationBody(params: NotificationParams): string {
  return [
    'A new waiver email has been received and is being processed.',
    '',
    `From: ${params.from}`,
    `Subject: ${params.subject}`,
    `Received: ${params.timestamp}`,
    `PDF Attachments: ${params.pdfAttachmentCount}`,
    '',
    'This is an automated notification from Waiver Data Hub.',
  ].join('\n');
}

export async function sendArrivalNotification(params: NotificationParams): Promise<void> {
  if (!NOTIFICATION_SENDER) {
    console.log('No notification sender configured, skipping notification');
    return;
  }

  if (!SETTINGS_TABLE) {
    console.log('No settings table configured, skipping notification');
    return;
  }

  let recipients: string[] = [];
  try {
    const result = await ddb.send(new GetCommand({
      TableName: SETTINGS_TABLE,
      Key: { key: 'notification_recipients' },
    }));
    if (result.Item?.value) {
      recipients = JSON.parse(result.Item.value as string);
    }
  } catch (err) {
    console.error('Failed to read notification recipients:', err);
    return;
  }

  if (!Array.isArray(recipients) || recipients.length === 0) {
    console.log('No notification recipients configured, skipping notification');
    return;
  }

  const body = buildNotificationBody(params);

  try {
    await ses.send(new SendEmailCommand({
      Source: NOTIFICATION_SENDER,
      Destination: { ToAddresses: recipients },
      Message: {
        Subject: { Data: `New Waiver Email Received — ${params.subject}` },
        Body: { Text: { Data: body } },
      },
    }));
    console.log(`Notification sent to ${recipients.length} recipient(s)`);
  } catch (err) {
    console.error('Failed to send notification email:', err);
  }
}
