# Implementation Plan: Chrome Extension Capture

## Overview

Implement a Chrome Manifest V3 extension and companion Lambda endpoint that allow travel agents to capture fully rendered page content from authenticated browser sessions and submit it to the Waiver Hub ingestion pipeline. The Lambda follows the existing `web-fetcher/api-handler.ts` pattern, reuses `computeUrlHash`, and stores content under `raw/web/` to trigger the existing Step Functions pipeline.

## Tasks

- [x] 1. Implement Browser Capture Lambda handler
  - [x] 1.1 Create `lambdas/src/browser-capture/handler.ts` with the `CapturePayload` and `CaptureResult` interfaces, validation logic, S3 storage, and CORS headers
    - Import and reuse `computeUrlHash` from `../web-fetcher/handler`
    - Validate request body: missing body → 400 MISSING_BODY, invalid JSON → 400 INVALID_JSON
    - Validate `url`: missing → 400 MISSING_URL, not valid HTTP/HTTPS → 400 INVALID_URL
    - Validate `text`: missing → 400 MISSING_TEXT, empty string → 400 EMPTY_TEXT
    - Validate `html`: missing → 400 MISSING_HTML
    - Compute `urlHash` via `computeUrlHash(url)`, generate ISO 8601 `timestamp`
    - Store HTML to `raw/web/{urlHash}/{timestamp}.html` (Content-Type: text/html, metadata: source-url, render-method: browser-capture)
    - Store text to `raw/web/{urlHash}/{timestamp}.txt` (Content-Type: text/plain, metadata: source-url, render-method: browser-capture)
    - If screenshot provided, decode base64 and store to `raw/web/{urlHash}/{timestamp}.png` (Content-Type: image/png, metadata: source-url)
    - Return `CaptureResult` with s3Key, textS3Key, screenshotS3Key (empty string if none), urlHash, timestamp
    - Wrap S3 errors as 500 STORAGE_ERROR, unexpected errors as 500 INTERNAL_ERROR
    - Follow the same `errorResponse` helper pattern as `web-fetcher/api-handler.ts`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.9, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ]* 1.2 Write unit tests for Browser Capture Lambda at `lambdas/src/browser-capture/__tests__/handler.test.ts`
    - Mock `@aws-sdk/client-s3` S3Client.send and PutObjectCommand
    - Mock `computeUrlHash` from `web-fetcher/handler`
    - Test: valid payload with all fields → 200 + correct S3 keys and response fields
    - Test: valid payload without screenshot → 200 + empty screenshotS3Key, only 2 S3 puts
    - Test: missing body → 400 MISSING_BODY
    - Test: invalid JSON → 400 INVALID_JSON
    - Test: missing url → 400 MISSING_URL
    - Test: invalid URL (ftp://) → 400 INVALID_URL
    - Test: missing text → 400 MISSING_TEXT
    - Test: empty text → 400 EMPTY_TEXT
    - Test: missing html → 400 MISSING_HTML
    - Test: S3 failure → 500 STORAGE_ERROR
    - Follow the same `makeEvent` helper pattern as `web-fetcher/__tests__/api-handler.test.ts`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 2.3, 2.4, 2.5, 2.9_

  - [ ]* 1.3 Write property test: valid payload storage correctness
    - **Property 1: Valid payload storage correctness**
    - **Validates: Requirements 2.3, 2.4, 2.5, 2.6, 2.7, 4.6**
    - Use fast-check to generate random valid CapturePayloads (random HTTP/HTTPS URLs, random non-empty text, random non-empty HTML, optional random base64 screenshot)
    - Verify handler calls S3 PutObject with correct keys, content types, and metadata
    - Verify screenshot PutObject only called when screenshot is provided

  - [ ]* 1.4 Write property test: invalid payload rejection
    - **Property 2: Invalid payload rejection**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
    - Use fast-check to generate payloads with one required field removed or with invalid URLs (non-HTTP protocols, malformed strings)
    - Verify handler returns 400 with correct error code and does not call S3

  - [ ]* 1.5 Write property test: response contains all required fields
    - **Property 3: Response contains all required fields**
    - **Validates: Requirements 2.9**
    - Use fast-check to generate random valid CapturePayloads
    - Verify response body contains s3Key (ends .html), textS3Key (ends .txt), screenshotS3Key, urlHash (matches SHA-256 of input URL), timestamp (valid ISO 8601)

  - [ ]* 1.6 Write property test: URL hash determinism
    - **Property 4: URL hash determinism**
    - **Validates: Requirements 2.3, 2.4, 2.5**
    - Use fast-check to generate random URL strings
    - Verify `computeUrlHash(url)` always returns the same value for the same input
    - Verify different URLs produce different hashes

- [ ] 2. Checkpoint - Ensure Lambda tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Add CDK infrastructure for browser-capture endpoint
  - [x] 3.1 Add Browser Capture Lambda and API Gateway resource in `infra/lib/api-stack.ts`
    - Add new `NodejsFunction` for `browser-capture/handler.ts` with 512 MB memory, 30s timeout, `INGESTION_BUCKET` env var, `externalModules: ['@aws-sdk/*']`
    - Grant `grantWrite` on `ingestionBucket` to the new Lambda
    - Add new API Gateway resource `/v1/ingestion/browser-capture` under the existing `ingestion` resource
    - Add POST method with `LambdaIntegration` and same `authOpts` as other ingestion endpoints
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 4. Create Chrome Extension files
  - [x] 4.1 Create `extension/manifest.json`
    - manifest_version: 3
    - permissions: ["activeTab", "scripting"]
    - host_permissions: ["https://1xwh2q6cxd.execute-api.eu-west-2.amazonaws.com/*"]
    - action.default_popup: popup.html
    - background.service_worker: background.js
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 4.2 Create `extension/content.js`
    - Return `{ text: document.body.innerText, html: document.documentElement.outerHTML }`
    - _Requirements: 1.2, 1.3_

  - [x] 4.3 Create `extension/background.js` (service worker)
    - Listen for "capture" messages from popup.js
    - Get active tab URL via `chrome.tabs.query`
    - Inject content.js via `chrome.scripting.executeScript`
    - Capture screenshot via `chrome.tabs.captureVisibleTab` (PNG, base64)
    - Strip `data:image/png;base64,` prefix from screenshot
    - POST CapturePayload to `https://1xwh2q6cxd.execute-api.eu-west-2.amazonaws.com/prod/v1/ingestion/browser-capture`
    - Return result or error to popup.js via sendResponse
    - _Requirements: 1.4, 1.5, 2.1_

  - [x] 4.4 Create `extension/popup.html` and `extension/popup.js`
    - Display current tab URL and "Capture This Page" button
    - Validate active tab URL is HTTP/HTTPS; disable button and show message for non-capturable URLs
    - Show loading state ("Capturing and submitting…") during capture
    - On success: show "Capture submitted successfully" + link to Waiver Hub UI
    - On error: show error description from API or content extraction failure message
    - Communicate with background.js via `chrome.runtime.sendMessage`
    - _Requirements: 1.1, 3.1, 3.2, 3.3, 3.4, 3.5, 6.1, 6.2, 6.3_

  - [ ]* 4.5 Write property test: non-capturable URL detection
    - **Property 5: Non-capturable URL detection**
    - **Validates: Requirements 6.2**
    - Extract `isCapturableUrl` as a testable function in popup.js or a shared utility
    - Use fast-check to generate random URLs with non-HTTP/HTTPS protocols → verify returns false
    - Use fast-check to generate random HTTP/HTTPS URLs → verify returns true

- [ ] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The extension uses vanilla JS with no build step — files are loaded directly as an unpacked extension
- The Lambda reuses `computeUrlHash` from `web-fetcher/handler.ts` for consistent URL hashing
- Property tests use fast-check and validate the correctness properties defined in the design document
- S3 objects stored under `raw/web/` automatically trigger the existing Step Functions pipeline
