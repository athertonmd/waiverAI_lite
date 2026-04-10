import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { docClient, TableNames } from '../shared/db';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

const s3 = new S3Client({});

export interface A2iCompletionEvent {
  humanLoopName: string;
  humanLoopArn: string;
  outputS3Bucket: string;
  outputS3Key: string;
}

export interface ReviewerAnswers {
  airline_code?: string;
  waiver_title?: string;
  waiver_code?: string;
  effective_date?: string;
  expiration_date?: string;
  applicable_routes?: string;
  fare_classes?: string;
  rebooking_rules?: string;
  refund_rules?: string;
  decision?: 'approved' | 'rejected';
  rejection_reason?: string;
}

export interface CompleteReviewResult {
  recordId: string;
  status: string;
  updated: boolean;
}

async function fetchReviewOutput(bucket: string, key: string): Promise<{
  recordId: string;
  answers: ReviewerAnswers;
}> {
  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await resp.Body!.transformToString('utf-8');
  const output = JSON.parse(body);

  const inputContent = output.inputContent ?? {};
  const recordId: string = inputContent.recordId ?? '';

  const humanAnswers = output.humanAnswers ?? [];
  const answers: ReviewerAnswers = humanAnswers.length > 0
    ? humanAnswers[0].answerContent ?? {}
    : {};

  return { recordId, answers };
}

export async function handler(event: A2iCompletionEvent): Promise<CompleteReviewResult> {
  const { outputS3Bucket, outputS3Key, humanLoopArn } = event;

  console.log(`A2I review completed: loop=${humanLoopArn}, output=${outputS3Key}`);

  const { recordId, answers } = await fetchReviewOutput(outputS3Bucket, outputS3Key);

  if (!recordId) {
    throw new Error(`Cannot determine recordId from A2I output at ${outputS3Key}`);
  }

  const decision = answers.decision ?? 'approved';
  const newStatus = decision === 'rejected' ? 'rejected' : 'active';

  const applicableRoutes = answers.applicable_routes
    ? answers.applicable_routes.split(',').map((r) => r.trim()).filter(Boolean)
    : undefined;
  const fareClasses = answers.fare_classes
    ? answers.fare_classes.split(',').map((c) => c.trim()).filter(Boolean)
    : undefined;

  // Build dynamic UpdateExpression
  const setExprs: string[] = ['#s = :status', 'updated_at = :now'];
  const exprNames: Record<string, string> = { '#s': 'status' };
  const exprValues: Record<string, unknown> = {
    ':status': newStatus,
    ':now': new Date().toISOString(),
  };

  if (newStatus === 'active') {
    setExprs.push('approval_timestamp = :now');
  }

  if (newStatus === 'rejected' && answers.rejection_reason) {
    setExprs.push('rejection_reason = :rr');
    exprValues[':rr'] = answers.rejection_reason;
  }

  const fieldMap: Record<string, unknown> = {
    airline_code: answers.airline_code,
    waiver_title: answers.waiver_title,
    waiver_code: answers.waiver_code,
    effective_date: answers.effective_date,
    expiration_date: answers.expiration_date,
    rebooking_rules: answers.rebooking_rules,
    refund_rules: answers.refund_rules,
  };

  let idx = 0;
  for (const [col, val] of Object.entries(fieldMap)) {
    if (val !== undefined && val !== '') {
      const alias = `:f${idx++}`;
      setExprs.push(`${col} = ${alias}`);
      exprValues[alias] = val;
    }
  }

  if (applicableRoutes) {
    setExprs.push('applicable_routes = :ar');
    exprValues[':ar'] = applicableRoutes;
  }
  if (fareClasses) {
    setExprs.push('fare_classes = :fc');
    exprValues[':fc'] = fareClasses;
  }

  await docClient.send(new UpdateCommand({
    TableName: TableNames.waivers,
    Key: { id: recordId },
    UpdateExpression: `SET ${setExprs.join(', ')}`,
    ExpressionAttributeNames: exprNames,
    ExpressionAttributeValues: exprValues,
  }));

  console.log(`Waiver ${recordId} updated to status=${newStatus}`);

  return { recordId, status: newStatus, updated: true };
}
