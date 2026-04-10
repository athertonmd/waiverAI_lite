import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { docClient, TableNames } from '../shared/db';
import { ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

/**
 * API Gateway handler for monitoring schedule management.
 * Routes:
 *   GET    /v1/monitoring/schedules       — list active schedules
 *   PUT    /v1/monitoring/schedules/{id}   — update schedule
 *   DELETE /v1/monitoring/schedules/{id}   — terminate schedule
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  const scheduleId = event.pathParameters?.id;

  try {
    if (method === 'GET' && !scheduleId) {
      return await listSchedules();
    }
    if (method === 'PUT' && scheduleId) {
      return await updateSchedule(scheduleId, event.body);
    }
    if (method === 'DELETE' && scheduleId) {
      return await terminateSchedule(scheduleId);
    }

    return errorResponse(405, 'METHOD_NOT_ALLOWED', `${method} not supported`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Monitor API error:', message);
    return errorResponse(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

/**
 * GET /v1/monitoring/schedules — list active/paused schedules
 */
async function listSchedules(): Promise<APIGatewayProxyResult> {
  const allItems: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(new ScanCommand({
      TableName: TableNames.monitorSchedules,
      FilterExpression: '#s IN (:active, :paused)',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':active': 'active', ':paused': 'paused' },
      ExclusiveStartKey: lastKey,
    }));
    if (result.Items) allItems.push(...result.Items);
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  // Sort by created_at descending
  allItems.sort((a, b) => {
    const aDate = (a.created_at as string) ?? '';
    const bDate = (b.created_at as string) ?? '';
    return bDate.localeCompare(aDate);
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' },
    body: JSON.stringify({ data: allItems }),
  };
}

/**
 * PUT /v1/monitoring/schedules/{id} — update interval_minutes and/or end_date_time
 */
async function updateSchedule(id: string, body: string | null): Promise<APIGatewayProxyResult> {
  if (!body) {
    return errorResponse(400, 'MISSING_BODY', 'Request body is required');
  }

  let parsed: { interval_minutes?: number; end_date_time?: string };
  try {
    parsed = JSON.parse(body);
  } catch {
    return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }

  const setExprs: string[] = ['updated_at = :now'];
  const exprValues: Record<string, unknown> = { ':now': new Date().toISOString() };

  if (parsed.interval_minutes !== undefined) {
    if (typeof parsed.interval_minutes !== 'number' || parsed.interval_minutes < 1) {
      return errorResponse(400, 'INVALID_INTERVAL', 'interval_minutes must be a positive integer');
    }
    setExprs.push('interval_minutes = :im');
    exprValues[':im'] = parsed.interval_minutes;
  }

  if (parsed.end_date_time !== undefined) {
    const endDate = new Date(parsed.end_date_time);
    if (isNaN(endDate.getTime())) {
      return errorResponse(400, 'INVALID_DATE', 'end_date_time must be a valid ISO 8601 datetime');
    }
    setExprs.push('end_date_time = :edt');
    exprValues[':edt'] = endDate.toISOString();
  }

  if (setExprs.length === 1) {
    // Only updated_at — no real updates
    return errorResponse(400, 'NO_UPDATES', 'Provide interval_minutes and/or end_date_time');
  }

  const result = await docClient.send(new UpdateCommand({
    TableName: TableNames.monitorSchedules,
    Key: { id },
    UpdateExpression: `SET ${setExprs.join(', ')}`,
    ExpressionAttributeValues: exprValues,
    ConditionExpression: 'attribute_exists(id)',
    ReturnValues: 'ALL_NEW',
  }));

  if (!result.Attributes) {
    return errorResponse(404, 'NOT_FOUND', `Schedule ${id} not found`);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' },
    body: JSON.stringify({ data: result.Attributes }),
  };
}

/**
 * DELETE /v1/monitoring/schedules/{id} — terminate schedule
 */
async function terminateSchedule(id: string): Promise<APIGatewayProxyResult> {
  try {
    const result = await docClient.send(new UpdateCommand({
      TableName: TableNames.monitorSchedules,
      Key: { id },
      UpdateExpression: 'SET #s = :status, updated_at = :now',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':status': 'terminated',
        ':now': new Date().toISOString(),
      },
      ConditionExpression: 'attribute_exists(id)',
      ReturnValues: 'ALL_NEW',
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' },
      body: JSON.stringify({ data: result.Attributes }),
    };
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      return errorResponse(404, 'NOT_FOUND', `Schedule ${id} not found`);
    }
    throw err;
  }
}

function errorResponse(statusCode: number, code: string, message: string): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' },
    body: JSON.stringify({ error: { code, message } }),
  };
}
