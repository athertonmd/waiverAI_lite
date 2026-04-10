// Mock S3 client
const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  PutObjectCommand: jest.fn((input: unknown) => ({ _type: 'PutObject', input })),
}));

// Mock DynamoDB
const mockDocClientSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockDocClientSend })) },
  GetCommand: jest.fn((input: unknown) => ({ _type: 'Get', input })),
  PutCommand: jest.fn((input: unknown) => ({ _type: 'Put', input })),
  UpdateCommand: jest.fn((input: unknown) => ({ _type: 'Update', input })),
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

process.env.INGESTION_BUCKET = 'test-bucket';
process.env.WAIVERS_TABLE = 'test-waivers';
process.env.WAIVER_VERSIONS_TABLE = 'test-waiver-versions';
process.env.MONITOR_SCHEDULES_TABLE = 'test-monitor-schedules';
process.env.WEB_CONTENT_VERSIONS_TABLE = 'test-web-content-versions';
process.env.SETTINGS_TABLE = 'test-settings';

import { handler, computeContentHash } from '../scheduler-handler';

describe('computeContentHash', () => {
  it('should return a 64-char hex SHA-256 hash', () => {
    const hash = computeContentHash('<html>hello</html>');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should return different hashes for different content', () => {
    const h1 = computeContentHash('content A');
    const h2 = computeContentHash('content B');
    expect(h1).not.toBe(h2);
  });

  it('should return same hash for same content', () => {
    const h1 = computeContentHash('same content');
    const h2 = computeContentHash('same content');
    expect(h1).toBe(h2);
  });
});

describe('scheduler handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockS3Send.mockResolvedValue({});
  });

  it('should return error when scheduleId is missing', async () => {
    const result = await handler({ scheduleId: '' });
    expect(result).toHaveProperty('error');
    expect((result as any).error.code).toBe('MISSING_ID');
  });

  it('should return error when schedule not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });
    const result = await handler({ scheduleId: 'non-existent-id' });
    expect(result).toHaveProperty('error');
    expect((result as any).error.code).toBe('NOT_FOUND');
  });

  it('should skip non-active schedules', async () => {
    mockDocClientSend.mockResolvedValueOnce({
      Item: {
        id: 's1', url: 'https://example.com', url_hash: 'abc', status: 'paused',
        end_date_time: '2099-01-01T00:00:00Z', failure_count: 0, last_content_hash: null,
      },
    });

    const result = await handler({ scheduleId: 's1' });
    expect(result).toHaveProperty('reason');
    expect((result as any).reason).toContain('paused');
  });

  it('should complete schedule when end date is reached', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({
        Item: {
          id: 's1', url: 'https://example.com', url_hash: 'abc', status: 'active',
          end_date_time: '2020-01-01T00:00:00Z', failure_count: 0, last_content_hash: null,
        },
      })
      .mockResolvedValueOnce({}); // UpdateCommand

    const result = await handler({ scheduleId: 's1' });
    expect(result).toHaveProperty('reason');
    expect((result as any).reason).toContain('completed');
    expect(mockDocClientSend).toHaveBeenCalledTimes(2);
  });

  it('should detect change when content hash differs from last', async () => {
    const html = '<html><body>New content</body></html>';
    const oldHash = 'oldhash1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

    mockDocClientSend
      .mockResolvedValueOnce({
        Item: {
          id: 's1', url: 'https://example.com', url_hash: 'abc123', status: 'active',
          end_date_time: '2099-01-01T00:00:00Z', failure_count: 0, last_content_hash: oldHash,
        },
      })
      .mockResolvedValueOnce({}) // PutCommand web_content_versions
      .mockResolvedValueOnce({}); // UpdateCommand monitor_schedules

    mockFetch.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve(html) });

    const result = await handler({ scheduleId: 's1' });
    expect((result as any).changeDetected).toBe(true);
    expect((result as any).contentHash).toBe(computeContentHash(html));
  });

  it('should detect no change when content hash matches', async () => {
    const html = '<html><body>Same content</body></html>';
    const contentHash = computeContentHash(html);

    mockDocClientSend
      .mockResolvedValueOnce({
        Item: {
          id: 's1', url: 'https://example.com', url_hash: 'abc123', status: 'active',
          end_date_time: '2099-01-01T00:00:00Z', failure_count: 0, last_content_hash: contentHash,
        },
      })
      .mockResolvedValueOnce({}) // PutCommand web_content_versions
      .mockResolvedValueOnce({}); // UpdateCommand monitor_schedules

    mockFetch.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve(html) });

    const result = await handler({ scheduleId: 's1' });
    expect((result as any).changeDetected).toBe(false);
  });

  it('should increment failure count on fetch error', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({
        Item: {
          id: 's1', url: 'https://example.com', url_hash: 'abc123', status: 'active',
          end_date_time: '2099-01-01T00:00:00Z', failure_count: 2, last_content_hash: null,
        },
      })
      .mockResolvedValueOnce({}); // UpdateCommand

    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await handler({ scheduleId: 's1' });
    expect(result).toHaveProperty('error');
    expect((result as any).error.code).toBe('FETCH_FAILED');
    // failure_count should be incremented to 3
    const updateCall = mockDocClientSend.mock.calls[1][0];
    expect(updateCall.input.ExpressionAttributeValues[':fc']).toBe(3);
  });

  it('should pause schedule when failure threshold is exceeded', async () => {
    process.env.FAILURE_THRESHOLD = '3';

    mockDocClientSend
      .mockResolvedValueOnce({
        Item: {
          id: 's1', url: 'https://example.com', url_hash: 'abc123', status: 'active',
          end_date_time: '2099-01-01T00:00:00Z', failure_count: 2, last_content_hash: null,
        },
      })
      .mockResolvedValueOnce({}); // UpdateCommand with paused status

    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await handler({ scheduleId: 's1' });
    expect(result).toHaveProperty('error');
    const updateCall = mockDocClientSend.mock.calls[1][0];
    expect(updateCall.input.ExpressionAttributeValues[':status']).toBe('paused');

    delete process.env.FAILURE_THRESHOLD;
  });
});
