# Requirements Document

## Introduction

The Waiver Data Hub currently exposes a Cognito-protected REST API consumed by its React UI. Third-party systems — GDS platforms, travel management tools, and airline booking systems — need read-only access to approved waiver data without requiring Cognito credentials. This feature adds a public API under `/v1/public/` that uses API key authentication via API Gateway usage plans, with rate limiting, quotas, and sensitive-field redaction. An admin-facing API key management UI is added to the Settings page.

## Glossary

- **Public_API**: The set of read-only HTTP endpoints under `/v1/public/` that use API key authentication instead of Cognito
- **API_Key**: A secret token issued by API Gateway, associated with a usage plan, used to authenticate third-party requests via the `x-api-key` header
- **Usage_Plan**: An API Gateway resource that defines rate limits (requests per second) and quotas (requests per day/month) for one or more API keys
- **API_Key_Record**: A DynamoDB item storing metadata about an issued API key (name, creation date, API Gateway key ID, active status)
- **Public_Handler**: The Lambda function that processes requests to `/v1/public/` endpoints
- **Waiver**: A structured record in the Waivers DynamoDB table representing an airline fare waiver
- **Sensitive_Fields**: The fields `source_s3_key`, `normalized_s3_key`, and `reviewer_id` that are excluded from public API responses
- **Settings_Page**: The admin UI page where API keys are created, revoked, and monitored
- **OpenAPI_Spec**: A machine-readable JSON document describing the public API endpoints, served at `/v1/public/docs`

## Requirements

### Requirement 1: API Key Authentication

**User Story:** As a third-party integrator, I want to authenticate using an API key in the `x-api-key` header, so that I can access waiver data without needing Cognito credentials.

#### Acceptance Criteria

1. WHEN a request to a `/v1/public/` endpoint includes a valid `x-api-key` header, THE Public_API SHALL authenticate the request and proceed to the requested handler
2. WHEN a request to a `/v1/public/` endpoint is missing the `x-api-key` header, THE Public_API SHALL return HTTP 403 with error code `FORBIDDEN` and message "Missing or invalid API key"
3. WHEN a request to a `/v1/public/` endpoint includes an invalid or revoked API key, THE Public_API SHALL return HTTP 403 with error code `FORBIDDEN` and message "Missing or invalid API key"
4. THE Public_API SHALL use API Gateway's built-in API key validation (not custom Lambda authorizer logic) for `/v1/public/` endpoints

### Requirement 2: Usage Plans with Rate Limiting and Quotas

**User Story:** As a platform administrator, I want each API key to be governed by rate limits and quotas, so that no single consumer can overwhelm the system.

#### Acceptance Criteria

1. THE Usage_Plan SHALL enforce a default rate limit of 10 requests per second per API key
2. THE Usage_Plan SHALL enforce a default burst limit of 20 requests per API key
3. THE Usage_Plan SHALL enforce a default quota of 10,000 requests per day per API key
4. WHEN a request exceeds the rate limit or quota, THE Public_API SHALL return HTTP 429 with error code `RATE_LIMIT_EXCEEDED` and a message indicating the limit that was exceeded

### Requirement 3: List Active Waivers Endpoint

**User Story:** As a third-party integrator, I want to list all currently active waivers, so that I can display up-to-date fare waiver information in my system.

#### Acceptance Criteria

1. WHEN a GET request is made to `/v1/public/waivers`, THE Public_Handler SHALL return only waivers with status `active` and `expiration_date` in the future
2. THE Public_Handler SHALL return the response in the format `{ "data": [...] }` consistent with existing API patterns
3. THE Public_Handler SHALL exclude the fields `source_s3_key`, `normalized_s3_key`, and `reviewer_id` from each waiver object in the response
4. WHEN the optional query parameter `page` is provided, THE Public_Handler SHALL paginate results with a default page size of 20 and a maximum page size of 100
5. THE Public_Handler SHALL include a `pagination` object with `page`, `pageSize`, `totalCount`, and `totalPages` in the response

### Requirement 4: Get Waiver by ID Endpoint

**User Story:** As a third-party integrator, I want to retrieve a specific waiver by its ID, so that I can display detailed waiver information.

#### Acceptance Criteria

1. WHEN a GET request is made to `/v1/public/waivers/{id}` with a valid waiver ID, THE Public_Handler SHALL return the waiver in the format `{ "data": { ... } }`
2. WHEN the requested waiver does not have status `active`, THE Public_Handler SHALL return HTTP 404 with error code `NOT_FOUND`
3. WHEN the requested waiver ID does not exist, THE Public_Handler SHALL return HTTP 404 with error code `NOT_FOUND`
4. THE Public_Handler SHALL exclude the fields `source_s3_key`, `normalized_s3_key`, and `reviewer_id` from the response

### Requirement 5: Search Waivers Endpoint

**User Story:** As a third-party integrator, I want to search waivers by airline code, date range, and route, so that I can find relevant waivers for specific travel scenarios.

#### Acceptance Criteria

1. WHEN a GET request is made to `/v1/public/waivers/search` with query parameter `airline`, THE Public_Handler SHALL filter results to waivers matching that airline code (case-insensitive)
2. WHEN query parameters `dateFrom` and/or `dateTo` are provided, THE Public_Handler SHALL filter results to waivers whose effective period overlaps the specified date range
3. WHEN query parameter `route` is provided, THE Public_Handler SHALL filter results to waivers whose `applicable_routes` array contains the specified route
4. THE Public_Handler SHALL only return waivers with status `active` and `expiration_date` in the future, regardless of search filters
5. THE Public_Handler SHALL exclude the fields `source_s3_key`, `normalized_s3_key`, and `reviewer_id` from each waiver in the response
6. THE Public_Handler SHALL return the response in the format `{ "data": [...] }` consistent with existing API patterns

