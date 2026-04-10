const mockS3Send = jest.fn();
const mockBedrockSend = jest.fn();
const mockDdbSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  GetObjectCommand: jest.fn((input: unknown) => ({ _type: 'GetObject', input })),
  PutObjectCommand: jest.fn((input: unknown) => ({ _type: 'PutObject', input })),
  PutObjectTaggingCommand: jest.fn((input: unknown) => ({ _type: 'PutObjectTagging', input })),
}));

jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn(() => ({ send: mockBedrockSend })),
  InvokeModelCommand: jest.fn((input: unknown) => ({ _type: 'InvokeModel', input })),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockDdbSend })),
  },
  GetCommand: jest.fn((input: unknown) => ({ _type: 'DdbGet', input })),
  QueryCommand: jest.fn((input: unknown) => ({ _type: 'DdbQuery', input })),
}));

process.env.INGESTION_BUCKET = 'test-bucket';
process.env.BEDROCK_MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0';
process.env.SETTINGS_TABLE = 'test-settings';

import {
  handler,
  buildExtractionPrompt,
  parseBedrockResponse,
  computeOverallConfidence,
  ExtractionEvent,
  ExtractionError,
} from '../handler';
import { DEFAULT_SCHEMA, FieldSchema } from '../../shared/field-schema';

function makeEvent(overrides: Partial<ExtractionEvent> = {}): ExtractionEvent {
  return {
    normalizedS3Key: 'normalized/pdf/record-001.txt',
    sourceType: 'pdf',
    recordId: 'record-001',
    ...overrides,
  };
}

const VALID_BEDROCK_JSON = JSON.stringify({
  airline_code: 'AA',
  waiver_title: 'Winter Storm Waiver',
  waiver_code: 'WX-2024-001',
  effective_date: '2024-01-15',
  expiration_date: '2024-02-15',
  applicable_routes: ['JFK-LAX', 'ORD-DFW'],
  fare_classes: ['Y', 'B', 'M'],
  rebooking_rules: 'Free rebooking within 14 days',
  refund_rules: 'Full refund or travel credit',
  confidence_scores: {
    airline_code: 0.95,
    waiver_title: 0.88,
    waiver_code: 0.92,
    effective_date: 0.97,
    expiration_date: 0.91,
    applicable_routes: 0.78,
    fare_classes: 0.85,
    rebooking_rules: 0.72,
    refund_rules: 0.70,
  },
});

function mockGetNormalizedText(text: string) {
  mockS3Send.mockImplementation((cmd: { _type: string }) => {
    if (cmd._type === 'GetObject') {
      const buf = Buffer.from(text);
      return Promise.resolve({
        Body: { transformToByteArray: () => Promise.resolve(new Uint8Array(buf)) },
      });
    }
    return Promise.resolve({});
  });
}

function mockBedrockResponse(jsonText: string) {
  const responseBody = JSON.stringify({ content: [{ type: 'text', text: jsonText }] });
  mockBedrockSend.mockResolvedValue({
    body: new TextEncoder().encode(responseBody),
  });
}

/** Mock DynamoDB to return no settings (fall back to DEFAULT_SCHEMA) */
function mockDdbNoSettings() {
  mockDdbSend.mockImplementation(() => Promise.resolve({}));
}

describe('buildExtractionPrompt', () => {
  it('should include the normalized text in the prompt', () => {
    const prompt = buildExtractionPrompt('Airline AA waiver for winter storm', DEFAULT_SCHEMA);
    expect(prompt).toContain('Airline AA waiver for winter storm');
    expect(prompt).toContain('airline_code');
    expect(prompt).toContain('waiver_code');
    expect(prompt).toContain('confidence_scores');
    expect(prompt).toContain('JSON');
  });

  it('should instruct model to return only JSON', () => {
    const prompt = buildExtractionPrompt('some text', DEFAULT_SCHEMA);
    expect(prompt).toContain('Return ONLY the JSON object');
  });

  it('should list all required fields', () => {
    const prompt = buildExtractionPrompt('text', DEFAULT_SCHEMA);
    const requiredFields = [
      'airline_code', 'waiver_title', 'waiver_code',
      'effective_date', 'expiration_date', 'applicable_routes',
      'fare_classes', 'rebooking_rules', 'refund_rules',
    ];
    for (const field of requiredFields) {
      expect(prompt).toContain(field);
    }
  });

  it('should include type-specific instructions', () => {
    const prompt = buildExtractionPrompt('text', DEFAULT_SCHEMA);
    expect(prompt).toContain('ISO 8601 date');
    expect(prompt).toContain('array of strings');
    expect(prompt).toContain('string');
  });

  it('should include field definitions', () => {
    const prompt = buildExtractionPrompt('text', DEFAULT_SCHEMA);
    expect(prompt).toContain('IATA 2-letter airline code');
    expect(prompt).toContain('Description:');
  });

  it('should work with a custom schema', () => {
    const customSchema: FieldSchema = [
      { key: 'custom_field', label: 'Custom', type: 'text', definition: 'A custom field', required: true, order: 0 },
    ];
    const prompt = buildExtractionPrompt('text', customSchema);
    expect(prompt).toContain('custom_field');
    expect(prompt).toContain('A custom field');
    expect(prompt).not.toContain('airline_code');
  });

  it('should include source URL hint when provided', () => {
    const prompt = buildExtractionPrompt('text', DEFAULT_SCHEMA, 'https://saleslink.aa.com');
    expect(prompt).toContain('saleslink.aa.com');
    expect(prompt).toContain('SOURCE URL');
  });
});

