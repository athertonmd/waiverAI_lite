// Mock AWS SDK clients before importing handler
const mockS3Send = jest.fn();
const mockTextractSend = jest.fn();
const mockSqsSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  GetObjectCommand: jest.fn((input: unknown) => ({ _type: 'GetObject', input })),
  PutObjectCommand: jest.fn((input: unknown) => ({ _type: 'PutObject', input })),
  PutObjectTaggingCommand: jest.fn((input: unknown) => ({ _type: 'PutObjectTagging', input })),
}));

jest.mock('@aws-sdk/client-textract', () => ({
  TextractClient: jest.fn(() => ({ send: mockTextractSend })),
  DetectDocumentTextCommand: jest.fn((input: unknown) => ({ _type: 'DetectDocumentText', input })),
}));

jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn(() => ({ send: mockSqsSend })),
  SendMessageCommand: jest.fn((input: unknown) => ({ _type: 'SendMessage', input })),
}));

const mockSimpleParser = jest.fn();
jest.mock('mailparser', () => ({
  simpleParser: mockSimpleParser,
}));

process.env.INGESTION_BUCKET = 'test-bucket';
process.env.DLQ_URL = 'https://sqs.us-east-1.amazonaws.com/123456789/normalisation-dlq';

import { handler, normaliseHtml, NormalisationEvent } from '../handler';

function makeEvent(overrides: Partial<NormalisationEvent> = {}): NormalisationEvent {
  return {
    s3Key: 'raw/pdf/record-001',
    sourceType: 'pdf',
    recordId: 'record-001',
    ...overrides,
  };
}

function mockGetObject(content: Buffer | string) {
  const buf = typeof content === 'string' ? Buffer.from(content) : content;
  mockS3Send.mockImplementation((cmd: { _type: string }) => {
    if (cmd._type === 'GetObject') {
      return Promise.resolve({
        Body: { transformToByteArray: () => Promise.resolve(new Uint8Array(buf)) },
      });
    }
    return Promise.resolve({});
  });
}