### Requirement 6: API Key Management — Create

**User Story:** As an administrator, I want to create named API keys from the Settings page, so that I can grant third-party systems access to the public API.

#### Acceptance Criteria

1. WHEN an admin submits a POST request to `/v1/settings/api-keys` with a `name` field, THE API_Handler SHALL create a new API Gateway API key and associate it with the Usage_Plan
2. THE API_Handler SHALL store an API_Key_Record in the Settings DynamoDB table containing the key ID, name, creation timestamp, and active status
3. THE API_Handler SHALL return the newly created API key value in the response exactly once (the key value is not retrievable after creation)
4. WHEN the `name` field is missing or empty, THE API_Handler SHALL return HTTP 400 with error code `VALIDATION_ERROR`
5. IF the API Gateway key creation fails, THEN THE API_Handler SHALL return HTTP 500 with error code `INTERNAL_ERROR` and a descriptive message

### Requirement 7: API Key Management — Revoke

**User Story:** As an administrator, I want to revoke API keys, so that I can disable access for third-party systems that should no longer have access.

#### Acceptance Criteria

1. WHEN an admin submits a DELETE request to `/v1/settings/api-keys/{keyId}`, THE API_Handler SHALL delete the API Gateway API key and mark the API_Key_Record as inactive
2. WHEN the specified key ID does not exist, THE API_Handler SHALL return HTTP 404 with error code `NOT_FOUND`
3. WHEN a revoked API key is used in a subsequent request to `/v1/public/`, THE Public_API SHALL reject the request with HTTP 403

### Requirement 8: API Key Management — List and View Usage

**User Story:** As an administrator, I want to view all API keys and their usage statistics, so that I can monitor third-party consumption.

#### Acceptance Criteria

1. WHEN an admin submits a GET request to `/v1/settings/api-keys`, THE API_Handler SHALL return all API_Key_Records with their name, creation date, active status, and usage statistics
2. THE API_Handler SHALL retrieve usage data from the API Gateway usage plan for each key
3. THE API_Handler SHALL return the response in the format `{ "data": [...] }` consistent with existing API patterns

### Requirement 9: Settings Page UI for API Key Management

**User Story:** As an administrator, I want a dedicated section on the Settings page to manage API keys, so that I can create, view, and revoke keys without using the API directly.

#### Acceptance Criteria

1. THE Settings_Page SHALL display an "API Keys" card below the existing settings cards
2. THE Settings_Page SHALL display a table of all API keys showing name, creation date, status (active/revoked), and usage count
3. WHEN the admin clicks "Create API Key", THE Settings_Page SHALL display a form requesting a key name, then show the generated key value with a copy button
4. WHEN the admin clicks "Revoke" on an active key, THE Settings_Page SHALL prompt for confirmation before revoking the key
5. THE Settings_Page SHALL only be accessible to users with the `admin` Cognito group role

### Requirement 10: CORS Headers

**User Story:** As a third-party integrator, I want the public API to include CORS headers, so that browser-based applications can consume the API directly.

#### Acceptance Criteria

1. THE Public_API SHALL include `Access-Control-Allow-Origin: *` in all responses from `/v1/public/` endpoints
2. THE Public_API SHALL include `Access-Control-Allow-Headers` with values `Content-Type, X-Api-Key` in preflight responses
3. THE Public_API SHALL respond to OPTIONS requests on `/v1/public/` endpoints with HTTP 200 and appropriate CORS headers

### Requirement 11: OpenAPI Documentation Endpoint

**User Story:** As a third-party integrator, I want to access machine-readable API documentation, so that I can auto-generate client SDKs and understand the API contract.

#### Acceptance Criteria

1. WHEN a GET request is made to `/v1/public/docs`, THE Public_Handler SHALL return a valid OpenAPI 3.0 JSON specification describing all `/v1/public/` endpoints
2. THE OpenAPI_Spec SHALL include request parameters, response schemas, authentication requirements, and error response formats for each endpoint
3. THE `/v1/public/docs` endpoint SHALL be accessible without an API key

### Requirement 12: CDK Infrastructure for Public API

**User Story:** As a developer, I want the public API infrastructure defined in CDK, so that usage plans, API keys, and public endpoints are deployed consistently.

#### Acceptance Criteria

1. THE ApiStack SHALL define a separate resource tree under `/v1/public/` with `apiKeyRequired: true` method options
2. THE ApiStack SHALL create a Usage_Plan with the configured rate limit, burst limit, and daily quota
3. THE ApiStack SHALL create a dedicated Lambda function (or reuse the existing API Lambda) for handling `/v1/public/` routes
4. THE ApiStack SHALL configure CORS preflight for `/v1/public/` resources allowing the `X-Api-Key` header
5. THE ApiStack SHALL output the Usage_Plan ID and public API base URL as CloudFormation outputs

### Requirement 13: Response Field Redaction

**User Story:** As a platform administrator, I want sensitive internal fields excluded from public responses, so that internal implementation details are not exposed to third parties.

#### Acceptance Criteria

1. THE Public_Handler SHALL remove `source_s3_key` from every waiver object before returning it in a public API response
2. THE Public_Handler SHALL remove `normalized_s3_key` from every waiver object before returning it in a public API response
3. THE Public_Handler SHALL remove `reviewer_id` from every waiver object before returning it in a public API response
4. FOR ALL waiver objects returned by the Public_Handler, serializing the response then deserializing it SHALL produce an object that does not contain any Sensitive_Fields (round-trip redaction property)
