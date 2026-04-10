# Implementation Plan: Configurable Extraction Fields

## Overview

Replace the 9 hardcoded extraction fields with a dynamic, admin-configurable field schema stored in DynamoDB. The implementation proceeds bottom-up: shared types and default schema first, then API endpoints, extraction Lambda changes, infrastructure wiring, and finally UI components (Settings Field Editor, WaiverDetail dynamic form, source viewer, list/queue pages).

## Tasks

- [x] 1. Create shared FieldDefinition type and DEFAULT_SCHEMA constant
  - [x] 1.1 Create `lambdas/src/shared/field-schema.ts` with `FieldDefinition` interface, `FieldSchema` type, validation function `validateFieldSchema()`, and `DEFAULT_SCHEMA` constant containing the 9 original fields with key, label, type, definition, required, and order properties
    - Export `FieldDefinition`, `FieldSchema`, `validateFieldSchema`, `DEFAULT_SCHEMA`
    - `validateFieldSchema` must check: no duplicate keys, all required properties present, key matches `/^[a-z][a-z0-9_]*$/`, type is one of `text | date | array | textarea`, at least 1 field, order is integer ≥ 0
    - Return `{ valid: true }` or `{ valid: false, error: string }` with a descriptive message
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 10.1, 10.2, 10.3, 10.4_

  - [ ]* 1.2 Write property test for schema validation (Property 2)
    - **Property 2: Schema validation rejects invalid schemas**
    - Use fast-check to generate schemas with duplicate keys, missing properties, bad key format, invalid type values
    - Assert `validateFieldSchema` returns `{ valid: false }` for every invalid schema
    - **Validates: Requirements 1.3, 1.4, 1.5, 2.3, 2.4**

- [x] 2. Implement API endpoints for extraction fields
  - [x] 2.1 Add `GET /v1/settings/extraction-fields` and `PUT /v1/settings/extraction-fields` route handlers in `lambdas/src/api/handler.ts`
    - GET: read from Settings table key `extraction_fields`, parse JSON value, return sorted by `order`; if not found, return `DEFAULT_SCHEMA`
    - PUT: parse body as `FieldSchema`, call `validateFieldSchema`, return 400 on failure; check role is `admin` (return 403 otherwise); persist to Settings table as JSON-stringified value with `updated_at`; return saved schema
    - Import `DEFAULT_SCHEMA`, `validateFieldSchema`, `FieldSchema` from `../shared/field-schema`
    - _Requirements: 1.2, 2.1, 2.2, 2.3, 2.4, 2.5, 10.1_

  - [x] 2.2 Add routes in `infra/lib/api-stack.ts` for the new endpoints
    - Under the existing `/v1/settings` resource, add `extraction-fields` sub-resource
    - Wire GET and PUT methods to the existing `apiIntegration` with `authOpts`
    - _Requirements: 2.1, 2.2_

  - [x] 2.3 Wire the router in `lambdas/src/api/handler.ts` to dispatch `GET /v1/settings/extraction-fields` and `PUT /v1/settings/extraction-fields` to the new handlers
    - Add routing conditions in the `handler()` function matching `segments[1] === 'settings'` and `segments[2] === 'extraction-fields'`
    - _Requirements: 2.1, 2.2, 2.5_

  - [ ]* 2.4 Write property test for schema round-trip (Property 1)
    - **Property 1: Schema storage round-trip**
    - Use fast-check to generate valid `FieldSchema` arrays, PUT then GET, assert equivalence
    - **Validates: Requirements 1.1, 2.1, 2.2**

  - [ ]* 2.5 Write property test for non-admin PUT returns 403 (Property 3)
    - **Property 3: Non-admin PUT returns 403**
    - Use fast-check to generate random schemas and non-admin roles (`reviewer`, `api_consumer`), assert 403
    - **Validates: Requirements 2.5**

- [ ] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Update Extraction Lambda for dynamic schema
  - [x] 4.1 Modify `lambdas/src/extraction/handler.ts` to fetch schema from Settings table and build dynamic prompt
    - Import `DEFAULT_SCHEMA`, `FieldSchema`, `FieldDefinition` from `../shared/field-schema`
    - Add `SETTINGS_TABLE` env var usage and DynamoDB `GetItem` call to fetch `extraction_fields` at the start of `handler()`
    - Fall back to `DEFAULT_SCHEMA` if fetch fails, log warning
    - Refactor `buildExtractionPrompt()` to accept `FieldSchema` and iterate over fields to produce per-field instructions with type-specific formatting and `definition` text
    - Refactor `parseBedrockResponse()` to accept `FieldSchema` and dynamically extract fields based on schema keys (text/textarea → string, date → string, array → array of strings)
    - Refactor `computeOverallConfidence()` to accept dynamic confidence scores keyed by schema field keys
    - Remove hardcoded `ConfidenceScores` interface, `CONFIDENCE_FIELDS`, and `ExtractedWaiverData` — replace with dynamic `Record<string, unknown>` driven by schema
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3_

  - [ ]* 4.2 Write property test for dynamic prompt construction (Property 4)
    - **Property 4: Dynamic prompt contains all schema fields**
    - Use fast-check to generate valid schemas, call `buildExtractionPrompt`, assert prompt contains every field key, type-appropriate instruction, definition text, and confidence_scores section
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

  - [ ]* 4.3 Write property test for confidence score completeness (Property 5)
    - **Property 5: Confidence score completeness and overall computation**
    - Use fast-check to generate valid schemas and score maps, assert all fields have scores and overall = min
    - **Validates: Requirements 4.1, 4.2, 4.3**

