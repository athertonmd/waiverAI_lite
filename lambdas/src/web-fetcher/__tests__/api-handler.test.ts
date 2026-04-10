import { APIGatewayProxyEvent } from 'aws-lambda';

// Mock S3 client before importing
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn((input: unknown) => ({ _type: 'PutObject', input })),
}));

// Mock Chromium + Puppeteer — simulate failure so tests use the fetch fallback
jest.mock('@sparticuz/chromium', () => {
  throw new Error('Chromium not available in test');
});
jest.mock('puppeteer-core', () => {
  throw new Error('puppeteer-core not available in test');
});

process.env.INGESTION_BUCKET = 'test-ingestion-bucket';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import { handler } from '../api-handler';

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

describe('web-fetcher api-handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  it('should return 400 when body is missing', async () => {
    const result = await handler(makeEvent(null));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe('MISSING_BODY');
  });

  it('should return 400 for invalid JSON', async () => {
    const event = makeEvent(null);
    event.body = 'not-json';
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe('INVALID_JSON');
  });

  it('should return 400 when url is missing', async () => {
    const result = await handler(makeEvent({}));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe('MISSING_URL');
  });

  it('should return 400 when url is not a string', async () => {
    const result = await handler(makeEvent({ url: 123 }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe('MISSING_URL');
  });

  it('should return 400 for invalid URL format', async () => {
    const result = await handler(makeEvent({ url: 'not-a-url' }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe('INVALID_URL');
  });

  it('should return 400 for non-http/https protocol', async () => {
    const result = await handler(makeEvent({ url: 'ftp://example.com/file' }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe('INVALID_URL');
  });

  it('should return 200 with result on successful fetch', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('<html>waiver content</html>'),
    });

    const result = await handler(makeEvent({ url: 'https://example.com/waiver' }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.s3Key).toMatch(/^raw\/web\//);
    expect(body.urlHash).toBeDefined();
    expect(body.timestamp).toBeDefined();
    expect(body.contentLength).toBeGreaterThan(0);
    expect(body.renderMethod).toBe('fetch');
  });

  it('should return 502 when target URL returns non-200', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
    });

    const result = await handler(makeEvent({ url: 'https://example.com/missing' }));

    expect(result.statusCode).toBe(502);
    expect(JSON.parse(result.body).error.code).toBe('FETCH_FAILED');
  });

  it('should return 500 on unexpected errors', async () => {
    mockFetch.mockRejectedValue(new Error('DNS resolution failed'));

    const result = await handler(makeEvent({ url: 'https://example.com' }));

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error.code).toBe('INTERNAL_ERROR');
  });
});
