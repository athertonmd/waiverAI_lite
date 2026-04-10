# Implementation Plan: Duplicate Waiver Detection

## Overview

Add duplicate detection to the waiver ingestion pipeline. The implementation proceeds bottom-up: data model changes first, then the detection logic, storage handler integration, API filter support, and finally UI badges and links. Each step builds on the previous one so there is no orphaned code.

## Tasks

- [x] 1. Update data model and infrastructure
  - [x] 1.1 Add `is_duplicate` and `duplicate_of_id` fields to the `WaiverRecord` interface in `shared/src/waiver-record.ts`
    - Add `is_duplicate?: boolean` and `duplicate_of_id?: string | null` to the interface
    - Keep fields optional for backward compatibility with pre-existing records
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 1.2 Add the `airline_code-waiver_code-index` GSI to the Waivers table in `infra/lib/database-stack.ts`
    - Add `addGlobalSecondaryIndex` call with `airline_code` as partition key and `waiver_code` as sort key
    - Use `ProjectionType.ALL`
    - _Requirements: 8.1_

- [x] 2. Implement duplicate detector module
  - [x] 2.1 Create `lambdas/src/storage/duplicate-detector.ts` with `parseWaiverCode` and `checkForDuplicate`
    - Implement `parseWaiverCode` to split waiver codes into base code and optional update number (suffixes: `-U\d+`, `-REV\d+`, `-V\d+`, case-insensitive)
    - Implement `checkForDuplicate` to query the `airline_code-waiver_code-index` GSI for exact `airline_code` + `waiver_code` matches
    - Pick the record with the earliest `created_at` as the original when multiple matches exist
    - Return `{ isDuplicate: false, duplicateOfId: null }` if `airline_code` or `waiver_code` is missing/empty, or if the GSI query fails
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 8.2_

  - [ ]* 2.2 Write property test: waiver code parsing round-trip
    - **Property 3: Waiver code parsing round-trip**
    - **Validates: Requirements 2.1**

  - [ ]* 2.3 Write property test: update-number variants are not duplicates
    - **Property 4: Update-number variants are not duplicates**
    - **Validates: Requirements 2.2**

  - [ ]* 2.4 Write unit tests for `parseWaiverCode` and `checkForDuplicate`
    - Test `parseWaiverCode` with: plain codes, `-U2`, `-REV3`, `-V1`, unusual casing, no suffix
    - Test `checkForDuplicate` with mocked DynamoDB: no match, single match, multiple matches (picks earliest), GSI failure fallback
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

- [x] 3. Integrate duplicate detection into the storage handler
  - [x] 3.1 Modify `lambdas/src/storage/handler.ts` to call `checkForDuplicate` before PutItem
    - Import and call `checkForDuplicate(airline_code, waiver_code)` before building the item
    - Add `is_duplicate` and `duplicate_of_id` to the persisted item based on the result
    - Ensure the record is always persisted regardless of duplicate status
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]* 3.2 Write property test: duplicate detection correctness
    - **Property 1: Duplicate detection correctness**
    - **Validates: Requirements 1.1, 1.2, 1.3, 2.3**

  - [ ]* 3.3 Write property test: record always persisted
    - **Property 2: Record always persisted**
    - **Validates: Requirements 1.4**

  - [ ]* 3.4 Write property test: duplicate metadata consistency invariant
    - **Property 5: Duplicate metadata consistency invariant**
    - **Validates: Requirements 3.1, 3.2**

  - [ ]* 3.5 Write unit tests for storage handler duplicate integration
    - Test that `is_duplicate` and `duplicate_of_id` appear on the PutItem call
    - Test that records are stored even when flagged as duplicates
    - Test fallback behavior when `airline_code` or `waiver_code` is empty
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.1, 3.2, 3.3_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Add API duplicate filter support
  - [x] 5.1 Add `duplicate` query parameter filtering to `listWaivers` in `lambdas/src/api/handler.ts`
    - When `duplicate=true`, filter results to only records where `is_duplicate === true`
    - When `duplicate=false`, filter results to records where `is_duplicate` is `false` or absent
    - Ensure `is_duplicate` and `duplicate_of_id` are included in all waiver responses (already returned by scan/query)
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ]* 5.2 Write property test: API duplicate filter correctness
    - **Property 6: API duplicate filter correctness**
    - **Validates: Requirements 4.3**

  - [ ]* 5.3 Write unit tests for API duplicate filter
    - Test `duplicate=true` returns only duplicates
    - Test `duplicate=false` returns only non-duplicates
    - Test no `duplicate` param returns all records
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 6. Add duplicate badge to WaiverList UI
  - [x] 6.1 Add "Duplicate" badge to `ui/src/pages/WaiverList.tsx`
    - Display a "Duplicate" badge next to the status badge when `is_duplicate === true`
    - Use a distinct colour (e.g. orange/amber) that differentiates from existing status and confidence badges
    - Do not display the badge when `is_duplicate` is `false` or absent
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 7. Add duplicate badge to ReviewQueue UI
  - [x] 7.1 Add "Duplicate" badge to `ui/src/pages/ReviewQueue.tsx`
    - Display a "Duplicate" badge in the waiver row when `is_duplicate === true`
    - Use the same styling as the WaiverList badge for consistency
    - _Requirements: 6.1, 6.2_

- [x] 8. Add duplicate details to WaiverDetail UI
  - [x] 8.1 Add duplicate notice and original waiver link to `ui/src/pages/WaiverDetail.tsx`
    - Display a notice banner when `is_duplicate === true`
    - Show a link to `/waivers/{duplicate_of_id}` when `duplicate_of_id` is non-null
    - Navigate to the original waiver detail page on click
    - Handle the case where the original waiver no longer exists by showing "Original waiver has been removed"
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use `fast-check` with Jest
- The `is_duplicate` field is optional on `WaiverRecord` so pre-existing records without it are treated as non-duplicates
- The GSI deployment (task 1.2) should be done before testing the duplicate detector against a real table