describe('parseBedrockResponse', () => {
  it('should parse valid JSON response', () => {
    const result = parseBedrockResponse(VALID_BEDROCK_JSON, DEFAULT_SCHEMA);
    expect(result.fields.airline_code).toBe('AA');
    expect(result.fields.waiver_code).toBe('WX-2024-001');
    expect(result.fields.applicable_routes).toEqual(['JFK-LAX', 'ORD-DFW']);
    expect(result.fields.fare_classes).toEqual(['Y', 'B', 'M']);
    expect(result.confidence_scores.airline_code).toBe(0.95);
  });

  it('should parse JSON wrapped in markdown code blocks', () => {
    const wrapped = '```json\n' + VALID_BEDROCK_JSON + '\n```';
    const result = parseBedrockResponse(wrapped, DEFAULT_SCHEMA);
    expect(result.fields.airline_code).toBe('AA');
  });

  it('should throw ExtractionError for empty response', () => {
    expect(() => parseBedrockResponse('', DEFAULT_SCHEMA)).toThrow(ExtractionError);
    expect(() => parseBedrockResponse('   ', DEFAULT_SCHEMA)).toThrow(ExtractionError);
  });

  it('should throw ExtractionError for invalid JSON', () => {
    expect(() => parseBedrockResponse('not json at all', DEFAULT_SCHEMA)).toThrow(ExtractionError);
  });

  it('should default missing fields to empty values', () => {
    const minimal = JSON.stringify({ airline_code: 'UA' });
    const result = parseBedrockResponse(minimal, DEFAULT_SCHEMA);
    expect(result.fields.airline_code).toBe('UA');
    expect(result.fields.waiver_title).toBe('');
    expect(result.fields.applicable_routes).toEqual([]);
    expect(result.fields.fare_classes).toEqual([]);
  });

  it('should clamp confidence scores to 0-1 range', () => {
    const data = JSON.stringify({
      confidence_scores: { airline_code: 1.5, waiver_title: -0.3 },
    });
    const result = parseBedrockResponse(data, DEFAULT_SCHEMA);
    expect(result.confidence_scores.airline_code).toBe(1);
    expect(result.confidence_scores.waiver_title).toBe(0);
  });
});

describe('computeOverallConfidence', () => {
  it('should return the minimum of all field scores', () => {
    const scores: Record<string, number> = {
      airline_code: 0.95, waiver_title: 0.88, waiver_code: 0.92,
      effective_date: 0.97, expiration_date: 0.91, applicable_routes: 0.78,
      fare_classes: 0.85, rebooking_rules: 0.72, refund_rules: 0.70,
    };
    expect(computeOverallConfidence(scores, DEFAULT_SCHEMA)).toBe(0.70);
  });

  it('should return 0 when any field is 0', () => {
    const scores: Record<string, number> = {
      airline_code: 0.95, waiver_title: 0, waiver_code: 0.92,
      effective_date: 0.97, expiration_date: 0.91, applicable_routes: 0.78,
      fare_classes: 0.85, rebooking_rules: 0.72, refund_rules: 0.70,
    };
    expect(computeOverallConfidence(scores, DEFAULT_SCHEMA)).toBe(0);
  });

  it('should return 1 when all fields are 1', () => {
    const scores: Record<string, number> = {
      airline_code: 1, waiver_title: 1, waiver_code: 1,
      effective_date: 1, expiration_date: 1, applicable_routes: 1,
      fare_classes: 1, rebooking_rules: 1, refund_rules: 1,
    };
    expect(computeOverallConfidence(scores, DEFAULT_SCHEMA)).toBe(1);
  });
});

describe('extraction handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDdbNoSettings();
  });

  it('should extract waiver data and store to S3', async () => {
    mockGetNormalizedText('Airline AA Winter Storm Waiver WX-2024-001');
    mockBedrockResponse(VALID_BEDROCK_JSON);

    const result = await handler(makeEvent());

    expect(result.extractedS3Key).toBe('extracted/record-001.json');
    expect(result.recordId).toBe('record-001');
    expect(result.overallConfidence).toBe(0.70);

    // Verify S3 PutObject was called with extracted JSON
    const putCall = mockS3Send.mock.calls.find(
      (c: { _type: string }[]) => c[0]._type === 'PutObject',
    );
    expect(putCall).toBeDefined();
    expect(putCall![0].input.Key).toBe('extracted/record-001.json');
    expect(putCall![0].input.ContentType).toBe('application/json');

    const storedRecord = JSON.parse(putCall![0].input.Body);
    expect(storedRecord.airline_code).toBe('AA');
    expect(storedRecord.overall_confidence).toBe(0.70);
    expect(storedRecord.status).toBe('pending_review');
  });

  it('should throw and tag as extraction_failed for empty normalized text', async () => {
    mockGetNormalizedText('');
    await expect(handler(makeEvent())).rejects.toThrow('empty or missing');

    const tagCall = mockS3Send.mock.calls.find(
      (c: { _type: string }[]) => c[0]._type === 'PutObjectTagging',
    );
    expect(tagCall).toBeDefined();
    expect(tagCall![0].input.Tagging.TagSet).toEqual([
      { Key: 'status', Value: 'extraction_failed' },
    ]);
  });

  it('should throw and tag as extraction_failed for whitespace-only text', async () => {
    mockGetNormalizedText('   \n  \t  ');
    await expect(handler(makeEvent())).rejects.toThrow('empty or missing');
  });

  it('should throw and tag as extraction_failed when Bedrock returns invalid JSON', async () => {
    mockGetNormalizedText('Valid normalized text');
    mockBedrockResponse('This is not JSON');

    await expect(handler(makeEvent())).rejects.toThrow('Failed to parse');

    const tagCall = mockS3Send.mock.calls.find(
      (c: { _type: string }[]) => c[0]._type === 'PutObjectTagging',
    );
    expect(tagCall).toBeDefined();
  });
});
