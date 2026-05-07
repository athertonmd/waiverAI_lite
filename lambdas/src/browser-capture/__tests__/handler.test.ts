/**
 * Bug Condition Exploration Test 1a: Path Collision
 *
 * Demonstrates that two browser-capture requests from the same URL produce
 * S3 keys under the same `raw/web/${urlHash}/` directory prefix.
 *
 * EXPECTED: This test FAILS on unfixed code — failure confirms the bug exists.
 * The test asserts the EXPECTED (fixed) behavior: each capture should get a
 * unique directory path (UUID-based), not a shared urlHash-based path.
 *
 * **Validates: Requirements 1.1, 1.2**
 */

const mockS3Send = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  PutObjectCommand: jest.fn((input: unknown) => ({ _type: 'PutObject', input })),
}));

process.env.INGESTION_BUCKET = 'test-bucket';

import { handler } from '../handler';
import { APIGatewayProxyEvent } from 'aws-lambda';

function makeEvent(body: Record<string, unknown>): APIGatewayProxyEvent {
  return {
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/capture',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: '',
  };
}

describe('Bug Condition 1a: Browser-capture path collision', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockS3Send.mockResolvedValue({});
  });

  it('two captures from the same URL should produce DIFFERENT S3 directory prefixes (unique captureId)', async () => {
    const sameUrl = 'https://airline.com/waivers';
    const payload = {
      url: sameUrl,
      text: 'Region A waiver text',
      html: '<div><p>Region A waiver text</p></div>',
    };

    // First capture
    const result1 = await handler(makeEvent(payload));
    expect(result1.statusCode).toBe(200);
    const body1 = JSON.parse(result1.body);

    // Second capture from the same URL
    const result2 = await handler(makeEvent({
      ...payload,
      text: 'Region B waiver text',
      html: '<div><p>Region B waiver text</p></div>',
    }));
    expect(result2.statusCode).toBe(200);
    const body2 = JSON.parse(result2.body);

    // Extract the directory prefix (everything before the timestamp)
    // Current (buggy): raw/web/${urlHash}/ — same for both
    // Expected (fixed): raw/web/${captureId}/ — different for each
    const dir1 = body1.s3Key.split('/').slice(0, 3).join('/');
    const dir2 = body2.s3Key.split('/').slice(0, 3).join('/');

    // This assertion will FAIL on unfixed code because both use the same urlHash
    expect(dir1).not.toBe(dir2);
  });

  it('each capture should have a unique captureId in the response', async () => {
    const sameUrl = 'https://airline.com/waivers';

    const result1 = await handler(makeEvent({
      url: sameUrl,
      text: 'First capture text',
      html: '<div><p>First capture text</p></div>',
    }));
    const body1 = JSON.parse(result1.body);

    const result2 = await handler(makeEvent({
      url: sameUrl,
      text: 'Second capture text',
      html: '<div><p>Second capture text</p></div>',
    }));
    const body2 = JSON.parse(result2.body);

    // The fixed code should include a captureId field that is unique per capture
    // This will FAIL on unfixed code because captureId doesn't exist yet
    expect(body1.captureId).toBeDefined();
    expect(body2.captureId).toBeDefined();
    expect(body1.captureId).not.toBe(body2.captureId);
  });
});
