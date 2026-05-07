# Implementation Plan: Expired Waivers Dashboard

## Overview

This plan implements the expired waivers dashboard feature by modifying three existing files: the API handler (to add the `expiredWaivers` count and filter expired from recent waivers), the Dashboard UI (to add the fifth KPI tile and update the grid), and the expiry checker (to invalidate the dashboard cache after transitions). No new files or infrastructure are required.

## Tasks

- [x] 1. Update API handler to include expired waivers count and filter recent list
  - [x] 1.1 Add `expiredWaivers` count to `getDashboardMetrics` response
    - In `lambdas/src/api/handler.ts`, inside the `getDashboardMetrics` function, add an `expiredCount` accumulator
    - Increment `expiredCount` when `status === 'expired'` in the item iteration loop
    - Include `expiredWaivers: expiredCount` in the response `data` object
    - _Requirements: 1.1, 1.4_

  - [x] 1.2 Filter expired waivers from the recent waivers list
    - In `lambdas/src/api/handler.ts`, inside `getDashboardMetrics`, filter out items with `status === 'expired'` before building the `recent` array (or filter the `recent` array before sorting/slicing)
    - Ensure the list still returns up to 10 items after filtering
    - _Requirements: 2.1, 2.3_

  - [x] 1.3 Write unit tests for expired waivers count and recent list filtering
    - In `lambdas/src/api/__tests__/handler.test.ts`, add tests to the `GET /v1/dashboard/metrics` describe block
    - Test that `expiredWaivers` field is returned with correct count when items have `status: 'expired'`
    - Test that `recentWaivers` excludes items with `status: 'expired'`
    - Test that `recentWaivers` returns at most 10 items after filtering
    - _Requirements: 1.1, 1.4, 2.1, 2.3_

  - [ ]* 1.4 Write property test: expired count accuracy (Property 1)
    - **Property 1: Expired count accuracy**
    - Generate random arrays of waiver-like objects with `status` drawn from `['pending_review', 'active', 'rejected', 'expired', 'auto_approved']`
    - Extract the metrics computation logic into a testable pure function or invoke `getDashboardMetrics` with mocked data
    - Assert `expiredWaivers === items.filter(i => i.status === 'expired').length`
    - Use `fast-check` with minimum 100 iterations
    - **Validates: Requirements 1.1, 1.4**

  - [ ]* 1.5 Write property test: recent waivers exclude expired (Property 2)
    - **Property 2: Recent waivers exclude expired**
    - Generate random arrays of waiver-like objects with arbitrary statuses
    - Pass through the dashboard metrics computation
    - Assert `recentWaivers.every(w => w.status !== 'expired')`
    - Use `fast-check` with minimum 100 iterations
    - **Validates: Requirements 2.1**

  - [ ]* 1.6 Write property test: recent waivers list capping (Property 3)
    - **Property 3: Recent waivers list capping**
    - Generate random arrays of 0–50 waiver-like objects (non-expired)
    - Pass through the dashboard metrics computation
    - Assert `recentWaivers.length <= 10`
    - Use `fast-check` with minimum 100 iterations
    - **Validates: Requirements 2.3**

- [x] 2. Checkpoint - Verify API changes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Update expiry checker to invalidate dashboard cache
  - [x] 3.1 Add cache invalidation call to expiry checker
    - In `lambdas/src/expiry-checker/handler.ts`, import `* as cache from '../shared/cache'`
    - After the waiver update loop completes (after the `console.log` line), call `cache.invalidate('dashboard:metrics')`
    - _Requirements: 4.2_

  - [x] 3.2 Write unit test for cache invalidation in expiry checker
    - Create `lambdas/src/expiry-checker/__tests__/handler.test.ts` if it doesn't exist
    - Mock `../shared/cache` and verify `cache.invalidate` is called with `'dashboard:metrics'` after processing
    - _Requirements: 4.2_

- [x] 4. Update Dashboard UI to display expired waivers KPI tile
  - [x] 4.1 Add `expiredWaivers` field to the `DashboardMetrics` interface
    - In `ui/src/pages/Dashboard.tsx`, add `expiredWaivers: number` to the `data` object inside the `DashboardMetrics` interface
    - _Requirements: 1.2_

  - [x] 4.2 Add "Expired Waivers" KPI tile to the Dashboard
    - Add a fifth `<KpiCard>` with label "Expired Waivers" and value `m.expiredWaivers ?? 0`
    - Place it between "Pending Review" and "Avg Confidence"
    - Add `onClick` handler that navigates to `/waivers?status=expired`
    - _Requirements: 1.2, 1.3, 3.1_

  - [x] 4.3 Update KPI grid layout to 5 columns
    - Change `gridTemplateColumns` in the `kpiGrid` style from `'repeat(4, 1fr)'` to `'repeat(5, 1fr)'`
    - _Requirements: 3.2_

- [x] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- The project uses Jest for testing and fast-check for property-based tests
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The cache invalidation in the expiry checker is for local correctness only (in-memory cache per Lambda instance); the 30-second TTL provides the primary freshness guarantee
