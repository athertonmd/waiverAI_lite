const mockDocClientSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockDocClientSend })) },
  GetCommand: jest.fn((input: unknown) => ({ _type: 'Get', input })),
  PutCommand: jest.fn((input: unknown) => ({ _type: 'Put', input })),
  QueryCommand: jest.fn((input: unknown) => ({ _type: 'Query', input })),
  ScanCommand: jest.fn((input: unknown) => ({ _type: 'Scan', input })),
}));

jest.mock('../redact', () => ({
  redactWaiver: (item: unknown) => item,
  redactWaivers: (items: unknown[]) => items,
}));

jest.mock('../openapi-spec', () => ({
  getOpenApiSpec: () => ({ openapi: '3.0.0' }),
}));

process.env.WAIVERS_TABLE = 'test-waivers';
process.env.WAIVER_VERSIONS_TABLE = 'test-waiver-versions';
process.env.MONITOR_SCHEDULES_TABLE = 'test-monitor-schedules';
process.env.WEB_CONTENT_VERSIONS_TABLE = 'test-web-content-versions';
process.env.SETTINGS_TABLE = 'test-settings';
process.env.WEBHOOK_SUBSCRIPTIONS_TABLE = 'test-webhook-subscriptions';

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../handler';

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/v1/register',
    resource: '/v1/register',
    pathParameters: null,
    queryStringParameters: null,
    body: null,
    headers: {},
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    stageVariables: null,
    isBase64Encoded: false,
    requestContext: {} as APIGatewayProxyEvent['requestContext'],
    ...overrides,
  };
}

describe('POST /v1/register', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 201 with id and pending status on valid registration', async () => {
    // ScanCommand returns no duplicates
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });
    // PutCommand succeeds
    mockDocClientSend.mockResolvedValueOnce({});

    const event = makeEvent({
      body: JSON.stringify({ name: 'Jane Doe', email: 'jane@example.com', company: 'Acme Inc' }),
    });
    const res = await handler(event);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(201);
    expect(body.data.status).toBe('pending');
    expect(body.data.id).toBeDefined();
    expect(typeof body.data.id).toBe('string');
  });

  it('stores correct item in Settings table', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });
    mockDocClientSend.mockResolvedValueOnce({});

    const event = makeEvent({
      body: JSON.stringify({ name: 'Jane Doe', email: 'jane@example.com', company: 'Acme Inc' }),
    });
    await handler(event);

    // Second call is PutCommand
    const putCall = mockDocClientSend.mock.calls[1][0];
    const item = putCall.input.Item;
    expect(item.key).toMatch(/^REG#/);
    expect(item.name).toBe('Jane Doe');
    expect(item.email).toBe('jane@example.com');
    expect(item.company).toBe('Acme Inc');
    expect(item.status).toBe('pending');
    expect(item.createdAt).toBeDefined();
    expect(putCall.input.TableName).toBe('test-settings');
  });

  it('returns 409 when duplicate pending registration exists', async () => {
    mockDocClientSend.mockResolvedValueOnce({
      Items: [{ key: 'REG#existing', email: 'jane@example.com', status: 'pending' }],
    });

    const event = makeEvent({
      body: JSON.stringify({ name: 'Jane Doe', email: 'jane@example.com', company: 'Acme Inc' }),
    });
    const res = await handler(event);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(409);
    expect(body.error.code).toBe('DUPLICATE_REQUEST');
  });

  it('returns 400 when name is missing', async () => {
    const event = makeEvent({
      body: JSON.stringify({ email: 'jane@example.com', company: 'Acme Inc' }),
    });
    const res = await handler(event);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when email is missing', async () => {
    const event = makeEvent({
      body: JSON.stringify({ name: 'Jane Doe', company: 'Acme Inc' }),
    });
    const res = await handler(event);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when company is missing', async () => {
    const event = makeEvent({
      body: JSON.stringify({ name: 'Jane Doe', email: 'jane@example.com' }),
    });
    const res = await handler(event);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid email format', async () => {
    const event = makeEvent({
      body: JSON.stringify({ name: 'Jane Doe', email: 'not-an-email', company: 'Acme Inc' }),
    });
    const res = await handler(event);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
    expect(JSON.parse(res.body).error.message).toContain('email');
  });

  it('returns 400 for invalid JSON body', async () => {
    const event = makeEvent({ body: 'not json' });
    const res = await handler(event);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_BODY');
  });

  it('trims whitespace from input fields', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });
    mockDocClientSend.mockResolvedValueOnce({});

    const event = makeEvent({
      body: JSON.stringify({ name: '  Jane Doe  ', email: '  jane@example.com  ', company: '  Acme Inc  ' }),
    });
    await handler(event);

    const putCall = mockDocClientSend.mock.calls[1][0];
    const item = putCall.input.Item;
    expect(item.name).toBe('Jane Doe');
    expect(item.email).toBe('jane@example.com');
    expect(item.company).toBe('Acme Inc');
  });

  it('includes POST in CORS Allow-Methods header', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });
    mockDocClientSend.mockResolvedValueOnce({});

    const event = makeEvent({
      body: JSON.stringify({ name: 'Jane Doe', email: 'jane@example.com', company: 'Acme Inc' }),
    });
    const res = await handler(event);

    expect(res.headers?.['Access-Control-Allow-Methods']).toContain('POST');
  });
});
