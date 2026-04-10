# Implementation Plan: Public API

## Overview

Incrementally build a read-only public API under `/v1/public/` with API key authentication, field redaction, admin key management, Settings UI, and OpenAPI docs. Each task builds on the previous, ending with integration wiring in CDK.

## Tasks

- [x] 1. Create field redaction utility
  - [x] 1.1 Create `lambdas/src/public-api/redact.ts`
    - Define `SENSITIVE_FIELDS` array: `['source_s3_key', 'normalized_s3_key', 'reviewer_id']`
    - Export `redactWaiver(waiver)` that returns a shallow copy with sensitive fields deleted
    - Export `redactWaivers(waivers)` that maps `redactWaiver` over an array
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [ ]* 1.2 Write unit tests for redaction utility
    - Create `lambdas/src/public-api/__tests__/redact.test.ts`
    - Test that `redactWaiver` removes all three sensitive fields
    - Test that non-sensitive fields are preserved
    - Test that `redactWaivers` applies redaction to every item in the array
    - Test round-trip: `JSON.parse(JSON.stringify(redactWaiver(w)))` contains no sensitive fields
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

- [x] 2. Create public API handler
  - [x] 2.1 Create `lambdas/src/public-api/handler.ts` with router and helpers
    - Import `docClient`, `TableNames` from `../shared/db`
    - Import `redactWaiver`, `redactWaivers` from `./redact`
    - Reuse the same `CORS_HEADERS`, `json()`, `errorResponse()` helper pattern from the existing API handler
    - Implement path-segment router matching `/v1/public/waivers`, `/v1/public/waivers/{id}`, `/v1/public/waivers/search`, `/v1/public/docs`
    - Handle OPTIONS preflight returning 200 with CORS headers including `X-Api-Key`
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 2.2 Implement `GET /v1/public/waivers` — list active waivers
    - Query waivers table filtering `status = 'active'` and `expiration_date > now`
    - Support `page` and `pageSize` query params (default 20, max 100)
    - Return `{ data: RedactedWaiver[], pagination: { page, pageSize, totalCount, totalPages } }`
    - Apply `redactWaivers` before returning
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 2.3 Implement `GET /v1/public/waivers/{id}` — get waiver by ID
    - Fetch waiver by ID from waivers table
    - Return 404 if not found or status is not `active`
    - Apply `redactWaiver` before returning
    - Return `{ data: RedactedWaiver }`
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 2.4 Implement `GET /v1/public/waivers/search` — search active waivers
    - Accept query params: `airline`, `dateFrom`, `dateTo`, `route`
    - Filter only `active` waivers with `expiration_date` in the future
    - Apply case-insensitive airline matching
    - Filter `applicable_routes` contains `route`
    - Apply `redactWaivers` before returning
    - Return `{ data: RedactedWaiver[] }`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]* 2.5 Write unit tests for public API handler
    - Create `lambdas/src/public-api/__tests__/handler.test.ts`
    - Mock `docClient` and `TableNames`
    - Test list endpoint returns only active, non-expired waivers with redacted fields
    - Test get-by-id returns 404 for non-active waivers
    - Test search filters by airline, date range, and route
    - Test OPTIONS returns CORS headers
    - Test pagination parameters are respected
    - _Requirements: 3.1, 3.3, 4.2, 4.4, 5.1, 5.4, 5.5, 10.1, 10.3_

- [x] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Create OpenAPI spec and docs endpoint
  - [x] 4.1 Create `lambdas/src/public-api/openapi-spec.ts`
    - Export `getOpenApiSpec(apiBaseUrl?)` returning a valid OpenAPI 3.0 JSON object
    - Describe all three public endpoints with request parameters, response schemas, auth requirements, and error formats
    - Include `securitySchemes` for API key in `x-api-key` header
    - _Requirements: 11.1, 11.2_

  - [x] 4.2 Wire `/v1/public/docs` route in the public handler
    - Return the OpenAPI spec JSON from `GET /v1/public/docs`
    - This endpoint does not require an API key (handled at API Gateway level)
    - _Requirements: 11.1, 11.3_

