// --- Mocks ---

const mockS3Send = jest.fn();
const mockDocClientSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  GetObjectCommand: jest.fn((input: unknown) => ({ input })),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockDocClientSend })) },
  UpdateCommand: jest.fn((input: unknown) => ({ _type: 'Update', input })),
}));

process.env.WAIVERS_TABLE = 'test-waivers';
process.env.WAIVER_VERSIONS_TABLE = 'test-waiver-versions';
process.env.MONITOR_SCHEDULES_TABLE = 'test-monitor-schedules';
process.env.WEB_CONTENT_VERSIONS_TABLE = 'test-web-content-versions';
process.env.SETTINGS_TABLE = 'test-settings';

import { handler, A2iCompletionEvent } from '../complete-review';

describe('complete-review handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const baseEvent: A2iCompletionEvent = {
    humanLoopName: 'waiver-review-rec-001-123',
    humanLoopArn: 'arn:aws:sagemaker:us-east-1:123456789012:human-loop/waiver-review-rec-001-123',
    outputS3Bucket: 'test-bucket',
    outputS3Key: 'a2i-output/waiver-review-rec-001-123/output.json',
  };

  it('approves a waiver and updates corrected fields', async () => {
    const a2iOutput = {
      inputContent: { recordId: 'rec-001' },
      humanAnswers: [
        {
          answerContent: {
            airline_code: 'UA',
            waiver_title: 'Corrected Storm Waiver',
            waiver_code: 'WX-2024',
            effective_date: '2024-01-15',
            expiration_date: '2024-02-28',
            applicable_routes: 'JFK-LAX, ORD-DFW',
            fare_classes: 'Y, B, M',
            rebooking_rules: 'Free rebooking within 14 days',
            refund_rules: 'Full refund',
            decision: 'approved',
          },
        },
      ],
    };

    mockS3Send.mockResolvedValue({
      Body: { transformToString: () => Promise.resolve(JSON.stringify(a2iOutput)) },
    });
    mockDocClientSend.mockResolvedValue({});

    const result = await handler(baseEvent);

    expect(result.recordId).toBe('rec-001');
    expect(result.status).toBe('active');
    expect(result.updated).toBe(true);

    expect(mockDocClientSend).toHaveBeenCalledTimes(1);
    const updateCall = mockDocClientSend.mock.calls[0][0];
    expect(updateCall.input.UpdateExpression).toContain('#s = :status');
    expect(updateCall.input.ExpressionAttributeValues[':status']).toBe('active');
  });

  it('rejects a waiver with a reason', async () => {
    const a2iOutput = {
      inputContent: { recordId: 'rec-002' },
      humanAnswers: [
        {
          answerContent: {
            decision: 'rejected',
            rejection_reason: 'Data is outdated',
          },
        },
      ],
    };

    mockS3Send.mockResolvedValue({
      Body: { transformToString: () => Promise.resolve(JSON.stringify(a2iOutput)) },
    });
    mockDocClientSend.mockResolvedValue({});

    const result = await handler(baseEvent);

    expect(result.recordId).toBe('rec-002');
    expect(result.status).toBe('rejected');
    expect(result.updated).toBe(true);

    const updateCall = mockDocClientSend.mock.calls[0][0];
    expect(updateCall.input.UpdateExpression).toContain('rejection_reason');
    expect(updateCall.input.ExpressionAttributeValues[':status']).toBe('rejected');
    expect(updateCall.input.ExpressionAttributeValues[':rr']).toBe('Data is outdated');
  });

  it('throws when recordId is missing from A2I output', async () => {
    const a2iOutput = {
      inputContent: {},
      humanAnswers: [{ answerContent: { decision: 'approved' } }],
    };

    mockS3Send.mockResolvedValue({
      Body: { transformToString: () => Promise.resolve(JSON.stringify(a2iOutput)) },
    });

    await expect(handler(baseEvent)).rejects.toThrow('Cannot determine recordId');
  });

  it('defaults to approved when no decision is provided', async () => {
    const a2iOutput = {
      inputContent: { recordId: 'rec-003' },
      humanAnswers: [{ answerContent: {} }],
    };

    mockS3Send.mockResolvedValue({
      Body: { transformToString: () => Promise.resolve(JSON.stringify(a2iOutput)) },
    });
    mockDocClientSend.mockResolvedValue({});

    const result = await handler(baseEvent);

    expect(result.status).toBe('active');
  });
});
