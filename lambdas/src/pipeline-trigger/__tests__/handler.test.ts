/**
 * Bug Condition Exploration Tests 1b & 1c: Pipeline-trigger misfiring
 *
 * Test 1b: Pipeline-trigger receives a `.txt` file upload at `raw/web/{id}/{timestamp}.txt`
 * with `render-method: browser-capture` metadata — verify it is SKIPPED (demonstrates wrong behaviour).
 * The EXPECTED (fixed) behavior is that browser-capture .txt files SHOULD trigger the pipeline.
 *
 * Test 1c: Pipeline-trigger receives a `.html` file upload at `raw/web/{id}/{timestamp}.html`
 * with `render-method: browser-capture` metadata — verify it FIRES (demonstrates wrong behaviour).
 * The EXPECTED (fixed) behavior is that browser-capture .html files SHOULD be skipped.
 *
 * EXPECTED: These tests FAIL on unfixed code — failure confirms the bug exists.
 *
 * **Validates: Requirements 1.2, 1.3, 1.4**
 */

const mockSfnSend = jest.fn();
const mockS3Send = jest.fn();

jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn(() => ({ send: mockSfnSend })),
  StartExecutionCommand: jest.fn((input: unknown) => ({ _type: 'StartExecution', input })),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  HeadObjectCommand: jest.fn((input: unknown) => ({ _type: 'HeadObject', input })),
}));

jest.mock('node:crypto', () => ({
  randomUUID: () => 'test-uuid-1234',
}));

jest.mock('../../email-processor/notification', () => ({
  sendArrivalNotification: jest.fn().mockResolvedValue(undefined),
}));

process.env.STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789:stateMachine:waiver-pipeline';

import { handler } from '../handler';
import { S3Event } from 'aws-lambda';

function makeS3Event(key: string, bucket = 'test-bucket'): S3Event {
  return {
    Records: [{
      eventVersion: '2.1',
      eventSource: 'aws:s3',
      awsRegion: 'us-east-1',
      eventTime: '2024-01-01T00:00:00.000Z',
      eventName: 'ObjectCreated:Put',
      userIdentity: { principalId: 'test' },
      requestParameters: { sourceIPAddress: '127.0.0.1' },
      responseElements: { 'x-amz-request-id': 'req-1', 'x-amz-id-2': 'id-2' },
      s3: {
        s3SchemaVersion: '1.0',
        configurationId: 'test-config',
        bucket: { name: bucket, ownerIdentity: { principalId: 'owner' }, arn: `arn:aws:s3:::${bucket}` },
        object: { key: encodeURIComponent(key), size: 1024, eTag: 'etag', sequencer: 'seq' },
      },
    }],
  };
}

describe('Bug Condition 1b: Pipeline-trigger skips browser-capture .txt files', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSfnSend.mockResolvedValue({});
    // Mock HeadObject to return browser-capture metadata
    mockS3Send.mockResolvedValue({
      Metadata: { 'source-url': 'https://airline.com/waivers', 'render-method': 'browser-capture' },
    });
  });

  it('should FIRE pipeline for browser-capture .txt file (not skip it)', async () => {
    const key = 'raw/web/some-capture-id/2024-01-01T00:00:00.000Z.txt';

    await handler(makeS3Event(key));

    // EXPECTED (fixed) behavior: pipeline FIRES for browser-capture .txt files
    // On UNFIXED code, the pipeline skips ALL .txt files (except email body.txt),
    // so StartExecution will NOT be called — this assertion will FAIL
    expect(mockSfnSend).toHaveBeenCalledTimes(1);
  });
});

describe('Bug Condition 1c: Pipeline-trigger fires on browser-capture .html files', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSfnSend.mockResolvedValue({});
    // Mock HeadObject to return browser-capture metadata
    mockS3Send.mockResolvedValue({
      Metadata: { 'source-url': 'https://airline.com/waivers', 'render-method': 'browser-capture' },
    });
  });

  it('should SKIP pipeline for browser-capture .html file (not fire it)', async () => {
    const key = 'raw/web/some-capture-id/2024-01-01T00:00:00.000Z.html';

    await handler(makeS3Event(key));

    // EXPECTED (fixed) behavior: pipeline SKIPS browser-capture .html files
    // On UNFIXED code, the pipeline fires on ALL .html files in raw/web/,
    // so StartExecution WILL be called — this assertion will FAIL
    expect(mockSfnSend).not.toHaveBeenCalled();
  });
});
