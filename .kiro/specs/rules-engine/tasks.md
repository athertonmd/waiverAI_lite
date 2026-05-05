# Implementation Plan: Rules Engine

## Overview

Replace hardcoded waiver processing behaviours with a configurable, persisted rule system. Implementation proceeds bottom-up: shared rules module first, then API routes, Storage Lambda modifications, Step Functions simplification, expiry checker Lambda, CDK infrastructure, and finally the UI rewrite. Each step builds on the previous one so there is no orphaned code.

## Tasks

- [x] 1. Create shared rules module
  - [x] 1.1 Create `lambdas/src/shared/rules.ts` with rule data access functions
    - Define `RuleRecord` interface and `RuleId` type for the four built-in rules
    - Define `DEFAULT_RULES` constant with default configurations for all four rules (auto_approve_threshold enabled with threshold 0.85, duplicate_detection enabled, expired_waiver_flagging enabled, high_impact_priority_boost enabled)
    - Implement `getRule(ruleId)` — reads from Settings table with key `rule:{ruleId}`, falls back to defaults if missing
    - Implement `getAllRules()` — scans Settings table for items with `rule:` prefix, merges with defaults for any missing rules
    - Implement `updateRule(ruleId, updates)` — partial update of enabled/parameters fields, sets `updated_at` to current ISO 8601 timestamp
    - Implement `seedDefaultRules()` — writes default rules to Settings table if they don't already exist (conditional PutItem)
    - Use `docClient` and `TableNames.settings` from `../shared/db`
    - Log warnings when falling back to defaults due to missing records or DynamoDB errors
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 9.3, 9.4_

  - [ ]* 1.2 Write property test for rule persistence round-trip
    - **Property 1: Rule persistence round-trip**
    - **Validates: Requirements 1.1, 1.3**

  - [ ]* 1.3 Write property test for rule update round-trip with timestamp
    - **Property 2: Rule update round-trip with timestamp**
    - **Validates: Requirements 1.4, 2.2**

  - [ ]* 1.4 Write property test for missing rule fallback to defaults
    - **Property 11: Missing rule fallback to defaults**
    - **Validates: Requirements 9.3**

  - [ ]* 1.5 Write unit tests for shared rules module
    - Test `getRule` returns defaults when record is missing
    - Test `getRule` returns stored values when record exists
    - Test `getAllRules` returns all four rules sorted by ID
    - Test `updateRule` merges partial updates and sets timestamp
    - Test `seedDefaultRules` does not overwrite existing records
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 9.3_

- [x] 2. Add rules API routes to the API handler
  - [x] 2.1 Add `GET /v1/rules` and `PUT /v1/rules/{ruleId}` routes to `lambdas/src/api/handler.ts`
    - Add route matching for `GET /v1/rules` that calls `getAllRules()` and returns sorted JSON array
    - Add route matching for `PUT /v1/rules/{ruleId}` that validates the body and calls `updateRule()`
    - Validate `enabled` is a boolean if provided
    - Validate `parameters.threshold` is in [0.0, 1.0] for `auto_approve_threshold` rule
    - Return 400 with `VALIDATION_ERROR` for invalid input
    - Return 404 with `NOT_FOUND` for unknown rule IDs
    - Enforce admin-only access using existing RBAC pattern (return 403 `FORBIDDEN` for non-admins)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]* 2.2 Write property test for rules list sorted by identifier
    - **Property 3: Rules list sorted by identifier**
    - **Validates: Requirements 2.1**

  - [ ]* 2.3 Write property test for invalid rule update rejected
    - **Property 4: Invalid rule update rejected**
    - **Validates: Requirements 2.3, 2.4**

  - [ ]* 2.4 Write property test for non-admin access forbidden
    - **Property 5: Non-admin access forbidden**
    - **Validates: Requirements 2.5**

  - [ ]* 2.5 Write property test for unknown ruleId returns 404
    - **Property 6: Unknown ruleId returns 404**
    - **Validates: Requirements 2.6**

  - [ ]* 2.6 Write unit tests for rules API routes
    - Test GET /v1/rules returns all rules as sorted array
    - Test PUT /v1/rules/auto_approve_threshold with valid body returns updated rule
    - Test PUT /v1/rules/auto_approve_threshold with threshold > 1.0 returns 400
    - Test PUT /v1/rules/unknown_id returns 404
    - Test non-admin user gets 403 on both endpoints
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Modify Storage Lambda for rule-aware processing
  - [x] 4.1 Update `lambdas/src/storage/handler.ts` to read rules and determine status internally
    - Import `getRule` from `../shared/rules`
    - Read `auto_approve_threshold`, `duplicate_detection`, and `high_impact_priority_boost` rules at the start of the handler
    - Determine `finalStatus` based on auto-approve rule: if enabled and `overallConfidence >= threshold` then `auto_approved`, otherwise `pending_review`
    - Make duplicate detection conditional: only call `checkForDuplicate` if `duplicate_detection` rule is enabled, otherwise set `is_duplicate: false`
    - Make high-impact priority conditional: only set `priority: 'high'` if `high_impact_priority_boost` rule is enabled
    - Remove `status` from the `StoreEvent` interface (Storage Lambda now determines status itself)
    - Use the internally-determined `finalStatus` instead of `event.status`
    - Handle DynamoDB read failures gracefully — fall back to default behaviour, never block waiver processing
    - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 6.1, 6.2, 9.1, 9.2, 9.3_

  - [ ]* 4.2 Write property test for auto-approve routing decision
    - **Property 7: Auto-approve routing decision**
    - **Validates: Requirements 3.1, 3.2**

  - [ ]* 4.3 Write property test for duplicate detection conditional
    - **Property 8: Duplicate detection conditional**
    - **Validates: Requirements 4.1, 4.2**

  - [ ]* 4.4 Write property test for high-impact priority conditional
    - **Property 10: High-impact priority conditional**
    - **Validates: Requirements 6.1, 6.2**

  - [ ]* 4.5 Write unit tests for rule-aware Storage Lambda
    - Test auto-approve rule enabled with score above threshold → status `auto_approved`
    - Test auto-approve rule enabled with score below threshold → status `pending_review`
    - Test auto-approve rule disabled → always `pending_review`
    - Test duplicate detection rule disabled → `is_duplicate` always false
    - Test high-impact priority rule disabled → no priority field set
    - Test DynamoDB rule read failure → falls back to default behaviour
    - _Requirements: 3.1, 3.2, 4.1, 4.2, 6.1, 6.2, 9.3_

