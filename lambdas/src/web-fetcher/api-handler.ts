import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { fetchAndStore, FetchError } from './handler';

/**
 * API Gateway proxy handler for web URL ingestion.
 * Accepts POST with body: { url: string }
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      return errorResponse(400, 'MISSING_BODY', 'Request body is required');
    }

    let body: { url?: string };
    try {
      body = JSON.parse(event.body);
    } catch {
      return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON');
    }

    if (!body.url || typeof body.url !== 'string') {
      return errorResponse(400, 'MISSING_URL', 'url is required and must be a string');
    }

    let parsed: URL;
    try {
      parsed = new URL(body.url);
    } catch {
      return errorResponse(400, 'INVALID_URL', 'url must be a valid URL');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return errorResponse(400, 'INVALID_URL', 'url must use http or https protocol');
    }

    const result = await fetchAndStore(body.url);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    if (err instanceof FetchError) {
      console.error(`Fetch error: ${err.message}`);
      return errorResponse(502, err.code, err.message);
    }

    const message = err instanceof Error ? err.message : String(err);
    console.error('Unexpected error in web-url handler:', message);
    return errorResponse(500, 'INTERNAL_ERROR', 'Failed to fetch web URL');
  }
}

function errorResponse(statusCode: number, code: string, message: string): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' },
    body: JSON.stringify({ error: { code, message } }),
  };
}
