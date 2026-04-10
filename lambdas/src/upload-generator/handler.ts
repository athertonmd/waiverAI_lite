import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

const s3 = new S3Client({});
const BUCKET = process.env.INGESTION_BUCKET!;
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const ALLOWED_CONTENT_TYPE = 'application/pdf';
const URL_EXPIRY_SECONDS = 300; // 5 minutes

interface UploadRequest {
  contentType: string;
  fileSize: number;
  filename?: string;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      return errorResponse(400, 'MISSING_BODY', 'Request body is required');
    }

    let body: UploadRequest;
    try {
      body = JSON.parse(event.body);
    } catch {
      return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON');
    }

    if (!body.contentType) {
      return errorResponse(400, 'MISSING_CONTENT_TYPE', 'contentType is required');
    }

    if (body.fileSize == null) {
      return errorResponse(400, 'MISSING_FILE_SIZE', 'fileSize is required');
    }

    if (body.contentType !== ALLOWED_CONTENT_TYPE) {
      return errorResponse(400, 'INVALID_CONTENT_TYPE', `Only ${ALLOWED_CONTENT_TYPE} files are allowed`);
    }

    if (typeof body.fileSize !== 'number' || body.fileSize <= 0) {
      return errorResponse(400, 'INVALID_FILE_SIZE', 'fileSize must be a positive number');
    }

    if (body.fileSize > MAX_FILE_SIZE) {
      return errorResponse(400, 'FILE_TOO_LARGE', `File size exceeds maximum of 25 MB`);
    }

    const uploadId = randomUUID();
    const key = `raw/pdf/${uploadId}.pdf`;

    const presignedUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        ContentType: ALLOWED_CONTENT_TYPE,
      }),
      { expiresIn: URL_EXPIRY_SECONDS },
    );

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' },
      body: JSON.stringify({
        uploadId,
        presignedUrl,
        key,
        expiresIn: URL_EXPIRY_SECONDS,
      }),
    };
  } catch (err) {
    console.error('Error generating presigned URL:', err);
    return errorResponse(500, 'INTERNAL_ERROR', 'Failed to generate upload URL');
  }
}

function errorResponse(statusCode: number, code: string, message: string): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' },
    body: JSON.stringify({ error: { code, message } }),
  };
}
