// Mock S3 client before importing handler
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

import { handler, computeUrlHash, fetchAndStore, FetchError } from '../handler';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('computeUrlHash', () => {
  it('should return a 64-char hex SHA-256 hash', () => {
    const hash = computeUrlHash('https://example.com');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should return the same hash for the same URL', () => {
    const h1 = computeUrlHash('https://example.com/page');
    const h2 = computeUrlHash('https://example.com/page');
    expect(h1).toBe(h2);
  });

  it('should return different hashes for different URLs', () => {
    const h1 = computeUrlHash('https://example.com/a');
    const h2 = computeUrlHash('https://example.com/b');
    expect(h1).not.toBe(h2);
  });
});

describe('fetchAndStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  it('should fall back to HTTP fetch and store HTML + text to S3', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('<html><body>Hello</body></html>'),
    });

    const result = await fetchAndStore('https://example.com');

    expect(result.urlHash).toBe(computeUrlHash('https://example.com'));
    expect(result.s3Key).toMatch(/^raw\/web\/[a-f0-9]{64}\/.*\.html$/);
    expect(result.textS3Key).toMatch(/^raw\/web\/[a-f0-9]{64}\/.*\.txt$/);
    expect(result.screenshotS3Key).toBe('');
    expect(result.renderMethod).toBe('fetch');
    expect(result.contentLength).toBe('<html><body>Hello</body></html>'.length);
    expect(result.timestamp).toBeDefined();

    // HTML + text uploads (no screenshot since Chromium is mocked to fail)
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('should throw FetchError for non-200 responses', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
    });

    await expect(fetchAndStore('https://example.com/missing'))
      .rejects.toThrow(FetchError);
  });

  it('should throw on network errors', async () => {
    mockFetch.mockRejectedValue(new Error('Network unreachable'));

    await expect(fetchAndStore('https://unreachable.example.com'))
      .rejects.toThrow('Network unreachable');
  });
});

describe('handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  it('should return error when url is missing', async () => {
    const result = await handler({ url: '' });

    expect(result).toHaveProperty('error');
    const err = result as { error: { code: string } };
    expect(err.error.code).toBe('MISSING_URL');
  });

  it('should return result on successful fetch', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('<html>content</html>'),
    });

    const result = await handler({ url: 'https://example.com' });

    expect(result).toHaveProperty('s3Key');
    expect(result).toHaveProperty('urlHash');
    expect(result).toHaveProperty('timestamp');
    expect(result).toHaveProperty('renderMethod');
  });

  it('should return error for non-200 HTTP response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
    });

    const result = await handler({ url: 'https://example.com/down' });

    expect(result).toHaveProperty('error');
    const err = result as { error: { code: string; message: string } };
    expect(err.error.code).toBe('FETCH_FAILED');
    expect(err.error.message).toContain('503');
  });

  it('should return error for unreachable URL', async () => {
    mockFetch.mockRejectedValue(new Error('fetch failed'));

    const result = await handler({ url: 'https://unreachable.test' });

    expect(result).toHaveProperty('error');
    const err = result as { error: { code: string } };
    expect(err.error.code).toBe('FETCH_ERROR');
  });
});
