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
  UpdateCommand: jest.fn((input: unknown) => ({ _type: 'Update', input })),
  DeleteCommand: jest.fn((input: unknown) => ({ _type: 'Delete', input })),
}));

jest.mock('../../webhooks/dispatcher', () => ({
  dispatchWebhook: jest.fn().mockResolvedValue(undefined),
}));

process.env.WAIVERS_TABLE = 'test-waivers';
process.env.WAIVER_VERSIONS_TABLE = 'test-waiver-versions';
process.env.MONITOR_SCHEDULES_TABLE = 'test-monitor-schedules';
process.env.WEB_CONTENT_VERSIONS_TABLE = 'test-web-content-versions';
process.env.SETTINGS_TABLE = 'test-settings';
process.env.WEBHOOK_SUBSCRIPTIONS_TABLE = 'test-webhook-subscriptions';

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler, extractRole, isAuthorized } from '../handler';
import * as cache from '../../shared/cache';

afterEach(() => {
  cache.invalidate('dashboard:metrics');
  cache.invalidate('waivers:active');
  cache.invalidate('settings:threshold');
});

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/v1/waivers',
    resource: '/v1/waivers',
    pathParameters: null,
    queryStringParameters: null,
    body: null,
    headers: {},
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    stageVariables: null,
    isBase64Encoded: false,
    requestContext: {
      authorizer: {
        claims: { 'cognito:groups': 'user' },
      },
    } as unknown as APIGatewayProxyEvent['requestContext'],
    ...overrides,
  };
}

function setRole(event: APIGatewayProxyEvent, role: string): APIGatewayProxyEvent {
  return {
    ...event,
    requestContext: {
      ...event.requestContext,
      authorizer: { claims: { 'cognito:groups': role } },
    } as unknown as APIGatewayProxyEvent['requestContext'],
  };
}


describe('extractRole', () => {
  it('returns admin when groups include admin', () => {
    const event = makeEvent();
    const e = setRole(event, 'user,admin');
    expect(extractRole(e)).toBe('admin');
  });

  it('returns user when groups include user but not admin', () => {
    const event = makeEvent();
    const e = setRole(event, 'user');
    expect(extractRole(e)).toBe('user');
  });

  it('returns admin when both admin and user groups present', () => {
    const event = makeEvent();
    const e = setRole(event, 'admin,user');
    expect(extractRole(e)).toBe('admin');
  });

  it('returns null when no groups', () => {
    const event = makeEvent();
    const e = setRole(event, '');
    expect(extractRole(e)).toBeNull();
  });

  it('returns null for unrecognized groups', () => {
    const event = makeEvent();
    const e = setRole(event, 'reviewer,api_consumer');
    expect(extractRole(e)).toBeNull();
  });

  it('handles mixed case groups', () => {
    const event = makeEvent();
    const e = setRole(event, 'Admin');
    expect(extractRole(e)).toBe('admin');
  });
});

describe('isAuthorized', () => {
  it('allows admin GET on any path', () => {
    expect(isAuthorized('admin', 'GET', '/v1/waivers')).toBe(true);
  });

  it('allows admin POST on any path', () => {
    expect(isAuthorized('admin', 'POST', '/v1/waivers/123/approve')).toBe(true);
  });

  it('allows admin DELETE on any path', () => {
    expect(isAuthorized('admin', 'DELETE', '/v1/monitoring/schedules/1')).toBe(true);
  });

  it('allows user GET on allowed paths', () => {
    expect(isAuthorized('user', 'GET', '/v1/waivers')).toBe(true);
    expect(isAuthorized('user', 'GET', '/v1/waivers/abc-123')).toBe(true);
    expect(isAuthorized('user', 'GET', '/v1/dashboard/metrics')).toBe(true);
    expect(isAuthorized('user', 'GET', '/v1/reports')).toBe(true);
    expect(isAuthorized('user', 'GET', '/v1/settings/extraction-fields')).toBe(true);
  });

  it('denies user GET on disallowed paths', () => {
    expect(isAuthorized('user', 'GET', '/v1/settings/threshold')).toBe(false);
    expect(isAuthorized('user', 'GET', '/v1/monitoring/schedules')).toBe(false);
    expect(isAuthorized('user', 'GET', '/v1/webhooks')).toBe(false);
  });

  it('denies user POST/PUT/DELETE on any path', () => {
    expect(isAuthorized('user', 'POST', '/v1/waivers/123/approve')).toBe(false);
    expect(isAuthorized('user', 'PUT', '/v1/waivers/123/draft')).toBe(false);
    expect(isAuthorized('user', 'DELETE', '/v1/monitoring/schedules/1')).toBe(false);
  });

  it('denies null role', () => {
    expect(isAuthorized(null, 'GET', '/v1/waivers')).toBe(false);
  });
});

