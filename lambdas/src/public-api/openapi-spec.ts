const waiverSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    airline_code: { type: 'string' },
    airline_name: { type: 'string' },
    waiver_title: { type: 'string' },
    waiver_code: { type: 'string' },
    issued_date: { type: 'string', format: 'date' },
    effective_date: { type: 'string', format: 'date' },
    expiration_date: { type: 'string', format: 'date' },
    travel_dates_qualifier: { type: 'string' },
    ticket_issued_qualifier: { type: 'string' },
    ticket_issued_date: { type: 'string', format: 'date' },
    airports_qualifier: { type: 'string' },
    airports: { type: 'array', items: { type: 'string' } },
    fare_classes: { type: 'array', items: { type: 'string' } },
    rebooking_rules: { type: 'string' },
    refund_rules: { type: 'string' },
    release_notes: { type: 'string' },
    status: { type: 'string' },
    source_type: { type: 'string' },
    overall_confidence: { type: 'number' },
    ingestion_timestamp: { type: 'string', format: 'date-time' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

const errorSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
      },
    },
  },
};

const paginationSchema = {
  type: 'object',
  properties: {
    page: { type: 'integer' },
    pageSize: { type: 'integer' },
    totalCount: { type: 'integer' },
    totalPages: { type: 'integer' },
  },
};

export function getOpenApiSpec(apiBaseUrl?: string): object {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Waiver Data Hub Public API',
      version: '1.0.0',
      description: 'Read-only API for accessing approved airline fare waiver data.',
    },
    servers: apiBaseUrl ? [{ url: apiBaseUrl }] : [],
    security: [{ ApiKeyAuth: [] }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
        },
      },
      schemas: {
        Waiver: waiverSchema,
        Error: errorSchema,
        Pagination: paginationSchema,
      },
    },
    paths: {
      '/v1/public/waivers': {
        get: {
          summary: 'List active waivers',
          description: 'Returns paginated list of active, non-expired waivers with sensitive fields redacted.',
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
          ],
          responses: {
            '200': {
              description: 'List of waivers',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Waiver' } },
                      pagination: { $ref: '#/components/schemas/Pagination' },
                    },
                  },
                },
              },
            },
            '403': { description: 'Missing or invalid API key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            '429': { description: 'Rate limit exceeded', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/v1/public/waivers/{id}': {
        get: {
          summary: 'Get waiver by ID',
          description: 'Returns a single active waiver by ID with sensitive fields redacted.',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Waiver details',
              content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Waiver' } } } } },
            },
            '404': { description: 'Waiver not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            '403': { description: 'Missing or invalid API key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/v1/public/waivers/search': {
        get: {
          summary: 'Search waivers',
          description: 'Search active waivers by airline, date range, and route.',
          parameters: [
            { name: 'airline', in: 'query', schema: { type: 'string' }, description: 'IATA airline code (case-insensitive)' },
            { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Filter waivers effective from this date' },
            { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Filter waivers effective until this date' },
            { name: 'airport', in: 'query', schema: { type: 'string' }, description: 'IATA airport or city code to filter by' },
            { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Search by waiver code, airline code, title, or airport' },
          ],
          responses: {
            '200': {
              description: 'Search results',
              content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Waiver' } } } } } },
            },
            '403': { description: 'Missing or invalid API key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            '429': { description: 'Rate limit exceeded', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/v1/public/docs': {
        get: {
          summary: 'OpenAPI specification',
          description: 'Returns the OpenAPI 3.0 JSON specification. No API key required.',
          security: [],
          responses: {
            '200': { description: 'OpenAPI spec JSON' },
          },
        },
      },
    },
  };
}