- [x] 5. Simplify Step Functions pipeline
  - [x] 5.1 Remove the `ScoreCheck` Choice state from `infra/lib/pipeline-stack.ts`
    - Remove the `AutoApprove` and `ReviewQueue` Pass states that inject `status`
    - Remove the `ScoreCheck` Choice state with the hardcoded 0.85 threshold
    - Route the Extract task output directly to the Store task
    - Pass `extractedS3Key`, `recordId`, and `overallConfidence` to the Store task (no `status` field)
    - Update the `StoreEvent` interface usage to match the new shape without `status`
    - _Requirements: 3.1, 3.3, 9.2_

  - [ ]* 5.2 Write unit tests for simplified pipeline definition
    - Verify the state machine definition no longer contains a ScoreCheck choice
    - Verify Extract task connects directly to Store task
    - _Requirements: 3.1, 3.3_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Create expiry checker Lambda
  - [x] 7.1 Create `lambdas/src/expiry-checker/handler.ts`
    - Import `getRule` from `../shared/rules`
    - Read the `expired_waiver_flagging` rule — if disabled, return early
    - Scan the waivers table for records where `status = 'active'` and `expiration_date < today`
    - Update matching records to set `status = 'expired'` and `updated_at` to current timestamp
    - Log the number of waivers transitioned to expired
    - Handle errors gracefully — log and continue, don't throw
    - _Requirements: 5.1, 5.2, 5.3_

  - [ ]* 7.2 Write property test for expired waiver flagging conditional
    - **Property 9: Expired waiver flagging conditional**
    - **Validates: Requirements 5.1, 5.2**

  - [ ]* 7.3 Write unit tests for expiry checker Lambda
    - Test rule enabled with expired waivers → updates status to `expired`
    - Test rule enabled with no expired waivers → no updates
    - Test rule disabled → no waivers modified
    - Test DynamoDB scan failure → logs error, does not throw
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 8. Add expiry checker infrastructure to CDK
  - [x] 8.1 Add expiry checker Lambda and EventBridge schedule to `infra/lib/pipeline-stack.ts`
    - Create a new `NodejsFunction` for the expiry checker with entry `lambdas/src/expiry-checker/handler.ts`
    - Grant DynamoDB read/write access to the waivers table and GetItem on the settings table
    - Create an EventBridge rule with `Schedule.rate(Duration.days(1))` targeting the expiry checker Lambda
    - Add environment variables: `WAIVERS_TABLE`, `SETTINGS_TABLE`
    - _Requirements: 5.3_

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Rewrite Rules Engine UI
  - [x] 10.1 Rewrite `ui/src/pages/RulesEngine.tsx` to fetch from API and persist toggles
    - Remove hardcoded `SAMPLE_RULES` array
    - Fetch rules from `GET /v1/rules` on component mount using the existing API client
    - Display loading indicator while fetching
    - Render rule cards with enable/disable toggles that send `PUT /v1/rules/{ruleId}` on change
    - Apply reduced opacity to disabled rule cards
    - Implement optimistic toggle updates with rollback on API failure
    - Display error messages when API calls fail
    - Display success confirmation when parameter updates succeed
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 10.2 Add threshold parameter editing to the auto-approve rule card
    - Render an editable numeric input for the threshold parameter (range 0.0–1.0, step 0.01)
    - Validate threshold range client-side before submission
    - Display validation error if value is outside [0.0, 1.0]
    - Send `PUT /v1/rules/auto_approve_threshold` with updated parameters on confirm
    - Display success message on successful update
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [ ]* 10.3 Write unit tests for Rules Engine UI
    - Test loading state renders while fetching
    - Test rule cards render after successful fetch
    - Test toggle sends correct PUT payload
    - Test toggle reverts on API failure
    - Test threshold input validates range client-side
    - Test success/error messages display correctly
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using fast-check
- The Step Functions simplification (task 5) must be deployed together with the Storage Lambda changes (task 4) to avoid breaking the pipeline
- Default rules are seeded on first access via `getRule` fallback — no separate migration step needed
