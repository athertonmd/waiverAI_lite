# Implementation Plan: Mantic Point Field Alignment

## Overview

Align the WaiverHub extraction schema with the Mantic Point Solutions "Waiver Automation Fields" specification. The implementation updates the `DEFAULT_SCHEMA` source of truth (7 new fields, 1 rename), then propagates changes through the storage layer, public API, internal API, and UI. No DynamoDB migrations or CDK infrastructure changes are needed.

## Tasks

- [x] 1. Update DEFAULT_SCHEMA in field-schema.ts
  - [x] 1.1 Replace the `DEFAULT_SCHEMA` array in `lambdas/src/shared/field-schema.ts` with 16 fields
    - Remove the `applicable_routes` entry
    - Add `airports` (type array, required false, order 11) with definition for IATA 3-letter airport/city codes
    - Add `airline_name` (type text, required true, order 1) with definition to extract full airline name from document
    - Add `issued_date` (type date, required true, order 4) with definition for waiver issue date in ISO 8601
    - Add `release_notes` (type textarea, required true, order 15) with definition noting 500-character limit
    - Add `ticket_issued_qualifier` (type text, required true, order 8) with definition for "on or before", "on or after", "between"
    - Add `ticket_issued_date` (type date, required true, order 9) with definition for ticket issuance date in ISO 8601
    - Add `travel_dates_qualifier` (type text, required true, order 7) with definition distinguishing from waiver validity dates
    - Add `airports_qualifier` (type text, required true, order 10) with definition for "From", "To", "From-To"
    - Reorder existing fields: airline_code=0, waiver_title=2, waiver_code=3, effective_date=5, expiration_date=6, fare_classes=12, rebooking_rules=13, refund_rules=14
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 3.1, 3.2, 10.1, 10.2, 10.3_

  - [ ]* 1.2 Write unit tests for DEFAULT_SCHEMA structure
    - Verify exactly 16 fields exist
    - Verify all keys, labels, types, required flags, and order values match the spec
    - Verify `applicable_routes` is absent and `airports` is present
    - Verify `travel_dates_qualifier` definition distinguishes from waiver validity dates
    - _Requirements: 1.1–1.7, 2.1, 3.1, 3.2, 10.1, 10.2, 10.3_

