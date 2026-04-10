const mockS3Send = jest.fn();
const mockDocClientSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  GetObjectCommand: jest.fn((input: unknown) => ({ _type: 'GetObject', input })),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockDocClientSend })) },
  GetCommand: jest.fn((input: unknown) => ({ _type: 'Get', input })),
  PutCommand: jest.fn((input: unknown) => ({ _type: 'Put', input })),
  QueryCommand: jest.fn((input: unknown) => ({ _type: 'Query', input })),
  UpdateCommand: jest.fn((input: unknown) => ({ _type: 'Update', input })),
}));

process.env.INGESTION_BUCKET = 'test-bucket';
process.env.WAIVERS_TABLE = 'test-waivers';
process.env.WAIVER_VERSIONS_TABLE = 'test-waiver-versions';
process.env.MONITOR_SCHEDULES_TABLE = 'test-monitor-schedules';
process.env.WEB_CONTENT_VERSIONS_TABLE = 'test-web-content-versions';
process.env.SETTINGS_TABLE = 'test-settings';
process.env.WEBHOOK_SUBSCRIPTIONS_TABLE = 'test-webhook-subscriptions';

jest.mock('../../webhooks/dispatcher', () => ({
  dispatchWebhook: jest.fn().mockResolvedValue(undefined),
}));

import { handler, snapshotExistingVersion, upsertWaiver, StoreEvent } from '../handler';

const SAMPLE_RECORD = {
  id: 'waiver-001',
  airline_code: 'AA',
  waiver_title: 'Winter Storm Waiver',
  waiver_code: 'WX-2024-001',
  effective_date: '2024-01-15',
  expiration_date: '2024-02-15',
  applicable_routes: ['JFK-LAX'],
  fare_classes: ['Y', 'B'],
  rebooking_rules: 'Free rebooking within 14 days',
  refund_rules: 'Full refund',
  confidence_scores: { airline_code: 0.95, waiver_title: 0.88 },
  overall_confidence: 0.88,
  source_type: 'email',
  source_s3_key: 'raw/email/msg-001',
  normalized_s3_key: 'normalized/email/msg-001.txt',
  ingestion_timestamp: '2024-01-15T10:00:00Z',
  extraction_timestamp: '2024-01-15T10:01:00Z',
  version_number: 1,
};

function makeEvent(overrides: Partial<StoreEvent> = {}): StoreEvent {
  return {
    extractedS3Key: 'extracted/waiver-001.json',
    recordId: 'waiver-001',
    overallConfidence: 0.88,
    status: 'auto_approved',
    ...overrides,
  };
}

function mockS3GetRecord(record: Record<string, unknown> = SAMPLE_RECORD) {
  mockS3Send.mockResolvedValue({
    Body: { transformToString: () => Promise.resolve(JSON.stringify(record)) },
  });
}

describe('snapshotExistingVersion', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should save to WaiverVersions when existing record found via GSI query', async () => {
    const existingRow = { id: 'waiver-001', version_number: 2, airline_code: 'AA' };
    // Query on airline_code-index returns existing item
    mockDocClientSend.mockResolvedValueOnce({ Items: [existingRow] });
    // PutCommand to waiver_versions
    mockDocClientSend.mockResolvedValueOnce({});

    const result = await snapshotExistingVersion(SAMPLE_RECORD);

    expect(result).toEqual({ existingId: 'waiver-001', existingVersionNumber: 2 });
    expect(mockDocClientSend).toHaveBeenCalledTimes(2);
  });

  it('should return null when no existing record', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });

    const result = await snapshotExistingVersion(SAMPLE_RECORD);

    expect(result).toBeNull();
    expect(mockDocClientSend).toHaveBeenCalledTimes(1);
  });

  it('should use reviewer_id as changed_by when present', async () => {
    const existingRow = { id: 'waiver-001', version_number: 1 };
    mockDocClientSend.mockResolvedValueOnce({ Items: [existingRow] });
    mockDocClientSend.mockResolvedValueOnce({});

    await snapshotExistingVersion({ ...SAMPLE_RECORD, reviewer_id: 'reviewer-42' });

    // The PutCommand call should include reviewer-42 as changed_by
    const putCall = mockDocClientSend.mock.calls[1][0];
    expect(putCall.input.Item.changed_by).toBe('reviewer-42');
  });
});

describe('upsertWaiver', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should put item with correct fields for new record', async () => {
    mockDocClientSend.mockResolvedValueOnce({});

    await upsertWaiver(SAMPLE_RECORD, 'auto_approved', null);

    expect(mockDocClientSend).toHaveBeenCalledTimes(1);
    const putCall = mockDocClientSend.mock.calls[0][0];
    expect(putCall.input.Item.id).toBe('waiver-001');
    expect(putCall.input.Item.airline_code).toBe('AA');
    expect(putCall.input.Item.status).toBe('auto_approved');
    expect(putCall.input.Item.version_number).toBe(1);
  });

  it('should increment version_number for existing record', async () => {
    mockDocClientSend.mockResolvedValueOnce({});

    await upsertWaiver(SAMPLE_RECORD, 'auto_approved', { existingId: 'waiver-001', existingVersionNumber: 2 });

    const putCall = mockDocClientSend.mock.calls[0][0];
    expect(putCall.input.Item.version_number).toBe(3);
  });
});

describe('handler (integration)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should store a new record (no existing version)', async () => {
    mockS3GetRecord();
    // QueryCommand for duplicate detection (no match)
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });
    // PutCommand for the new record
    mockDocClientSend.mockResolvedValueOnce({});

    const result = await handler(makeEvent());

    expect(result).toEqual({ recordId: 'waiver-001', status: 'auto_approved', stored: true });
    expect(mockDocClientSend).toHaveBeenCalledTimes(2);
    // Verify the PutItem includes duplicate fields
    const putCall = mockDocClientSend.mock.calls[1][0];
    expect(putCall.input.Item.is_duplicate).toBe(false);
    expect(putCall.input.Item.duplicate_of_id).toBeNull();
  });

  it('should archive existing version before upserting updated record', async () => {
    mockS3GetRecord();
    // QueryCommand for duplicate detection (no match)
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });
    // PutCommand for the new record
    mockDocClientSend.mockResolvedValueOnce({});

    const result = await handler(makeEvent());

    expect(result.stored).toBe(true);
    expect(mockDocClientSend).toHaveBeenCalledTimes(2);
  });

  it('should handle pending_review status', async () => {
    mockS3GetRecord();
    // QueryCommand for duplicate detection (no match)
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });
    mockDocClientSend.mockResolvedValueOnce({});

    const result = await handler(makeEvent({ status: 'pending_review' }));

    expect(result.status).toBe('pending_review');
    const putCall = mockDocClientSend.mock.calls[1][0];
    expect(putCall.input.Item.status).toBe('pending_review');
  });

  it('should flag record as duplicate when match found', async () => {
    mockS3GetRecord();
    // QueryCommand for duplicate detection (match found)
    mockDocClientSend.mockResolvedValueOnce({
      Items: [{ id: 'original-001', created_at: '2024-01-01T00:00:00Z' }],
    });
    // PutCommand for the new record
    mockDocClientSend.mockResolvedValueOnce({});

    const result = await handler(makeEvent());

    expect(result.stored).toBe(true);
    const putCall = mockDocClientSend.mock.calls[1][0];
    expect(putCall.input.Item.is_duplicate).toBe(true);
    expect(putCall.input.Item.duplicate_of_id).toBe('original-001');
  });
});
