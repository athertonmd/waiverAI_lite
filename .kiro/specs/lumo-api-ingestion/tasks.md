# Implementation Plan: Lumo API Ingestion

## Overview

Integrate WaiverHub with the Lumo (thinklumo.com) API to automatically poll for airline waiver data. The implementation proceeds bottom-up: types and poller Lambda first, then CDK infrastructure, pipeline Choice state modification, extraction Lambda changes, and finally the UI source viewer update. Each step builds on the previous one so there is no orphaned code.

## Tasks

- [x] 1. Create Lumo Poller types and handler
  - [x] 1.1 Create `lambdas/src/lumo-poller/types.ts` with Lumo API types
    - Define `LumoWaiver` interface matching the Lumo `waivers/search` response shape (id, location, period, alert, date_restrictions, waiver_codes, dom_intl, remarks)
    - Define `WaiverRegistryEntry` interface (contentHash, lastSeen, waiverHubRecordId)
    - Define `WaiverRegistry` interface as a record mapping Lumo waiver IDs to `WaiverRegistryEntry`
    - _Requirements: 2.1_

  - [x] 1.2 Create `lambdas/src/lumo-poller/handler.ts` with the poller Lambda
    - Implement `handler(event: ScheduledEvent): Promise<void>` as the entry point
    - Implement `getLumoApiKey` to retrieve the API key from Secrets Manager; log and return early if missing or empty
    - Implement `fetchLumoWaivers` to call the Lumo `waivers/search` endpoint with a 10-second `AbortController` timeout
    - Implement `computeContentHash` using SHA-256 to hash the JSON-stringified waiver payload
    - Implement `loadWaiverRegistry` and `saveWaiverRegistry` to read/write the `lumo_waiver_registry` key in the Settings table; on read failure, return an empty registry (treat all waivers as new)
    - Implement change detection: for each waiver, check if its Lumo ID is absent from the registry or its content hash differs — only ingest if new or changed, skip if hash matches
    - Implement `storeRawJson` to PUT the individual waiver JSON to S3 under `raw/lumo/{lumo_waiver_id}/{timestamp}.json` with content type `application/json` and metadata `source-type=lumo` and `lumo-waiver-id`
    - Implement `startPipeline` to call Step Functions `StartExecution` with `sourceType=lumo`, the S3 key, and a new UUID `recordId`
    - After processing all waivers, update the registry and the `lumo_last_poll` timestamp in the Settings table
    - Handle HTTP 4xx/5xx errors by logging status code and response body, then returning without throwing
    - Handle S3 PutObject or StartExecution failures per-waiver: log the error and continue processing remaining waivers
    - Environment variables: `LUMO_API_SECRET_ARN`, `LUMO_API_BASE_URL`, `INGESTION_BUCKET`, `STATE_MACHINE_ARN`, `SETTINGS_TABLE`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 10.1, 10.2_

  - [ ]* 1.3 Write property test: HTTP error resilience (Property 1)
    - **Property 1: HTTP error resilience**
    - Generate random HTTP status codes in [400..599], mock the Lumo API to return that status, verify handler does not throw an unhandled exception
    - **Validates: Requirements 1.3**

  - [ ]* 1.4 Write property test: Change detection correctness (Property 2)
    - **Property 2: Change detection correctness**
    - Generate random waiver payloads and random registry states, verify ingestion is triggered iff the waiver is new or hash differs; verify no ingestion when hash matches
    - **Validates: Requirements 2.2, 2.3, 2.4**

  - [ ]* 1.5 Write property test: Registry update after ingestion (Property 3)
    - **Property 3: Registry update after ingestion**
    - Generate random waivers that trigger ingestion, verify registry entry is updated with correct content hash and a `lastSeen` timestamp no earlier than the start of the poll cycle
    - **Validates: Requirements 2.5**

  - [ ]* 1.6 Write property test: Raw JSON storage correctness (Property 4)
    - **Property 4: Raw JSON storage correctness**
    - Generate random Lumo waiver IDs (alphanumeric strings), verify S3 key matches `raw/lumo/{id}/{timestamp}.json` pattern and metadata includes `source-type=lumo` and correct `lumo-waiver-id`
    - **Validates: Requirements 3.1, 3.2**

  - [ ]* 1.7 Write property test: Pipeline invocation correctness (Property 5)
    - **Property 5: Pipeline invocation correctness**
    - Generate random waivers, verify StartExecution params include `sourceType=lumo`, matching `s3Key`, and a valid UUID `recordId`
    - **Validates: Requirements 3.3**

  - [ ]* 1.8 Write unit tests for Lumo Poller handler
    - Test successful poll cycle: mock API returns 2 waivers (1 new, 1 unchanged), verify only the new one is ingested
    - Test API returns HTTP 500: verify handler logs error and returns without throwing
    - Test API timeout: verify handler aborts after 10 seconds
    - Test missing API key secret: verify handler logs error and does not call the API
    - Test empty API key: verify handler logs error and does not call the API
    - Test registry read failure: verify handler treats all waivers as new (fallback)
    - Test S3 PutObject failure for one waiver: verify remaining waivers are still processed
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 10.1, 10.2_

