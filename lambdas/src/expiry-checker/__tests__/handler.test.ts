const mockDocClientSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockDocClientSend })) },
  ScanCommand: jest.fn((input: unknown) => ({ _type: 'Scan', input })),
  UpdateCommand: jest.fn((input: unknown) => ({ _type: 'Update', input })),
  GetCommand: jest.fn((input: unknown) => ({ _type: 'Get', input })),
  PutCommand: jest.fn((input: unknown) => ({ _type: 'Put', input })),
}));

jest.mock('../../shared/cache');
jest.mock('../../shared/rules');

process.env.WAIVERS_TABLE = 'test-waivers';
process.env.WAIVER_VERSIONS_TABLE = 'test-waiver-versions';
process.env.MONITOR_SCHEDULES_TABLE = 'test-monitor-schedules';
process.env.WEB_CONTENT_VERSIONS_TABLE = 'test-web-content-versions';
process.env.SETTINGS_TABLE = 'test-settings';
process.env.WEBHOOK_SUBSCRIPTIONS_TABLE = 'test-webhook-subscriptions';

import { handler } from '../handler';
import * as cache from '../../shared/cache';
import { getRule } from '../../shared/rules';

const mockGetRule = getRule as jest.MockedFunction<typeof getRule>;
const mockCacheInvalidate = cache.invalidate as jest.MockedFunction<typeof cache.invalidate>;

describe('expiry-checker handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls cache.invalidate with dashboard:metrics when rule is enabled and waivers are found', async () => {
    mockGetRule.mockResolvedValueOnce({
      key: 'rule:expired_waiver_flagging',
      name: 'Expired Waiver Flagging',
      description: 'Marks active waivers past their expiration date as expired.',
      enabled: true,
      parameters: {},
      condition: '',
      action: '',
      updated_at: '2024-01-01T00:00:00Z',
    });

    // ScanCommand returns expired waivers
    mockDocClientSend.mockResolvedValueOnce({
      Items: [
        { id: 'w-1', status: 'active', expiration_date: '2024-01-01' },
        { id: 'w-2', status: 'active', expiration_date: '2024-01-02' },
      ],
    });

    // UpdateCommand calls for each waiver
    mockDocClientSend.mockResolvedValueOnce({});
    mockDocClientSend.mockResolvedValueOnce({});

    await handler();

    expect(mockCacheInvalidate).toHaveBeenCalledTimes(1);
    expect(mockCacheInvalidate).toHaveBeenCalledWith('dashboard:metrics');
  });

  it('calls cache.invalidate even when no waivers are found (rule enabled)', async () => {
    mockGetRule.mockResolvedValueOnce({
      key: 'rule:expired_waiver_flagging',
      name: 'Expired Waiver Flagging',
      description: 'Marks active waivers past their expiration date as expired.',
      enabled: true,
      parameters: {},
      condition: '',
      action: '',
      updated_at: '2024-01-01T00:00:00Z',
    });

    // ScanCommand returns no items
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });

    await handler();

    expect(mockCacheInvalidate).toHaveBeenCalledTimes(1);
    expect(mockCacheInvalidate).toHaveBeenCalledWith('dashboard:metrics');
  });

  it('does NOT call cache.invalidate when rule is disabled', async () => {
    mockGetRule.mockResolvedValueOnce({
      key: 'rule:expired_waiver_flagging',
      name: 'Expired Waiver Flagging',
      description: 'Marks active waivers past their expiration date as expired.',
      enabled: false,
      parameters: {},
      condition: '',
      action: '',
      updated_at: '2024-01-01T00:00:00Z',
    });

    await handler();

    expect(mockCacheInvalidate).not.toHaveBeenCalled();
    expect(mockDocClientSend).not.toHaveBeenCalled();
  });
});
