import {
  SageMakerA2IRuntimeClient,
  StartHumanLoopCommand,
} from '@aws-sdk/client-sagemaker-a2i-runtime';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { docClient, TableNames } from '../shared/db';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

const a2iClient = new SageMakerA2IRuntimeClient({});
const s3 = new S3Client({});

const FLOW_DEFINITION_ARN = process.env.FLOW_DEFINITION_ARN!;
const BUCKET = process.env.INGESTION_BUCKET!;

export interface StartReviewEvent {
  recordId: string;
  extractedS3Key: string;
  overallConfidence: number;
}

export interface StartReviewResult {
  recordId: string;
  humanLoopArn: string;
  humanLoopName: string;
}

async function fetchExtractedData(key: string): Promise<Record<string, unknown>> {
  const resp = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const body = await resp.Body!.transformToString('utf-8');
  return JSON.parse(body);
}

export async function handler(event: StartReviewEvent): Promise<StartReviewResult> {
  const { recordId, extractedS3Key, overallConfidence } = event;

  console.log(`Starting A2I review: recordId=${recordId}, confidence=${overallConfidence}`);

  const extracted = await fetchExtractedData(extractedS3Key);

  const humanLoopName = `waiver-review-${recordId}-${Date.now()}`;

  const result = await a2iClient.send(
    new StartHumanLoopCommand({
      FlowDefinitionArn: FLOW_DEFINITION_ARN,
      HumanLoopName: humanLoopName,
      HumanLoopInput: {
        InputContent: JSON.stringify({
          recordId,
          overallConfidence,
          airline_code: extracted.airline_code ?? '',
          waiver_title: extracted.waiver_title ?? '',
          waiver_code: extracted.waiver_code ?? '',
          effective_date: extracted.effective_date ?? '',
          expiration_date: extracted.expiration_date ?? '',
          applicable_routes: Array.isArray(extracted.applicable_routes)
            ? (extracted.applicable_routes as string[]).join(', ')
            : '',
          fare_classes: Array.isArray(extracted.fare_classes)
            ? (extracted.fare_classes as string[]).join(', ')
            : '',
          rebooking_rules: extracted.rebooking_rules ?? '',
          refund_rules: extracted.refund_rules ?? '',
        }),
      },
    }),
  );

  const humanLoopArn = result.HumanLoopArn ?? '';

  // Store the human loop ARN in the waivers table
  await docClient.send(new UpdateCommand({
    TableName: TableNames.waivers,
    Key: { id: recordId },
    UpdateExpression: 'SET human_loop_arn = :arn, updated_at = :now',
    ExpressionAttributeValues: {
      ':arn': humanLoopArn,
      ':now': new Date().toISOString(),
    },
  }));

  console.log(`A2I human loop started: ${humanLoopArn}`);

  return { recordId, humanLoopArn, humanLoopName };
}
