import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
export const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

export const TableNames = {
  waivers: process.env.WAIVERS_TABLE!,
  waiverVersions: process.env.WAIVER_VERSIONS_TABLE!,
  monitorSchedules: process.env.MONITOR_SCHEDULES_TABLE!,
  webContentVersions: process.env.WEB_CONTENT_VERSIONS_TABLE!,
  settings: process.env.SETTINGS_TABLE!,
  webhookSubscriptions: process.env.WEBHOOK_SUBSCRIPTIONS_TABLE!,
  corrections: process.env.CORRECTIONS_TABLE ?? '',
};
