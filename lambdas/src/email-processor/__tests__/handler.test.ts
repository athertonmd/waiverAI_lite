import { S3Event } from 'aws-lambda';

// Mock S3Client before importing handler
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: jest.fn(() => ({ send: mockSend })),
    GetObjectCommand: jest.fn((input: unknown) => ({ _type: 'GetObject', input })),
    PutObjectCommand: jest.fn((input: unknown) => ({ _type: 'PutObject', input })),
    PutObjectTaggingCommand: jest.fn((input: unknown) => ({ _type: 'PutObjectTagging', input })),
  };
});

// Mock mailparser
const mockSimpleParser = jest.fn();
jest.mock('mailparser', () => ({
  simpleParser: mockSimpleParser,
}));

// Set env before importing handler
process.env.INGESTION_BUCKET = 'test-bucket';

import { handler } from '../handler';

function makeS3Event(key: string): S3Event {
  return {
    Records: [
      {
        s3: {
          bucket: { name: 'test-bucket' },
          object: { key },
        },
      },
    ],
  } as unknown as S3Event;
}

function makeRawEmailBuffer(): Buffer {
  return Buffer.from('raw-email-content');
}

describe('email-processor handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: getObject returns a buffer
    mockSend.mockImplementation((cmd: { _type: string }) => {
      if (cmd._type === 'GetObject') {
        return Promise.resolve({
          Body: {
            transformToByteArray: () => Promise.resolve(new Uint8Array(makeRawEmailBuffer())),
          },
        });
      }
      return Promise.resolve({});
    });
  });

  it('should extract and store a single PDF attachment', async () => {
    mockSimpleParser.mockResolvedValue({
      attachments: [
        {
          filename: 'waiver.pdf',
          contentType: 'application/pdf',
          content: Buffer.from('pdf-content'),
        },
      ],
    });

    await handler(makeS3Event('raw/email/msg-001'), {} as never);

    // GetObject + PutObject for the attachment = 2 calls
    expect(mockSend).toHaveBeenCalledTimes(2);

    const putCall = mockSend.mock.calls[1][0];
    expect(putCall.input).toEqual(
      expect.objectContaining({
        Bucket: 'test-bucket',
        Key: 'raw/email/msg-001/attachments/waiver.pdf',
        ContentType: 'application/pdf',
      }),
    );
  });

  it('should store each PDF when email has multiple PDF attachments', async () => {
    mockSimpleParser.mockResolvedValue({
      attachments: [
        {
          filename: 'waiver1.pdf',
          contentType: 'application/pdf',
          content: Buffer.from('pdf-1'),
        },
        {
          filename: 'waiver2.pdf',
          contentType: 'application/pdf',
          content: Buffer.from('pdf-2'),
        },
      ],
    });

    await handler(makeS3Event('raw/email/msg-002'), {} as never);

    // GetObject + 2 PutObject calls = 3
    expect(mockSend).toHaveBeenCalledTimes(3);

    const putCall1 = mockSend.mock.calls[1][0];
    expect(putCall1.input.Key).toBe('raw/email/msg-002/attachments/waiver1.pdf');

    const putCall2 = mockSend.mock.calls[2][0];
    expect(putCall2.input.Key).toBe('raw/email/msg-002/attachments/waiver2.pdf');
  });

  it('should tag as unprocessable when email has no attachments', async () => {
    mockSimpleParser.mockResolvedValue({
      attachments: [],
    });

    await handler(makeS3Event('raw/email/msg-003'), {} as never);

    // GetObject + PutObjectTagging = 2 calls
    expect(mockSend).toHaveBeenCalledTimes(2);

    const tagCall = mockSend.mock.calls[1][0];
    expect(tagCall.input).toEqual(
      expect.objectContaining({
        Bucket: 'test-bucket',
        Key: 'raw/email/msg-003',
        Tagging: {
          TagSet: [{ Key: 'status', Value: 'unprocessable' }],
        },
      }),
    );
  });

  it('should tag as unprocessable when email has only non-PDF attachments', async () => {
    mockSimpleParser.mockResolvedValue({
      attachments: [
        {
          filename: 'image.png',
          contentType: 'image/png',
          content: Buffer.from('png-data'),
        },
        {
          filename: 'doc.docx',
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          content: Buffer.from('docx-data'),
        },
      ],
    });

    await handler(makeS3Event('raw/email/msg-004'), {} as never);

    // GetObject + PutObjectTagging = 2 calls
    expect(mockSend).toHaveBeenCalledTimes(2);

    const tagCall = mockSend.mock.calls[1][0];
    expect(tagCall.input).toEqual(
      expect.objectContaining({
        Bucket: 'test-bucket',
        Key: 'raw/email/msg-004',
        Tagging: {
          TagSet: [{ Key: 'status', Value: 'unprocessable' }],
        },
      }),
    );
  });
});
