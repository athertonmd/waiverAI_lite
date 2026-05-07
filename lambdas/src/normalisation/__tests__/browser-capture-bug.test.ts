/**
 * Bug Condition Exploration Test 1d: Normalisation applies normaliseHtml() stripping
 *
 * Demonstrates that the normalisation handler receives a browser-capture `.html` key
 * containing `<div><p>Waiver text</p></div>` and applies `normaliseHtml()` stripping,
 * when it should instead read the .txt file directly for browser-capture sources.
 *
 * EXPECTED: This test FAILS on unfixed code — failure confirms the bug exists.
 * The test asserts the EXPECTED (fixed) behavior: normalisation should detect
 * browser-capture metadata and use the .txt file content directly (skip normaliseHtml).
 *
 * **Validates: Requirements 1.4**
 */

const mockS3Send = jest.fn();
const mockSqsSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  GetObjectCommand: jest.fn((input: unknown) => ({ _type: 'GetObject', input })),
  HeadObjectCommand: jest.fn((input: unknown) => ({ _type: 'HeadObject', input })),
  PutObjectCommand: jest.fn((input: unknown) => ({ _type: 'PutObject', input })),
  PutObjectTaggingCommand: jest.fn((input: unknown) => ({ _type: 'PutObjectTagging', input })),
}));

jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn(() => ({ send: mockSqsSend })),
  SendMessageCommand: jest.fn((input: unknown) => ({ _type: 'SendMessage', input })),
}));

jest.mock('mailparser', () => ({
  simpleParser: jest.fn(),
}));

process.env.INGESTION_BUCKET = 'test-bucket';
process.env.DLQ_URL = 'https://sqs.us-east-1.amazonaws.com/123456789/normalisation-dlq';

import { handler } from '../handler';

describe('Bug Condition 1d: Normalisation applies normaliseHtml() to browser-capture HTML', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSqsSend.mockResolvedValue({});
  });

  it('should detect browser-capture metadata and skip normaliseHtml() for .html key', async () => {
    // The browser-capture stores a minimal HTML wrapper like <div><p>Waiver text</p></div>.
    // On UNFIXED code, normalisation receives this .html key and applies normaliseHtml()
    // which strips the tags. The FIXED behavior should detect browser-capture metadata
    // and read the companion .txt file instead.
    //
    // We demonstrate the bug by passing an .html key with content that normaliseHtml()
    // would alter, and asserting that the output should match the .txt companion content
    // (which the fixed code would read instead).

    const htmlContent = '<div><p>Waiver text</p></div>';
    // The .txt file has the raw captured text which may differ from normaliseHtml() output
    const txtContent = 'Waiver text from region capture with extra context';

    // Mock S3 calls
    mockS3Send.mockImplementation((cmd: { _type: string; input?: any }) => {
      if (cmd._type === 'GetObject') {
        // When reading the .txt key, return the raw text
        if (cmd.input?.Key?.endsWith('.txt')) {
          return Promise.resolve({
            Body: { transformToByteArray: () => Promise.resolve(new Uint8Array(Buffer.from(txtContent))) },
          });
        }
        // When reading the .html key, return the HTML wrapper
        return Promise.resolve({
          Body: { transformToByteArray: () => Promise.resolve(new Uint8Array(Buffer.from(htmlContent))) },
        });
      }
      if (cmd._type === 'HeadObject') {
        // Return browser-capture metadata
        return Promise.resolve({
          Metadata: { 'source-url': 'https://airline.com/waivers', 'render-method': 'browser-capture' },
        });
      }
      return Promise.resolve({});
    });

    // On UNFIXED code, the pipeline sends the .html key to normalisation
    const event = {
      s3Key: 'raw/web/capture-id-123/2024-01-01T00:00:00.000Z.html',
      sourceType: 'web' as const,
      recordId: 'rec-browser-capture',
    };

    const result = await handler(event);

    // Find the PutObject call to check what was stored as normalized text
    const putCalls = mockS3Send.mock.calls.filter(
      (c: any[]) => c[0]._type === 'PutObject',
    );
    expect(putCalls.length).toBeGreaterThan(0);

    const normalizedBody: string = putCalls[0][0].input.Body;

    // EXPECTED (fixed) behavior: normalisation should detect browser-capture metadata
    // and read the companion .txt file, producing the txtContent.
    // On UNFIXED code: normaliseHtml('<div><p>Waiver text</p></div>') produces 'Waiver text'
    // which does NOT match txtContent — this assertion will FAIL.
    expect(normalizedBody).toBe(txtContent);
  });

  it('should NOT apply normaliseHtml() to browser-capture .html content', async () => {
    // This test demonstrates that on unfixed code, when normalisation receives
    // a browser-capture .html key, it applies normaliseHtml() which strips the
    // minimal wrapper. The FIXED behavior should detect browser-capture metadata
    // and read the companion .txt file instead.

    const htmlContent = '<div><p>Waiver text</p></div>';
    const txtContent = 'Waiver text';

    mockS3Send.mockImplementation((cmd: { _type: string; input?: any }) => {
      if (cmd._type === 'GetObject') {
        if (cmd.input?.Key?.endsWith('.txt')) {
          return Promise.resolve({
            Body: { transformToByteArray: () => Promise.resolve(new Uint8Array(Buffer.from(txtContent))) },
          });
        }
        return Promise.resolve({
          Body: { transformToByteArray: () => Promise.resolve(new Uint8Array(Buffer.from(htmlContent))) },
        });
      }
      if (cmd._type === 'HeadObject') {
        return Promise.resolve({
          Metadata: { 'source-url': 'https://airline.com/waivers', 'render-method': 'browser-capture' },
        });
      }
      return Promise.resolve({});
    });

    // On UNFIXED code, the pipeline sends the .html key to normalisation
    const event = {
      s3Key: 'raw/web/capture-id-123/2024-01-01T00:00:00.000Z.html',
      sourceType: 'web' as const,
      recordId: 'rec-browser-html',
    };

    const result = await handler(event);

    const putCalls = mockS3Send.mock.calls.filter(
      (c: any[]) => c[0]._type === 'PutObject',
    );
    expect(putCalls.length).toBeGreaterThan(0);

    const normalizedBody: string = putCalls[0][0].input.Body;

    // EXPECTED (fixed) behavior: normalisation should detect browser-capture metadata
    // on the .html key and read the companion .txt file instead of applying normaliseHtml().
    // The normalized output should be the raw text from the .txt file.
    //
    // On UNFIXED code: normaliseHtml('<div><p>Waiver text</p></div>') produces 'Waiver text'
    // which happens to match txtContent. But the key difference is that the fixed code
    // should read from the .txt key, not apply normaliseHtml() to the .html content.
    //
    // We verify by checking that the GetObject was called with the .txt key (companion file)
    const getObjectCalls = mockS3Send.mock.calls.filter(
      (c: any[]) => c[0]._type === 'GetObject',
    );

    // EXPECTED (fixed): normalisation reads the .txt companion file
    // On UNFIXED code: normalisation only reads the .html file passed in s3Key
    const readTxtFile = getObjectCalls.some(
      (c: any[]) => c[0].input?.Key?.endsWith('.txt'),
    );
    expect(readTxtFile).toBe(true);
  });
});