describe('GET /v1/waivers — pagination', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns default page=1, pageSize=20', async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      id: `w-${i}`,
      created_at: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    }));
    mockDocClientSend.mockResolvedValueOnce({ Items: items, LastEvaluatedKey: undefined });

    const res = await handler(makeEvent());
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.pagination).toEqual({ page: 1, pageSize: 20, totalCount: 50, totalPages: 3 });
    expect(body.data).toHaveLength(20);
  });

  it('clamps pageSize to max 100', async () => {
    const items = Array.from({ length: 200 }, (_, i) => ({
      id: `w-${i}`,
      created_at: `2024-01-01T00:00:00Z`,
    }));
    mockDocClientSend.mockResolvedValueOnce({ Items: items, LastEvaluatedKey: undefined });

    const event = makeEvent({ queryStringParameters: { pageSize: '500' } });
    const res = await handler(event);
    const body = JSON.parse(res.body);

    expect(body.pagination.pageSize).toBe(100);
  });

  it('supports custom page and pageSize', async () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      id: `w-${i}`,
      created_at: `2024-01-01T00:00:00Z`,
    }));
    mockDocClientSend.mockResolvedValueOnce({ Items: items, LastEvaluatedKey: undefined });

    const event = makeEvent({ queryStringParameters: { page: '3', pageSize: '10' } });
    const res = await handler(event);
    const body = JSON.parse(res.body);

    expect(body.pagination).toEqual({ page: 3, pageSize: 10, totalCount: 100, totalPages: 10 });
  });
});

describe('GET /v1/waivers/{id}', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns waiver when found', async () => {
    const waiver = { id: 'abc-123', airline_code: 'AA' };
    mockDocClientSend.mockResolvedValueOnce({ Item: waiver });

    const event = makeEvent({
      path: '/v1/waivers/abc-123',
      resource: '/v1/waivers/{id}',
      pathParameters: { id: 'abc-123' },
    });
    const res = await handler(event);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.data).toEqual(waiver);
  });

  it('returns 404 for non-existent ID', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const event = makeEvent({
      path: '/v1/waivers/nonexistent',
      resource: '/v1/waivers/{id}',
      pathParameters: { id: 'nonexistent' },
    });
    const res = await handler(event);

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND');
  });
});

describe('GET /v1/waivers/active', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns active waivers with future expiration', async () => {
    const waivers = [{ id: '1', status: 'active' }];
    mockDocClientSend.mockResolvedValueOnce({ Items: waivers });

    const event = makeEvent({ path: '/v1/waivers/active', resource: '/v1/waivers/active' });
    const res = await handler(event);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.data).toEqual(waivers);
  });
});

describe('GET /v1/waivers/search', () => {
  beforeEach(() => jest.clearAllMocks());

  it('filters by airline', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    const event = makeEvent({
      path: '/v1/waivers/search',
      resource: '/v1/waivers/search',
      queryStringParameters: { airline: 'UA' },
    });
    const res = await handler(event);

    expect(res.statusCode).toBe(200);
    const scanCall = mockDocClientSend.mock.calls[0][0];
    expect(scanCall.input.FilterExpression).toContain('airline_code = :airline');
    expect(scanCall.input.ExpressionAttributeValues[':airline']).toBe('UA');
  });

  it('filters by multiple criteria', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    const event = makeEvent({
      path: '/v1/waivers/search',
      resource: '/v1/waivers/search',
      queryStringParameters: {
        airline: 'AA',
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31',
        status: 'active',
      },
    });
    const res = await handler(event);

    expect(res.statusCode).toBe(200);
    const scanCall = mockDocClientSend.mock.calls[0][0];
    expect(scanCall.input.FilterExpression).toContain('airline_code = :airline');
    expect(scanCall.input.FilterExpression).toContain('effective_date >= :dateFrom');
    expect(scanCall.input.FilterExpression).toContain('expiration_date <= :dateTo');
    expect(scanCall.input.FilterExpression).toContain('#s = :status');
  });
});


