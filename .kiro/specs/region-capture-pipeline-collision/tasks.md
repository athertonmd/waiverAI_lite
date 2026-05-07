# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Browser-Capture Path Collision and Pipeline Misfiring
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Scope the property to concrete failing cases: two captures from the same URL produce colliding S3 paths, pipeline-trigger skips browser-capture `.txt` files, and normalisation applies HTML stripping to browser-capture `.html` files
  - Test 1a: Two browser-capture requests from the same URL (e.g., `https://airline.com/waivers`) produce S3 keys under the same `raw/web/${urlHash}/` directory prefix (demonstrates path collision)
  - Test 1b: Pipeline-trigger receives a `.txt` file upload at `raw/web/{id}/{timestamp}.txt` with `render-method: browser-capture` metadata — verify it is SKIPPED (demonstrates wrong behaviour)
  - Test 1c: Pipeline-trigger receives a `.html` file upload at `raw/web/{id}/{timestamp}.html` with `render-method: browser-capture` metadata — verify it FIRES (demonstrates wrong behaviour: should skip for browser-capture)
  - Test 1d: Normalisation handler receives a browser-capture `.html` key containing `<div><p>Waiver text</p></div>` — verify it applies `normaliseHtml()` stripping (demonstrates degraded extraction)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct - it proves the bug exists)
  - Document counterexamples: e.g., "Two captures from same URL both stored under `raw/web/abc123.../`", "Pipeline skips browser-capture .txt file", "normaliseHtml strips minimal wrapper to bare text"
  - Mark task complete when tests are written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Browser-Capture Pipeline Behaviour Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe: Web-fetcher uploads at `raw/web/${urlHash}/${timestamp}.html` (without `render-method: browser-capture` metadata) trigger the pipeline on UNFIXED code
  - Observe: Pipeline-trigger skips `.txt` and `.png` files from web-fetcher sources (no `render-method: browser-capture` metadata) on UNFIXED code
  - Observe: Email uploads at `raw/email/{messageId}/body.txt` trigger the pipeline on UNFIXED code
  - Observe: PDF uploads at `raw/pdf/{id}.pdf` trigger the pipeline on UNFIXED code
  - Observe: Normalisation applies `normaliseHtml()` to web-fetcher `.html` files on UNFIXED code
  - Write property-based tests: for all non-browser-capture S3 key patterns, pipeline-trigger routing matches observed behaviour (web-fetcher .html triggers, web-fetcher .txt/.png skipped, email body.txt triggers, PDF triggers)
  - Write property-based tests: for all web-fetcher .html inputs, normalisation applies `normaliseHtml()` and produces stripped text
  - Verify tests pass on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behaviour to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 3. Fix for region-capture pipeline collision

  - [x] 3.1 Replace urlHash with UUID captureId in browser-capture handler
    - In `lambdas/src/browser-capture/handler.ts`, import `randomUUID` from `node:crypto`
    - Generate `const captureId = randomUUID()` instead of `const urlHash = computeUrlHash(url)`
    - Update baseKey to `raw/web/${captureId}/${timestamp}`
    - Add `captureId` field to `CaptureResult` interface
    - Keep `urlHash` in response for backward compatibility (compute it but don't use for path)
    - _Bug_Condition: isBugCondition(input) where input.source = "browser-capture" AND computeUrlHash produces colliding paths_
    - _Expected_Behavior: result.s3KeyPath contains UUID (unique per capture, no collisions)_
    - _Preservation: Web-fetcher continues to use urlHash-based paths (separate Lambda, unaffected)_
    - _Requirements: 2.1, 2.3_

  - [x] 3.2 Update pipeline-trigger to route browser-capture .txt files
    - In `lambdas/src/pipeline-trigger/handler.ts`, before the existing skip logic for `.txt` files:
    - Read S3 object metadata via `HeadObjectCommand` for `raw/web/` prefix `.txt` files
    - If metadata contains `render-method: browser-capture`, ALLOW the `.txt` file to trigger the pipeline (do not skip)
    - If a `raw/web/` prefix `.html` file has `render-method: browser-capture` metadata, SKIP it (do not trigger pipeline)
    - Web-fetcher `.html` files (no `render-method: browser-capture` metadata) continue to trigger normally
    - Web-fetcher `.txt` files (no `render-method: browser-capture` metadata) continue to be skipped
    - _Bug_Condition: pipelineReadsHtmlInsteadOfTxt(input) — pipeline fires on .html, skips .txt for browser-capture_
    - _Expected_Behavior: pipeline fires on browser-capture .txt, skips browser-capture .html_
    - _Preservation: Non-browser-capture .txt/.png files still skipped; web-fetcher .html still triggers_
    - _Requirements: 2.2, 2.4, 3.1, 3.3_

  - [x] 3.3 Update normalisation to skip HTML stripping for browser-capture .txt files
    - In `lambdas/src/normalisation/handler.ts`, when `sourceType === 'web'`:
    - Check S3 object metadata for `render-method: browser-capture` via `HeadObjectCommand`
    - If `render-method: browser-capture` is present AND key ends with `.txt`, use raw text content directly (skip `normaliseHtml()`)
    - If `render-method: browser-capture` is present AND key ends with `.html` (fallback), derive `.txt` key and read that instead
    - Web-fetcher `.html` files (no `render-method: browser-capture` metadata) continue through `normaliseHtml()` as before
    - _Bug_Condition: normalisation applies normaliseHtml() to browser-capture minimal HTML wrapper_
    - _Expected_Behavior: normalisation passes through raw text for browser-capture .txt sources_
    - _Preservation: Web-fetcher .html files still processed through normaliseHtml()_
    - _Requirements: 2.2, 2.4, 3.4_

  - [x] 3.4 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Browser-Capture Isolated Paths and Correct Pipeline Routing
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior (unique UUID paths, pipeline fires on .txt, skips .html, normalisation passes through text)
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.5 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Browser-Capture Pipeline Behaviour Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Checkpoint - Ensure all tests pass
  - Run full test suite (`npx jest` in `lambdas/` directory)
  - Ensure all existing tests continue to pass
  - Ensure both exploration and preservation property tests pass
  - Ask the user if questions arise
