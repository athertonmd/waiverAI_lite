# Implementation Plan: Duplicate Grouping UI

## Overview

Implement server-side waiver grouping by `airline_code + waiver_code` composite key and update all UI list views to show collapsed duplicate rows with count badges. Add a group copies endpoint for drill-down and a "Previous copies" section on the waiver detail page.

## Tasks

- [x] 1. Implement `groupWaivers` utility function and integrate into list endpoints
  - [x] 1.1 Add the `groupWaivers` function to `lambdas/src/api/handler.ts`
    - Create the `GroupedWaiver` interface extending `Record<string, unknown>` with `duplicate_count: number`
    - Implement `groupWaivers(items)`: build a `Map<string, Record<string, unknown>[]>` keyed by `${airline_code}::${waiver_code}`, select the Latest_Copy per group by `updated_at` DESC then `ingestion_timestamp` DESC tiebreaker, attach `duplicate_count` to each selected record
    - Handle edge cases: records missing `airline_code` or `waiver_code` treated as singletons, missing `updated_at` falls back to `created_at`, missing `ingestion_timestamp` uses empty string
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 7.1, 7.2, 7.3, 8.1, 8.2, 8.4_

  - [ ]* 1.2 Write property tests for `groupWaivers` (Properties 1–3)
    - **Property 1: Grouping produces exactly one record per composite key with correct count**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.6, 7.1, 7.2, 7.3, 8.4**
    - **Property 2: Latest copy is the record with the most recent updated_at**
    - **Validates: Requirements 1.4, 8.1**
    - **Property 3: Tiebreaker selects the most recent ingestion_timestamp**
    - **Validates: Requirements 8.2**
    - Add `fast-check` as a devDependency in `lambdas/package.json`
    - Create property tests in `lambdas/src/api/__tests__/handler.test.ts` using `fc.assert` and `fc.property` with minimum 100 iterations
    - Generate random arrays of waiver-like objects with random 2-char airline codes and waiver codes (some overlapping), with and without `is_duplicate` flags

  - [x] 1.3 Integrate `groupWaivers` into `listWaivers`
    - After filtering and sorting, call `groupWaivers(filtered)` before pagination so `totalCount` reflects grouped count
    - Paginate the grouped results
    - _Requirements: 1.1, 1.2, 1.3, 1.5_

  - [x] 1.4 Integrate `groupWaivers` into `searchWaivers`
    - After filtering and sorting, call `groupWaivers(allItems)` before returning
    - _Requirements: 1.1, 1.2, 1.3, 1.5_

  - [x] 1.5 Integrate `groupWaivers` into `getDashboardMetrics`
    - Apply `groupWaivers()` to the `recent` array before slicing the top 10
    - Include `duplicate_count` in each `recentWaivers` object mapping
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 3.1, 3.2_

  - [ ]* 1.6 Write unit tests for `groupWaivers` integration
    - Test `groupWaivers` with empty array returns empty array
    - Test `groupWaivers` with all unique keys returns all records with `duplicate_count: 1`
    - Test `groupWaivers` with two records sharing a key returns one record with correct `duplicate_count`
    - Test `groupWaivers` with records missing `is_duplicate` flag are still grouped
    - Test tiebreaker: two records with same `updated_at` — verify `ingestion_timestamp` breaks the tie
    - Test `listWaivers` response contains `duplicate_count` on each record
    - Test `getDashboardMetrics` recent waivers contain `duplicate_count`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 7.1, 8.1, 8.2_

