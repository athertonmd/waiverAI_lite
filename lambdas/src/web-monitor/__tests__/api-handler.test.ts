// Mock DynamoDB
const mockDocClientSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockDocClientSend })) },
  ScanCommand: jest.fn((input: unknown) => ({ _type: 'Scan', input })),
  UpdateCommand: jest.fn((input: unknown) => ({ _type: 'Update', input })),
}));

process.env.WAIVERS_TABLE = 'test-waivers';
process.env.WAIVER_VERSIONS_TABLE = 'test-waiver-versions';
process.env.MONITOR_SCHEDULES_TABLE = 'test-monitor-schedules';
process.env.WEB_CONTENT_VERSIONS_TABLE = 'test-web-content-versions';
process.env.SETTINGS_TABLE = 'test-settings';

import { handler } from '../api-handler';
import { APIGatewayProxyEvent } from 'aws-lambda';

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/v1/monitoring/schedules',
    pathParameters: null,
    queryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false,
    stageVariables: null,
    requestContext: {} as any,
    resource: '',
    ...overrides,
  };
}

describe('GET /v1/monitoring/schedules', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return list of active/paused schedules', async () => {
    const schedules = [
      { id: 's1', url: 'https://example.com', status: 'active', interval_minutes: 60 },
      { id: 's2', url: 'https://other.com', status: 'paused', interval_minutes: 30 },
    ];
    mockDocClientSend.mockResolvedValueOnce({ Items: schedules, LastEvaluatedKey: undefined });

    const result = await handler(makeEvent());
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe('s1');
  });

  it('should return empty array when no schedules exist', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    const result = await handler(makeEvent());
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).data).toHaveLength(0);
  });
});

describe('PUT /v1/monitoring/schedules/{id}', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should update interval_minutes', async () => {
    mockDocClientSend.mockResolvedValueOnce({
      Attributes: { id: 's1', interval_minutes: 120, status: 'active' },
    });

    const result = await handler(makeEvent({
      httpMethod: 'PUT',
      pathParameters: { id: 's1' },
      body: JSON.stringify({ interval_minutes: 120 }),
    }));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).data.interval_minutes).toBe(120);
  });

  it('should update end_date_time', async () => {
    mockDocClientSend.mockResolvedValueOnce({
      Attributes: { id: 's1', end_date_time: '2025-12-31T00:00:00.000Z' },
    });

    const result = await handler(makeEvent({
      httpMethod: 'PUT',
      pathParameters: { id: 's1' },
      body: JSON.stringify({ end_date_time: '2025-12-31T00:00:00Z' }),
    }));

    expect(result.statusCode).toBe(200);
  });

  it('should return 400 for missing body', async () => {
    const result = await handler(makeEvent({
      httpMethod: 'PUT',
      pathParameters: { id: 's1' },
      body: null,
    }));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe('MISSING_BODY');
  });

  it('should return 400 for invalid interval', async () => {
    const result = await handler(makeEvent({
      httpMethod: 'PUT',
      pathParameters: { id: 's1' },
      body: JSON.stringify({ interval_minutes: -5 }),
    }));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe('INVALID_INTERVAL');
  });

  it('should return 400 when no updates provided', async () => {
    const result = await handler(makeEvent({
      httpMethod: 'PUT',
      pathParameters: { id: 's1' },
      body: JSON.stringify({}),
    }));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe('NO_UPDATES');
  });

  it('should return 404 when schedule not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Attributes: undefined });

    const result = await handler(makeEvent({
      httpMethod: 'PUT',
      pathParameters: { id: 'nonexistent' },
      body: JSON.stringify({ interval_minutes: 60 }),
    }));

    expect(result.statusCode).toBe(404);
  });
});

describe('DELETE /v1/monitoring/schedules/{id}', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should terminate schedule and return updated record', async () => {
    mockDocClientSend.mockResolvedValueOnce({
      Attributes: { id: 's1', status: 'terminated' },
    });

    const result = await handler(makeEvent({
      httpMethod: 'DELETE',
      pathParameters: { id: 's1' },
    }));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).data.status).toBe('terminated');
  });

  it('should return 404 when schedule not found', async () => {
    const err = new Error('Condition not met');
    (err as any).name = 'ConditionalCheckFailedException';
    mockDocClientSend.mockRejectedValueOnce(err);

    const result = await handler(makeEvent({
      httpMethod: 'DELETE',
      pathParameters: { id: 'nonexistent' },
    }));

    expect(result.statusCode).toBe(404);
  });
});

describe('unsupported methods', () => {
  it('should return 405 for POST', async () => {
    const result = await handler(makeEvent({ httpMethod: 'POST' }));
    expect(result.statusCode).toBe(405);
  });
});