describe('POST /v1/waivers/{id}/approve', () => {
  beforeEach(() => jest.clearAllMocks());

  it('approves an existing waiver', async () => {
    // GetCommand returns existing item
    mockDocClientSend.mockResolvedValueOnce({ Item: { id: 'w-1' } });
    // UpdateCommand
    mockDocClientSend.mockResolvedValueOnce({});

    const event = setRole(
      makeEvent({
        httpMethod: 'POST',
        path: '/v1/waivers/w-1/approve',
        resource: '/v1/waivers/{id}/approve',
        pathParameters: { id: 'w-1' },
      }),
      'admin',
    );
    const res = await handler(event);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.data.status).toBe('active');
  });

  it('returns 404 for non-existent waiver', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const event = setRole(
      makeEvent({
        httpMethod: 'POST',
        path: '/v1/waivers/nope/approve',
        resource: '/v1/waivers/{id}/approve',
        pathParameters: { id: 'nope' },
      }),
      'admin',
    );
    const res = await handler(event);
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /v1/waivers/{id}/reject', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects with reason', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { id: 'w-2' } });
    mockDocClientSend.mockResolvedValueOnce({});

    const event = setRole(
      makeEvent({
        httpMethod: 'POST',
        path: '/v1/waivers/w-2/reject',
        resource: '/v1/waivers/{id}/reject',
        pathParameters: { id: 'w-2' },
        body: JSON.stringify({ reason: 'Incorrect dates' }),
      }),
      'admin',
    );
    const res = await handler(event);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.data.status).toBe('rejected');
    expect(body.data.rejection_reason).toBe('Incorrect dates');
  });
});

describe('PUT /v1/waivers/{id}/draft', () => {
  beforeEach(() => jest.clearAllMocks());

  it('saves draft edits without status change', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { id: 'w-3' } });
    mockDocClientSend.mockResolvedValueOnce({});

    const event = setRole(
      makeEvent({
        httpMethod: 'PUT',
        path: '/v1/waivers/w-3/draft',
        resource: '/v1/waivers/{id}/draft',
        pathParameters: { id: 'w-3' },
        body: JSON.stringify({ waiver_title: 'Updated Title', rebooking_rules: 'New rules' }),
      }),
      'admin',
    );
    const res = await handler(event);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.data.message).toBe('Draft saved');
    // saveDraft now makes 3 DDB calls: GetItem (waiver), GetItem (schema), UpdateItem
    const updateCall = mockDocClientSend.mock.calls[2][0];
    // Field names are now in ExpressionAttributeNames (dynamic schema uses aliases)
    const attrNames = updateCall.input.ExpressionAttributeNames;
    const nameValues = Object.values(attrNames) as string[];
    expect(nameValues).toContain('waiver_title');
    expect(nameValues).toContain('rebooking_rules');
    expect(updateCall.input.UpdateExpression).not.toContain('status');
  });
});

describe('GET /v1/dashboard/metrics', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns dashboard metrics with correct shape', async () => {
    const items = [
      {
        id: '1', waiver_code: 'WX-001', airline_code: 'AA', status: 'active',
        overall_confidence: 0.82, ingestion_timestamp: '2024-01-15T10:00:00Z',
      },
      {
        id: '2', waiver_code: 'WX-002', airline_code: 'UA', status: 'pending_review',
        overall_confidence: 0.82, ingestion_timestamp: '2024-01-15T11:00:00Z',
      },
    ];
    mockDocClientSend.mockResolvedValueOnce({ Items: items, LastEvaluatedKey: undefined });

    const event = setRole(
      makeEvent({
        path: '/v1/dashboard/metrics',
        resource: '/v1/dashboard/metrics',
      }),
      'admin',
    );
    const res = await handler(event);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.data).toHaveProperty('activeWaivers');
    expect(body.data).toHaveProperty('processedToday');
    expect(body.data).toHaveProperty('pendingReview');
    expect(body.data).toHaveProperty('averageConfidence');
    expect(body.data).toHaveProperty('ingestionVolume');
    expect(body.data).toHaveProperty('airlineDistribution');
    expect(body.data).toHaveProperty('recentWaivers');
  });
});