- [x] 2. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Add CDK infrastructure for Lumo Poller
  - [x] 3.1 Modify `infra/lib/pipeline-stack.ts` to add the Lumo Poller Lambda, EventBridge rule, Secrets Manager secret, and Choice state
    - Create a Secrets Manager secret for the Lumo API key with a default placeholder value (secret name configurable via CDK context, default `waiverhub/lumo-api-key`)
    - Define a new `LumoPollerFn` NodejsFunction with Node.js 20.x runtime, 512 MB memory, 60-second timeout, entry at `lambdas/src/lumo-poller/handler.ts`
    - Set environment variables: `LUMO_API_SECRET_ARN`, `LUMO_API_BASE_URL` (default `https://flifo-qa.flightstats.com/flex`), `INGESTION_BUCKET`, `STATE_MACHINE_ARN`, `SETTINGS_TABLE`
    - Grant LumoPollerFn: read access to the Secrets Manager secret, read/write access to the Settings table, write access to the Ingestion Bucket under `raw/lumo/*`, and `startExecution` on the state machine
    - Define an EventBridge rule with `rate(2 minutes)` targeting the LumoPollerFn
    - Modify the state machine definition: replace `addNormaliseStage` as the entry point with a new `SourceTypeCheck` Choice state that routes `sourceType == "lumo"` to a `LumoBypass` Pass state (setting `normalizedS3Key`, `sourceS3Key`, `sourceType`, `recordId`, and `sourceUrl` to empty string), then to `addExtractStage`; route all other source types to the existing `addNormaliseStage` flow
    - _Requirements: 5.1, 5.2, 5.3, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.3_

- [x] 4. Modify Extraction Lambda for Lumo source type
  - [x] 4.1 Update `lambdas/src/extraction/handler.ts` to support `sourceType: 'lumo'`
    - Add `'lumo'` to the `ExtractionEvent.sourceType` union type: `'email' | 'pdf' | 'web' | 'lumo'`
    - In `buildExtractionPrompt`, when `sourceType === 'lumo'` (pass sourceType as a new parameter or via options), prepend the Lumo-specific preamble instructing the model that the source is structured JSON from the Lumo API and listing the Lumo-to-WaiverHub field mappings (id → waiver_code, alert.summary → waiver_title, location.airports → airports, period.start → effective_date, period.end → expiration_date, waiver_codes → fare_classes, remarks + alert.description → rebooking_rules/refund_rules/release_notes, dom_intl → airports_qualifier)
    - Ensure `fetchRecentCorrections` is called with `source_type=lumo` for Lumo sources so corrections feed the learning loop
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 8.2_

  - [ ]* 4.2 Write property test: Bedrock response parsing completeness (Property 6)
    - **Property 6: Bedrock response parsing completeness**
    - Generate random JSON objects with all 16 schema field keys (random strings/arrays) and random confidence scores [0..1], verify `parseBedrockResponse` returns all 16 fields populated and all 16 confidence scores as numbers between 0.0 and 1.0 inclusive
    - **Validates: Requirements 4.3**

  - [ ]* 4.3 Write unit tests for Lumo extraction changes
    - Test that when `sourceType === 'lumo'`, the prompt includes the Lumo-specific preamble text
    - Test that `fetchRecentCorrections` is called with `source_type=lumo`
    - _Requirements: 4.1, 4.2, 8.2_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Update WaiverDetail source viewer for Lumo sources
  - [x] 6.1 Modify `ui/src/pages/WaiverDetail.tsx` SourceViewer to handle `lumo` source type
    - When `resolvedSourceType === 'lumo'` or `sourceType === 'lumo'`, render a single "JSON Source" tab instead of the Screenshot/Rendered Text/Source Page tabs
    - In the JSON Source tab, display the raw content as pretty-printed JSON (`JSON.stringify(JSON.parse(content), null, 2)`) inside a `<pre>` block with monospace font
    - If JSON parsing fails, display the raw text content as-is with a warning that JSON formatting failed
    - Hide the Screenshot and Source Page tabs for Lumo sources (no HTML page or screenshot exists)
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use `fast-check` with vitest
- The Storage Lambda and API handler require no code changes — they already handle arbitrary `source_type` values and record corrections with the correct `source_type` (Requirements 6.1–6.4, 8.1)
- The CDK deploy command is: `npx cdk deploy WaiverDataHubPipeline --exclusively -c recipientDomain=waiverhub.info --require-approval never`
- Checkpoints ensure incremental validation between major implementation phases
