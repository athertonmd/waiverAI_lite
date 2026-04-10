// --- Mocks ---

const mockA2iSend = jest.fn();
const mockS3Send = jest.fn();
const mockDocClientSend = jest.fn();

jest.mock('@aws-sdk/client-sagemaker-a2i-runtime', () => ({
  SageMakerA2IRuntimeClient: jest.fn(() => ({ send: mockA2iSend })),
  StartHumanLoopCommand: jest.fn((input: unknown) => ({ input })),
}));

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

process.env.FLOW_DEFINITION_ARN = 'arn:aws:sagemaker:us-east-1:123456789012:flow-definition/waiver-review-flow';
process.env.INGESTION_BUCKET = 'test-bucket';
process.env.WAIVERS_TABLE = 'test-waivers';
process.env.WAIVER_VERSIONS_TABLE = 'test-waiver-versions';
process.env.MONITOR_SCHEDULES_TABLE = 'test-monitor-schedules';
process.env.WEB_CONTENT_VERSIONS_TABLE = 'test-web-content-versions';
process.env.SETTINGS_TABLE = 'test-settings';

import { handler, StartReviewEvent } from '../start-review';

describe('start-review handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const baseEvent: StartReviewEvent = {
    recordId: 'rec-001',
    extractedS3Key: 'extracted/rec-001.json',
    overallConfidence: 0.65,
  };

  const extractedData = {
    airline_code: 'AA',
    waiver_title: 'Storm Waiver',
    waiver_code: 'WX-2024',
    effective_date: '2024-01-15',
    expiration_date: '2024-02-15',
    applicable_routes: ['JFK-LAX', 'ORD-DFW'],
    fare_classes: ['Y', 'B'],
    rebooking_rules: 'Free rebooking',
    refund_rules: 'Full refund',
  };

  it('starts a human loop and stores the ARN in the database', async () => {
    mockS3Send.mockResolvedValue({
      Body: { transformToString: () => Promise.resolve(JSON.stringify(extractedData)) },
    });
    mockA2iSend.mockResolvedValue({
      HumanLoopArn: 'arn:aws:sagemaker:us-east-1:123456789012:human-loop/waiver-review-rec-001-123',
    });
    mockDocClientSend.mockResolvedValue({});

    const result = await handler(baseEvent);

    expect(result.recordId).toBe('rec-001');
    expect(result.humanLoopArn).toBe(
      'arn:aws:sagemaker:us-east-1:123456789012:human-loop/waiver-review-rec-001-123',
    );
    expect(result.humanLoopName).toMatch(/^waiver-review-rec-001-/);

    // Verify DynamoDB update was called with the human loop ARN
    expect(mockDocClientSend).toHaveBeenCalledTimes(1);
    const updateCall = mockDocClientSend.mock.calls[0][0];
    expect(updateCall.input.UpdateExpression).toContain('human_loop_arn');
    expect(updateCall.input.ExpressionAttributeValues[':arn']).toBe(
      'arn:aws:sagemaker:us-east-1:123456789012:human-loop/waiver-review-rec-001-123',
    );
  });

  it('handles missing HumanLoopArn gracefully', async () => {
    mockS3Send.mockResolvedValue({
      Body: { transformToString: () => Promise.resolve(JSON.stringify(extractedData)) },
    });
    mockA2iSend.mockResolvedValue({});
    mockDocClientSend.mockResolvedValue({});

    const result = await handler(baseEvent);

    expect(result.humanLoopArn).toBe('');
  });
});