- [x] 5. Update save draft API to use dynamic schema
  - [x] 5.1 Modify `saveDraft()` in `lambdas/src/api/handler.ts` to read schema from Settings table and build editable field list dynamically
    - Replace hardcoded `editable` array with `schema.map(f => f.key)`
    - Fetch schema from Settings table (fall back to `DEFAULT_SCHEMA`)
    - Ignore request body fields not in the schema
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ]* 5.2 Write property test for save draft schema filtering (Property 9)
    - **Property 9: Save draft persists only schema-defined fields**
    - Use fast-check to generate schemas and request bodies with extra fields, assert only schema fields persisted
    - **Validates: Requirements 8.1, 8.2, 8.3**

- [x] 6. Infrastructure changes for Extraction Lambda
  - [x] 6.1 Update `infra/lib/pipeline-stack.ts` to add `SETTINGS_TABLE` env var and `dynamodb:GetItem` permission for the extraction Lambda
    - Add `SETTINGS_TABLE: props.tableNames.settings` to `extractFn` environment
    - Add IAM policy statement granting `dynamodb:GetItem` on the Settings table ARN to `extractFn`
    - _Requirements: 11.1, 11.2_

- [ ] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement Settings page Field Editor
  - [x] 8.1 Add Field Definitions card to `ui/src/pages/Settings.tsx`
    - Fetch schema via `GET /v1/settings/extraction-fields` using `useQuery`
    - Render a list of all `FieldDefinition` objects with inline editing for `key`, `label`, `type` (dropdown), `definition`, `required` (checkbox), `order`
    - Add button to create a new field with sensible defaults
    - Remove button with confirmation to delete a field
    - Up/down buttons to reorder fields (adjust `order` values)
    - Save button sends `PUT /v1/settings/extraction-fields` via `useMutation`
    - Display API validation errors on failure
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

- [x] 9. Implement dynamic WaiverDetail form and source viewer
  - [x] 9.1 Refactor `ui/src/pages/WaiverDetail.tsx` to fetch schema and render form dynamically
    - Fetch `FieldSchema` from `GET /v1/settings/extraction-fields` on mount using `useQuery`
    - Replace hardcoded `FormFields` type, `FIELD_LABELS`, `REQUIRED_FIELDS`, and `FIELD_COLORS` with schema-driven equivalents
    - Render inputs dynamically: `text` → `<input type="text">`, `date` → `<input type="date">`, `array` → `<input type="text">` (comma-separated), `textarea` → `<textarea>`
    - Display fields in ascending `order`, use `label` for labels
    - Mark `required` fields and validate non-empty before save
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [x] 9.2 Update source viewer highlighting to use dynamic colors from schema
    - Replace hardcoded `FIELD_COLORS` with a `COLOR_PALETTE` array and `getFieldColor(index)` function
    - Assign colors based on field index in the schema
    - Display field `label` in the highlight legend
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ]* 9.3 Write property test for required field validation (Property 7)
    - **Property 7: Required field validation**
    - Use fast-check to generate schemas with random required flags and form states with empty required fields, assert validation errors
    - **Validates: Requirements 5.8**

  - [ ]* 9.4 Write property test for distinct highlight colors (Property 8)
    - **Property 8: Distinct highlight color per field**
    - Use fast-check to generate schemas with N fields (N ≤ palette size), assert N distinct colors assigned
    - **Validates: Requirements 6.1, 6.2**

- [x] 10. Update WaiverList and ReviewQueue for dynamic fields
  - [x] 10.1 Refactor `ui/src/pages/WaiverList.tsx` and `ui/src/pages/ReviewQueue.tsx` to fetch schema and display columns dynamically
    - Fetch `FieldSchema` on mount
    - Display columns for fields where `required` is true (or all fields, space permitting)
    - New fields appear automatically without code changes
    - _Requirements: 9.1, 9.2, 9.3_

- [ ] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties using fast-check
- Unit tests validate specific examples and edge cases