describe('GET /v1/settings/threshold', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns threshold when setting exists', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { key: 'confidence_threshold', value: '0.85' } });

    const event = setRole(
      makeEvent({ path: '/v1/settings/threshold', resource: '/v1/settings/threshold' }),
      'admin',
    );
    const res = await handler(event);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.data.threshold).toBe(0.85);
  });

  it('returns 0.85 when no setting exists', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const event = setRole(
      makeEvent({ path: '/v1/settings/threshold', resource: '/v1/settings/threshold' }),
      'admin',
    );
    const res = await handler(event);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.data.threshold).toBe(0.85);
  });
});

describe('PUT /v1/settings/threshold', () => {
  beforeEach(() => jest.clearAllMocks());

  it('updates threshold for admin', async () => {
    mockDocClientSend.mockResolvedValueOnce({});

    const event = setRole(
      makeEvent({
        httpMethod: 'PUT',
        path: '/v1/settings/threshold',
        resource: '/v1/settings/threshold',
        body: JSON.stringify({ threshold: 0.9 }),
      }),
      'admin',
    );
    const res = await handler(event);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.data.threshold).toBe(0.9);
  });

  it('rejects invalid threshold', async () => {
    const event = setRole(
      makeEvent({
        httpMethod: 'PUT',
        path: '/v1/settings/threshold',
        resource: '/v1/settings/threshold',
        body: JSON.stringify({ threshold: 1.5 }),
      }),
      'admin',
    );
    const res = await handler(event);
    expect(res.statusCode).toBe(400);
  });

  it('returns 403 for non-admin', async () => {
    const event = setRole(
      makeEvent({
        httpMethod: 'PUT',
        path: '/v1/settings/threshold',
        resource: '/v1/settings/threshold',
        body: JSON.stringify({ threshold: 0.7 }),
      }),
      'user',
    );
    const res = await handler(event);
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /v1/waivers/{id}/versions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns version history for existing waiver', async () => {
    const versions = [
      { waiver_id: 'w-1', version_number: 1, data: '{}', changed_at: '2024-01-01' },
    ];
    // GetCommand for waiver existence check
    mockDocClientSend.mockResolvedValueOnce({ Item: { id: 'w-1' } });
    // QueryCommand for versions
    mockDocClientSend.mockResolvedValueOnce({ Items: versions });

    const event = setRole(
      makeEvent({
        path: '/v1/waivers/w-1/versions',
        resource: '/v1/waivers/{id}/versions',
        pathParameters: { id: 'w-1' },
      }),
      'admin',
    );
    const res = await handler(event);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.data).toEqual(versions);
  });

  it('returns 404 for non-existent waiver', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const event = setRole(
      makeEvent({
        path: '/v1/waivers/nope/versions',
        resource: '/v1/waivers/{id}/versions',
        pathParameters: { id: 'nope' },
      }),
      'admin',
    );
    const res = await handler(event);
    expect(res.statusCode).toBe(404);
  });
});

describe('RBAC enforcement', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 403 for user trying to approve', async () => {
    const event = makeEvent({
      httpMethod: 'POST',
      path: '/v1/waivers/w-1/approve',
      resource: '/v1/waivers/{id}/approve',
      pathParameters: { id: 'w-1' },
    });
    const res = await handler(event);

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('FORBIDDEN');
  });

  it('returns 403 for user trying to reject', async () => {
    const event = makeEvent({
      httpMethod: 'POST',
      path: '/v1/waivers/w-1/reject',
      resource: '/v1/waivers/{id}/reject',
      pathParameters: { id: 'w-1' },
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 for user trying to save draft', async () => {
    const event = makeEvent({
      httpMethod: 'PUT',
      path: '/v1/waivers/w-1/draft',
      resource: '/v1/waivers/{id}/draft',
      pathParameters: { id: 'w-1' },
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 when no cognito groups present', async () => {
    const event = setRole(makeEvent(), '');
    const res = await handler(event);
    expect(res.statusCode).toBe(403);
  });

  it('allows user to GET waivers', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
  });

  it('returns 403 for user GET on disallowed path', async () => {
    const event = makeEvent({
      path: '/v1/settings/threshold',
      resource: '/v1/settings/threshold',
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(403);
  });
});