describe('normalisation handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSqsSend.mockResolvedValue({});
  });

  describe('PDF normalisation', () => {
    it('should extract text from PDF via Textract and store normalized output', async () => {
      mockGetObject(Buffer.from('pdf-bytes'));
      mockTextractSend.mockResolvedValue({
        Blocks: [
          { BlockType: 'PAGE', Text: '' },
          { BlockType: 'LINE', Text: 'Waiver Notice' },
          { BlockType: 'LINE', Text: 'Airline: AA' },
          { BlockType: 'LINE', Text: 'Effective: 2024-01-15' },
          { BlockType: 'WORD', Text: 'ignored' },
        ],
      });

      const result = await handler(makeEvent({ sourceType: 'pdf', s3Key: 'raw/pdf/record-001', recordId: 'record-001' }));

      expect(result).toEqual({
        normalizedS3Key: 'normalized/pdf/record-001.txt',
        sourceS3Key: 'raw/pdf/record-001',
        sourceType: 'pdf',
        recordId: 'record-001',
      });

      // Textract called
      expect(mockTextractSend).toHaveBeenCalledTimes(1);
      const textractCmd = mockTextractSend.mock.calls[0][0];
      expect(textractCmd.input).toEqual({
        Document: { S3Object: { Bucket: 'test-bucket', Name: 'raw/pdf/record-001' } },
      });

      // PutObject called with normalized text
      const putCall = mockS3Send.mock.calls.find(
        (c: { _type: string }[]) => c[0]._type === 'PutObject',
      );
      expect(putCall).toBeDefined();
      expect(putCall![0].input).toEqual(
        expect.objectContaining({
          Bucket: 'test-bucket',
          Key: 'normalized/pdf/record-001.txt',
          Body: 'Waiver Notice\nAirline: AA\nEffective: 2024-01-15',
          ContentType: 'text/plain',
        }),
      );
    });

    it('should handle Textract returning empty blocks', async () => {
      mockGetObject(Buffer.from('pdf-bytes'));
      mockTextractSend.mockResolvedValue({ Blocks: [] });

      await expect(handler(makeEvent({ sourceType: 'pdf' }))).rejects.toThrow('empty text');

      // Should tag as failed and send to DLQ
      const tagCall = mockS3Send.mock.calls.find(
        (c: { _type: string }[]) => c[0]._type === 'PutObjectTagging',
      );
      expect(tagCall).toBeDefined();
      expect(mockSqsSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('HTML normalisation', () => {
    it('should strip HTML tags, scripts, and styles and store normalized output', async () => {
      const html = '<html><head><style>body{color:red}</style></head><body><script>alert("x")</script><h1>Waiver</h1><p>Details here</p></body></html>';
      mockGetObject(html);

      const result = await handler(makeEvent({ sourceType: 'web', s3Key: 'raw/web/hash/ts.html', recordId: 'rec-web' }));

      expect(result.normalizedS3Key).toBe('normalized/web/rec-web.txt');

      const putCall = mockS3Send.mock.calls.find(
        (c: { _type: string }[]) => c[0]._type === 'PutObject',
      );
      const body: string = putCall![0].input.Body;
      expect(body).not.toContain('<script>');
      expect(body).not.toContain('<style>');
      expect(body).not.toContain('<h1>');
      expect(body).toContain('Waiver');
      expect(body).toContain('Details here');
    });

    it('should decode HTML entities', async () => {
      const html = '<p>A &amp; B &lt; C &gt; D &quot;E&quot; &#39;F&#39;</p>';
      mockGetObject(html);

      const result = await handler(makeEvent({ sourceType: 'web', recordId: 'rec-ent' }));

      const putCall = mockS3Send.mock.calls.find(
        (c: { _type: string }[]) => c[0]._type === 'PutObject',
      );
      const body: string = putCall![0].input.Body;
      expect(body).toContain('A & B < C > D "E" \'F\'');
    });
  });

  describe('Email normalisation', () => {
    it('should parse MIME email and extract text body', async () => {
      mockGetObject(Buffer.from('raw-email'));
      mockSimpleParser.mockResolvedValue({ text: 'Dear team,\nWaiver details attached.' });

      const result = await handler(makeEvent({ sourceType: 'email', s3Key: 'raw/email/msg-001', recordId: 'rec-email' }));

      expect(result).toEqual({
        normalizedS3Key: 'normalized/email/rec-email.txt',
        sourceS3Key: 'raw/email/msg-001',
        sourceType: 'email',
        recordId: 'rec-email',
      });

      expect(mockSimpleParser).toHaveBeenCalledTimes(1);

      const putCall = mockS3Send.mock.calls.find(
        (c: { _type: string }[]) => c[0]._type === 'PutObject',
      );
      expect(putCall![0].input.Body).toBe('Dear team,\nWaiver details attached.');
    });

    it('should fail when email has no text body', async () => {
      mockGetObject(Buffer.from('raw-email'));
      mockSimpleParser.mockResolvedValue({ text: undefined });

      await expect(
        handler(makeEvent({ sourceType: 'email', recordId: 'rec-empty' })),
      ).rejects.toThrow('empty text');

      expect(mockSqsSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error handling', () => {
    it('should tag object as normalisation_failed and send to DLQ on error', async () => {
      mockS3Send.mockImplementation((cmd: { _type: string }) => {
        if (cmd._type === 'GetObject') {
          return Promise.reject(new Error('S3 access denied'));
        }
        return Promise.resolve({});
      });

      await expect(handler(makeEvent({ recordId: 'rec-fail' }))).rejects.toThrow('S3 access denied');

      // Tag call
      const tagCall = mockS3Send.mock.calls.find(
        (c: { _type: string }[]) => c[0]._type === 'PutObjectTagging',
      );
      expect(tagCall).toBeDefined();
      expect(tagCall![0].input.Tagging.TagSet).toEqual([
        { Key: 'status', Value: 'normalisation_failed' },
      ]);

      // DLQ call
      expect(mockSqsSend).toHaveBeenCalledTimes(1);
      const sqsCmd = mockSqsSend.mock.calls[0][0];
      const msgBody = JSON.parse(sqsCmd.input.MessageBody);
      expect(msgBody.error).toBe('S3 access denied');
      expect(msgBody.event.recordId).toBe('rec-fail');
    });

    it('should throw for unsupported source type', async () => {
      mockGetObject(Buffer.from('data'));

      await expect(
        handler({ s3Key: 'raw/other/x', sourceType: 'other' as never, recordId: 'rec-bad' }),
      ).rejects.toThrow('Unsupported source type');
    });
  });
});

describe('normaliseHtml (unit)', () => {
  it('should remove script tags and content', () => {
    expect(normaliseHtml('<p>Hello</p><script>evil()</script>')).toBe('Hello');
  });

  it('should remove style tags and content', () => {
    expect(normaliseHtml('<style>.x{color:red}</style><p>Text</p>')).toBe('Text');
  });

  it('should remove HTML comments', () => {
    expect(normaliseHtml('<!-- comment --><p>Visible</p>')).toBe('Visible');
  });

  it('should replace br tags with newlines', () => {
    expect(normaliseHtml('Line1<br>Line2<br/>Line3')).toBe('Line1\nLine2\nLine3');
  });

  it('should handle &nbsp; entities', () => {
    expect(normaliseHtml('<p>Hello&nbsp;World</p>')).toBe('Hello World');
  });
});