- [x] 2. Implement `GET /v1/waivers/group` endpoint
  - [x] 2.1 Add `getGroupCopies` route handler to `lambdas/src/api/handler.ts`
    - Accept `airline` and `waiverCode` query parameters; return 400 with `VALIDATION_ERROR` if either is missing
    - Query the `airline_code-waiver_code-index` GSI with the provided parameters
    - Return all matching records sorted by `ingestion_timestamp` descending
    - Each record includes `id`, `ingestion_timestamp`, `source_type`, `status`, `created_at`, `updated_at`
    - Return `{ data: [] }` with 200 if no records found
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 2.2 Add route to the router in the `handler` function
    - Add `GET /v1/waivers/group` route check (`segments[2] === 'group' && !segments[3]`) before the single-item `GET /v1/waivers/{id}` route to avoid `"group"` being interpreted as a waiver ID
    - _Requirements: 2.1_

  - [ ]* 2.3 Write property tests for group copies endpoint (Properties 4–5)
    - **Property 4: Group copies endpoint returns all matching records sorted by ingestion_timestamp descending**
    - **Validates: Requirements 2.1, 2.2, 6.4**
    - **Property 5: Group copies response includes required fields**
    - **Validates: Requirements 2.3, 8.3**
    - Test the sorting logic and field mapping in isolation using fast-check

  - [ ]* 2.4 Write unit tests for `getGroupCopies`
    - Test missing query params returns 400
    - Test non-existent airline+waiverCode returns empty array with 200
    - Test records are sorted by `ingestion_timestamp` descending
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 3. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Update UI list views with `DuplicateCountBadge`
  - [x] 4.1 Replace `DuplicateBadge` with `DuplicateCountBadge` in `ui/src/pages/WaiverList.tsx`
    - Replace the existing `DuplicateBadge` component with `DuplicateCountBadge({ count })` that renders `Duplicate (N)` when `count > 1` and nothing when `count <= 1`
    - Update the `Waiver` interface to include `duplicate_count?: number`
    - Replace `{w.is_duplicate && <DuplicateBadge />}` with `<DuplicateCountBadge count={w.duplicate_count ?? 1} />`
    - Use same orange styling: `background: '#fff3e0', color: '#e65100'`
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 4.2 Replace inline duplicate badge with `DuplicateCountBadge` in `ui/src/pages/Dashboard.tsx`
    - Update the `RecentWaiver` interface to include `duplicate_count?: number`
    - Replace the inline `{w.is_duplicate && <span ...>Duplicate</span>}` with `<DuplicateCountBadge count={w.duplicate_count ?? 1} />`
    - Define `DuplicateCountBadge` locally or import from a shared location
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 4.3 Replace inline duplicate badge with `DuplicateCountBadge` in `ui/src/pages/ReviewQueue.tsx`
    - Update the `Waiver` interface to include `duplicate_count?: number`
    - Replace `{w.is_duplicate && <span ...>Duplicate</span>}` with `<DuplicateCountBadge count={w.duplicate_count ?? 1} />`
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ]* 4.4 Write property test for DuplicateCountBadge (Property 6)
    - **Property 6: DuplicateCountBadge renders if and only if count exceeds 1**
    - **Validates: Requirements 3.1, 3.2, 4.1, 4.2, 5.1, 5.2**
    - Use fast-check to generate random integers 0–100, verify badge renders `Duplicate (N)` for N > 1 and returns null for N <= 1

- [x] 5. Add "Previous copies" section to WaiverDetail
  - [x] 5.1 Add previous copies fetch and display to `ui/src/pages/WaiverDetail.tsx`
    - When the loaded waiver has `duplicate_count > 1`, fetch all copies via `apiGet('/v1/waivers/group', { airline: waiver.airline_code, waiverCode: waiver.waiver_code })`
    - Display a "Previous copies" section below the existing content (after the version history section)
    - Show a table of all copies excluding the current waiver, each row with: `ingestion_timestamp`, `source_type`, `updated_at`, and a clickable link navigating to `/waivers/{copy.id}`
    - Sort by `ingestion_timestamp` descending
    - Show inline error message if the fetch fails; do not block the rest of the detail page
    - Hide the section entirely when `duplicate_count <= 1`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 8.3_

  - [ ]* 5.2 Write property test for previous copies visibility (Property 7)
    - **Property 7: Previous copies section visibility matches duplicate count**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.5, 8.3**
    - Use fast-check to generate random `duplicate_count` values, verify section renders only when count > 1

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The project uses Jest for testing and fast-check for property-based tests