- [x] 2. Update Storage Lambda for schema-driven persistence
  - [x] 2.1 Refactor `handler` function in `lambdas/src/storage/handler.ts` to build the DynamoDB item dynamically
    - Import `DEFAULT_SCHEMA` from `../shared/field-schema`
    - Replace the hardcoded field assignments with a loop over `DEFAULT_SCHEMA` fields, copying values from the extracted record
    - Add backward-compat mapping: if record has `applicable_routes` but not `airports`, map it to `airports`
    - Keep system fields (id, confidence_scores, overall_confidence, status, source_type, source_s3_key, source_url, normalized_s3_key, ingestion_timestamp, extraction_timestamp, version_number, is_duplicate, duplicate_of_id, created_at, updated_at) as explicit assignments
    - _Requirements: 2.2, 2.3, 5.1_

  - [x] 2.2 Refactor `upsertWaiver` function to use schema-driven field persistence
    - Replace hardcoded field assignments with a loop over `DEFAULT_SCHEMA`
    - Add backward-compat mapping for `applicable_routes` → `airports`
    - _Requirements: 5.3_

  - [x] 2.3 Refactor `ai_extraction` snapshot in both `handler` and `upsertWaiver` to use schema-driven field list
    - Replace the hardcoded `checkFields` array with `DEFAULT_SCHEMA.map(f => f.key)`
    - _Requirements: 5.2_

  - [ ]* 2.4 Write property test: Schema-driven field persistence round-trip (Property 1)
    - **Property 1: Schema-driven field persistence round-trip**
    - Generate random field schemas and extracted records containing values for those fields
    - Call the storage item-building logic
    - Assert all schema field values appear as top-level attributes and in the `ai_extraction` snapshot
    - **Validates: Requirements 2.2, 5.1, 5.2, 5.3**

  - [ ]* 2.5 Write property test: Backward-compatible applicable_routes → airports mapping (Property 2)
    - **Property 2: Backward-compatible applicable_routes → airports mapping**
    - Generate random extracted records with `applicable_routes` but no `airports`
    - Call the storage item-building logic
    - Assert stored item has `airports` equal to original `applicable_routes`
    - **Validates: Requirements 2.3**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Update Public API OpenAPI spec and handler
  - [x] 4.1 Update `waiverSchema` in `lambdas/src/public-api/openapi-spec.ts`
    - Add property definitions for `issued_date`, `airline_name`, `release_notes`, `ticket_issued_qualifier`, `ticket_issued_date`, `travel_dates_qualifier`, `airports_qualifier`
    - Replace `applicable_routes` property with `airports` (type array, items string)
    - Replace `route` search parameter with `airport` (description: "IATA airport or city code to filter by")
    - Add `search` query parameter to the search endpoint (description: "Search by waiver code, airline code, title, or airport")
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [x] 4.2 Update `searchWaivers` in `lambdas/src/public-api/handler.ts` to filter on `airports`
    - Replace `qs.route` filter with `qs.airport` filter checking `airports` array (with `applicable_routes` fallback), case-insensitive
    - Add `qs.search` filter to search by waiver_code, airline_code, waiver_title, or airports
    - _Requirements: 7.3_

  - [x] 4.3 Update `listActiveWaivers` in `lambdas/src/public-api/handler.ts` to search `airports` field
    - Update the search filter to check `airports` (with `applicable_routes` fallback) in addition to existing fields
    - _Requirements: 7.2, 7.3_

  - [ ]* 4.4 Write property test: Airport search filtering correctness (Property 5)
    - **Property 5: Airport search filtering correctness**
    - Generate random waiver record sets with random `airports` arrays and random airport code queries
    - Apply the search filter logic
    - Assert results contain exactly those records whose `airports` (or legacy `applicable_routes`) array contains the queried code (case-insensitive)
    - **Validates: Requirements 7.3**

  - [ ]* 4.5 Write unit tests for OpenAPI spec updates
    - Call `getOpenApiSpec()` and verify `waiverSchema.properties` contains all 7 new field keys
    - Verify `applicable_routes` is absent, `airports` is present
    - Verify search endpoint has `airport` and `search` parameters, `route` is absent
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [x] 5. Update Internal API handler validation
  - [x] 5.1 Add `release_notes` 500-character validation in `saveDraft` in `lambdas/src/api/handler.ts`
    - After parsing the body, check if `body.release_notes` is defined and its string length exceeds 500
    - Return 400 error with code `VALIDATION_ERROR` and message "release_notes must not exceed 500 characters"
    - _Requirements: 6.3_

  - [x] 5.2 Update hardcoded `checkFields` arrays in `saveDraft` and `recordCorrections` in `lambdas/src/api/handler.ts`
    - Replace the hardcoded `checkFields` arrays with schema-driven field lists derived from `DEFAULT_SCHEMA`
    - _Requirements: 5.2_

  - [ ]* 5.3 Write property test: release_notes length validation (Property 4)
    - **Property 4: release_notes length validation**
    - Generate random strings of varying lengths (0–1000 characters)
    - Apply the validation logic
    - Assert strings > 500 chars are rejected with 400, strings ≤ 500 chars are not rejected for length
    - **Validates: Requirements 6.3**

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Update PublicWaiverDetail UI for dynamic field rendering
  - [x] 7.1 Replace hardcoded `FIELDS` array in `ui/src/pages/PublicWaiverDetail.tsx` with dynamic rendering
    - Remove the static `FIELDS` array
    - Define a `KNOWN_FIELD_ORDER` list to control display order for known fields
    - Define a `SYSTEM_FIELDS` set of keys to exclude (id, status, overall_confidence, confidence_scores, source_type, source_s3_key, normalized_s3_key, ingestion_timestamp, extraction_timestamp, approval_timestamp, reviewer_id, rejection_reason, version_number, created_at, updated_at, is_duplicate, duplicate_of_id, duplicate_count, ai_extraction, source_url, screenshot_s3_key)
    - Render all non-system fields present on the waiver record, ordered by `KNOWN_FIELD_ORDER` with unknown fields appended
    - For backward compat: if `applicable_routes` is present but `airports` is not, display under "Airports" label
    - _Requirements: 7.1, 8.2_

- [x] 8. Update WaiverDetail UI for release_notes and backward compat
  - [x] 8.1 Add character counter and maxLength for `release_notes` textarea in `ui/src/pages/WaiverDetail.tsx`
    - When the field key is `release_notes`, add `maxLength={500}` to the textarea element
    - Render a character counter (`{length}/500`) below the textarea
    - Apply to both the main form and the expanded panel form
    - _Requirements: 6.1, 6.2_

  - [x] 8.2 Add backward-compat fallback for `applicable_routes` → `airports` in form population
    - In the `useEffect` that populates the form from the waiver record, if the schema contains `airports` but the record only has `applicable_routes`, use the `applicable_routes` value for the `airports` form field
    - _Requirements: 8.1, 8.3_

- [x] 9. Verify extraction prompt handles qualifier fields
  - [ ]* 9.1 Write property test: Extraction prompt includes all field definitions (Property 3)
    - **Property 3: Extraction prompt includes all field definitions**
    - Generate random valid field schemas with random definition strings
    - Call `buildExtractionPrompt` with those schemas
    - Assert every field's definition text appears in the resulting prompt string
    - **Validates: Requirements 4.4**

  - [ ]* 9.2 Write unit tests for extraction prompt qualifier instructions
    - Call `buildExtractionPrompt` with the updated DEFAULT_SCHEMA
    - Verify prompt contains "on or before", "on or after", "between" for `ticket_issued_qualifier` and `travel_dates_qualifier`
    - Verify prompt contains "From", "To", "From-To" for `airports_qualifier`
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The extraction Lambda already reads schema dynamically — no code changes needed there beyond the DEFAULT_SCHEMA update
- No DynamoDB schema changes or CDK infrastructure changes are required
- Tests use Jest with ts-jest in the `lambdas` workspace
