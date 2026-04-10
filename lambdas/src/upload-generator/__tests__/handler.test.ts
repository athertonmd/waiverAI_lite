import { APIGatewayProxyEvent } from 'aws-lambda';

// Mock S3 client and presigner before importing handler
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn((input: unknown) => ({ _type: 'PutObject', input })),
}));

const mockGetSignedUrl = jest.fn();
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

// Mock crypto.randomUUID
jest.mock('crypto', () => ({
  randomUUID: () => 'test-uuid-1234',
}));

process.env.INGESTION_BUCKET = 'test-ingestion-bucket';

import { handler } from '../handler';

function makeEvent(body: unknown): APIGatewayProxyEvent {
  return {
    body: body != null ? JSON.stringify(body) : null,
    httpMethod: 'POST',
    headers: {},
    queryStringParameters: null,
    pathParameters: null,
    requestContext: {},
    resource: '',
    path: '',
    isBase64Encoded: false,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    stageVariables: null,
  } as unknown as APIGatewayProxyEvent;
}

describe('upload-generator handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSignedUrl.mockResolvedValue('https://s3.amazonaws.com/test-presigned-url');
  });

  it('should return presigned URL for valid PDF upload request', async () => {
    const result = await handler(makeEvent({ contentType: 'application/pdf', fileSize: 1024 }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.uploadId).toBe('test-uuid-1234');
    expect(body.presignedUrl).toBe('https://s3.amazonaws.com/test-presigned-url');
    expect(body.key).toBe('raw/pdf/test-uuid-1234');
    expect(body.expiresIn).toBe(300);
  });

  it('should return 400 when body is missing', async () => {
    const result = await handler(makeEvent(null));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('MISSING_BODY');
  });

  it('should return 400 for invalid JSON body', async () => {
    const event = makeEvent(null);
    event.body = 'not-json';
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('INVALID_JSON');
  });

  it('should return 400 when contentType is not application/pdf', async () => {
    const result = await handler(makeEvent({ contentType: 'image/png', fileSize: 1024 }));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('INVALID_CONTENT_TYPE');
  });

  it('should return 400 when fileSize exceeds 25 MB', async () => {
    const overLimit = 25 * 1024 * 1024 + 1;
    const result = await handler(makeEvent({ contentType: 'application/pdf', fileSize: overLimit }));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('should accept fileSize exactly at 25 MB', async () => {
    const exactLimit = 25 * 1024 * 1024;
    const result = await handler(makeEvent({ contentType: 'application/pdf', fileSize: exactLimit }));

    expect(result.statusCode).toBe(200);
  });

  it('should return 400 when contentType is missing', async () => {
    const result = await handler(makeEvent({ fileSize: 1024 }));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('MISSING_CONTENT_TYPE');
  });

  it('should return 400 when fileSize is missing', async () => {
    const result = await handler(makeEvent({ contentType: 'application/pdf' }));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('MISSING_FILE_SIZE');
  });

  it('should return 400 when fileSize is not positive', async () => {
    const result = await handler(makeEvent({ contentType: 'application/pdf', fileSize: 0 }));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('INVALID_FILE_SIZE');
  });

  it('should call getSignedUrl with correct bucket and key', async () => {
    await handler(makeEvent({ contentType: 'application/pdf', fileSize: 5000 }));

    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    const putCmd = mockGetSignedUrl.mock.calls[0][1];
    expect(putCmd.input).toEqual(
      expect.objectContaining({
        Bucket: 'test-ingestion-bucket',
        Key: 'raw/pdf/test-uuid-1234',
        ContentType: 'application/pdf',
      }),
    );
  });

  it('should return 500 when getSignedUrl throws', async () => {
    mockGetSignedUrl.mockRejectedValue(new Error('S3 error'));

    const result = await handler(makeEvent({ contentType: 'application/pdf', fileSize: 1024 }));

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