- [ ] 5. Add API key management routes to existing API handler
  - [x] 5.1 Add `POST /v1/settings/api-keys` route to `lambdas/src/api/handler.ts`
    - Require admin role
    - Parse `{ name }` from body; return 400 if missing/empty
    - Call API Gateway `CreateApiKey` and `CreateUsagePlanKey` SDK methods
    - Store `ApiKeyRecord` in Settings table with `apikey#<keyId>` partition key
    - Return `{ data: { keyId, name, value, createdAt } }` with the key value shown once
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 5.2 Add `DELETE /v1/settings/api-keys/{keyId}` route to `lambdas/src/api/handler.ts`
    - Require admin role
    - Call API Gateway `DeleteApiKey` SDK method
    - Update the `ApiKeyRecord` in Settings table to `active: false`
    - Return 404 if key record not found
    - Return `{ data: { keyId, deleted: true } }`
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 5.3 Add `GET /v1/settings/api-keys` route to `lambdas/src/api/handler.ts`
    - Require admin role
    - Scan Settings table with `begins_with(key, 'apikey#')` filter
    - For each key, fetch usage data from API Gateway `GetUsage` SDK method
    - Return `{ data: ApiKeyRecord[] }` with usage stats
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ]* 5.4 Write unit tests for API key management routes
    - Add tests to `lambdas/src/api/__tests__/handler.test.ts`
    - Mock API Gateway SDK calls (`CreateApiKey`, `DeleteApiKey`, `GetUsage`, `CreateUsagePlanKey`)
    - Test create returns key value and stores metadata
    - Test create with missing name returns 400
    - Test delete marks record inactive
    - Test delete with unknown keyId returns 404
    - Test list returns all `apikey#` prefixed records
    - Test non-admin role returns 403
    - _Requirements: 6.1, 6.4, 7.1, 7.2, 8.1_

- [x] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. CDK infrastructure changes
  - [x] 7.1 Add public API Lambda and `/v1/public/` resource tree to `infra/lib/api-stack.ts`
    - Create a new `NodejsFunction` for `lambdas/src/public-api/handler.ts`
    - Grant read-only DynamoDB access to the waivers table
    - Add `/v1/public/waivers`, `/v1/public/waivers/{id}`, `/v1/public/waivers/search` resources with `apiKeyRequired: true`
    - Add `/v1/public/docs` resource WITHOUT `apiKeyRequired`
    - Configure CORS preflight for `/v1/public/` resources allowing `X-Api-Key` header
    - _Requirements: 12.1, 12.3, 12.4, 1.4, 11.3_

  - [x] 7.2 Add Usage Plan and API key association resources
    - Create `UsagePlan` with rate limit 10 rps, burst 20, quota 10,000/day
    - Associate the usage plan with the API deployment stage
    - Add CloudFormation outputs for Usage Plan ID and public API base URL
    - _Requirements: 12.2, 12.5, 2.1, 2.2, 2.3_

  - [x] 7.3 Add `/v1/settings/api-keys` resource tree to `infra/lib/api-stack.ts`
    - Add `/v1/settings/api-keys` and `/v1/settings/api-keys/{keyId}` resources with Cognito auth
    - Grant the existing API Lambda permissions to call `apigateway:POST`, `apigateway:DELETE`, `apigateway:GET` on API key and usage plan resources
    - Pass `USAGE_PLAN_ID` and `REST_API_ID` as environment variables to the API Lambda
    - _Requirements: 12.1, 6.1, 7.1, 8.2_

- [x] 8. Settings page UI — API Keys card
  - [x] 8.1 Add `ApiKeysCard` component to `ui/src/pages/Settings.tsx`
    - Add below existing `FieldDefinitionsCard`
    - Display table of API keys: name, created date, status badge (active/revoked), usage count
    - Wire to `apiGet('/v1/settings/api-keys')` using `useQuery`
    - _Requirements: 9.1, 9.2, 9.5_

  - [x] 8.2 Add create API key flow
    - "Create API Key" button opens inline form for key name
    - On submit, call `apiPost('/v1/settings/api-keys', { name })`
    - Display generated key value with a copy-to-clipboard button
    - Warn user the key value won't be shown again
    - Invalidate query cache on success
    - _Requirements: 9.3, 6.3_

  - [x] 8.3 Add revoke API key flow
    - "Revoke" button on each active key row
    - Show confirmation prompt before calling `apiDelete('/v1/settings/api-keys/{keyId}')`
    - Invalidate query cache on success
    - _Requirements: 9.4_

- [x] 9. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- The public handler is a separate Lambda from the existing API handler for isolation and simplicity
- API Gateway handles API key validation natively — no custom authorizer needed
