# Region Capture Pipeline Collision Bugfix Design

## Overview

The browser-capture Lambda uses `computeUrlHash(url)` to generate S3 key paths, causing all captures from the same page URL to share a directory. Combined with the pipeline-trigger skipping `.txt` files and the normalisation step reading the `.html` file (which contains only a minimal wrapper for region captures), this results in path collisions, stale data processing, and degraded extraction quality.

The fix involves two targeted changes: (1) replace `urlHash` with a UUID-based `captureId` in the browser-capture handler so each capture gets an isolated S3 path, and (2) modify the pipeline-trigger to fire on `.txt` files from browser-capture sources (prefix `raw/web/`) so the normalisation step receives the clean text directly rather than the minimal HTML wrapper.

## Glossary

- **Bug_Condition (C)**: A browser-capture request where `computeUrlHash(url)` produces a path that collides with existing captures from the same URL, AND the pipeline reads the `.html` file instead of the `.txt` file
- **Property (P)**: Each browser-capture produces an isolated S3 path (UUID-based) and the pipeline processes the `.txt` file containing the raw region text
- **Preservation**: Web-fetcher, email, and PDF ingestion paths continue to function identically; the pipeline-trigger continues to skip `.txt`/`.png` files for non-browser-capture sources
- **computeUrlHash**: Function in `lambdas/src/web-fetcher/handler.ts` that produces a SHA-256 hex hash of a URL
- **captureId**: A UUID v4 generated per browser-capture request, replacing `urlHash` as the S3 directory segment
- **browser-capture**: The Lambda at `lambdas/src/browser-capture/handler.ts` that receives HTML/text/screenshot from the Chrome extension
- **pipeline-trigger**: The Lambda at `lambdas/src/pipeline-trigger/handler.ts` that starts Step Functions executions on S3 uploads
- **normalisation**: The Lambda at `lambdas/src/normalisation/handler.ts` that converts raw content to plain text for extraction

## Bug Details

### Bug Condition

The bug manifests when multiple region captures are performed from the same page URL. The `browser-capture` handler uses `computeUrlHash(url)` to build the S3 key path `raw/web/${urlHash}/${timestamp}.html`, meaning all captures from the same URL share the same directory prefix. Additionally, the pipeline-trigger fires on the `.html` upload and the normalisation step reads that `.html` file, which for region captures contains only a minimal `<div><p>...</p></div>` wrapper rather than meaningful HTML content.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type CaptureRequest
  OUTPUT: boolean

  RETURN input.source = "browser-capture"
         AND input.renderMethod = "browser-capture"
         AND (
           EXISTS previous_capture IN S3 WHERE
             computeUrlHash(previous_capture.url) = computeUrlHash(input.url)
           OR pipelineReadsHtmlInsteadOfTxt(input)
         )
END FUNCTION
```

### Examples

- **Same-URL collision**: User captures region A from `https://airline.com/waivers`, then captures region B from the same page. Both store under `raw/web/abc123hash/...`. The second capture's pipeline may pick up stale data from the first capture's directory.
- **Degraded HTML extraction**: Region capture stores `<div><p>Waiver text here</p></div>` as `.html`. Normalisation applies `normaliseHtml()` which strips the tags, but the minimal wrapper means Bedrock receives less context than the raw `.txt` file provides.
- **Correct scenario (web-fetcher)**: Web-fetcher captures full-page HTML from `https://airline.com/waivers`. The `.html` file contains the complete page. `normaliseHtml()` correctly strips scripts/styles and produces good text. This path must remain unchanged.
- **Edge case**: Two different URLs that happen to produce different hashes — these already work correctly and must continue to do so.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Web-fetcher Lambda continues to store at `raw/web/${urlHash}/${timestamp}.html` and trigger the pipeline on `.html` uploads
- Email ingestion continues to process through `raw/email/` path without changes
- PDF ingestion continues to process through `raw/pdf/` path without changes
- Pipeline-trigger continues to skip `.txt` and `.png` files for web-fetcher sources
- Normalisation continues to apply `normaliseHtml()` for web-fetcher `.html` files
- Browser-capture API response format remains the same (returns s3Key, textS3Key, screenshotS3Key, urlHash, timestamp)

**Scope:**
All inputs that do NOT originate from the browser-capture Lambda should be completely unaffected by this fix. This includes:
- Web-fetcher full-page captures (use urlHash, trigger on .html)
- Email sources (raw/email/ prefix)
- PDF sources (raw/pdf/ prefix)
- Lumo API sources

## Hypothesized Root Cause

Based on the bug description and code analysis, the root causes are:

1. **Shared S3 directory path**: `browser-capture/handler.ts` line `const urlHash = computeUrlHash(url)` produces the same hash for all captures from the same URL. The key `raw/web/${urlHash}/${timestamp}` means multiple region captures share a directory, enabling cross-contamination.

2. **Pipeline triggers on wrong file type**: `pipeline-trigger/handler.ts` fires on `.html` uploads and explicitly skips `.txt` files (line: `if (!isEmailBody && (s3Key.endsWith('.txt') || ...))`). For browser-capture sources, the `.txt` file contains the clean region text, but the pipeline processes the `.html` wrapper instead.

3. **Normalisation reads HTML instead of text**: `normalisation/handler.ts` receives the `.html` S3 key from the pipeline-trigger and applies `normaliseHtml()`. For region captures, this HTML is just `<div><p>text</p></div>` — the stripping produces minimal output when the `.txt` file already has the exact text needed.

4. **No source discrimination in pipeline-trigger**: The pipeline-trigger has no way to distinguish browser-capture uploads from web-fetcher uploads since both use the `raw/web/` prefix. It cannot apply different triggering logic per source.

## Correctness Properties

Property 1: Bug Condition - Each Browser-Capture Gets Isolated S3 Path

_For any_ browser-capture request, the fixed handler SHALL generate a UUID-based captureId and store files at `raw/web/${captureId}/${timestamp}.{html,txt,png}` so that no two captures share the same directory prefix, regardless of whether they originate from the same page URL.

**Validates: Requirements 2.1, 2.3**

Property 2: Bug Condition - Pipeline Processes Text File for Browser-Captures

_For any_ browser-capture upload where a `.txt` file exists at `raw/web/${captureId}/${timestamp}.txt`, the pipeline SHALL use the `.txt` file content for normalisation/extraction rather than the `.html` file, preserving the full fidelity of the captured region text.

**Validates: Requirements 2.2, 2.4**

Property 3: Preservation - Web-Fetcher Pipeline Unchanged

_For any_ web-fetcher upload (identified by urlHash-based paths without the `render-method: browser-capture` metadata), the pipeline SHALL continue to trigger on `.html` files, skip `.txt` files, and apply `normaliseHtml()` exactly as before the fix.

**Validates: Requirements 3.1, 3.3, 3.4**

Property 4: Preservation - Non-Web Sources Unchanged

_For any_ email or PDF source upload, the pipeline SHALL continue to process through existing paths without any changes to triggering, normalisation, or extraction behaviour.

**Validates: Requirements 3.2**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `lambdas/src/browser-capture/handler.ts`

**Function**: `handler`

**Specific Changes**:
1. **Replace urlHash with UUID captureId**: Import `randomUUID` from `node:crypto`. Generate `const captureId = randomUUID()` instead of using `computeUrlHash(url)` for the S3 key path. The base key becomes `raw/web/${captureId}/${timestamp}`.
2. **Add render-method metadata**: Ensure the `render-method: browser-capture` metadata is already present on uploads (it is — confirmed in current code).
3. **Update CaptureResult**: Add `captureId` field to the response. Keep `urlHash` in the response for backward compatibility but it is no longer used for the S3 path.

**File**: `lambdas/src/pipeline-trigger/handler.ts`

**Function**: `handler`

**Specific Changes**:
4. **Detect browser-capture `.txt` files**: Before the existing skip logic, check if the S3 key matches `raw/web/` prefix and ends with `.txt`. If so, read the object's metadata to check for `render-method: browser-capture`. If present, allow the `.txt` file to trigger the pipeline (do not skip it).
5. **Skip browser-capture `.html` files**: Conversely, when a `raw/web/` `.html` file has `render-method: browser-capture` metadata, skip it (do not trigger the pipeline) since the `.txt` file will be the trigger instead.

**File**: `lambdas/src/normalisation/handler.ts`

**Function**: `handler`

**Specific Changes**:
6. **Detect browser-capture source and read .txt directly**: When `sourceType === 'web'`, check the S3 object metadata for `render-method: browser-capture`. If present and the key ends with `.txt`, skip `normaliseHtml()` and use the raw text content directly (it's already clean). If the key ends with `.html` (fallback), derive the `.txt` key and read that instead.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that simulate multiple browser-capture requests from the same URL and verify that S3 keys collide. Also verify that the pipeline-trigger skips `.txt` files from browser-capture and that normalisation reads the `.html` wrapper. Run these tests on the UNFIXED code to observe failures.

**Test Cases**:
1. **Path Collision Test**: Two browser-capture requests from the same URL produce the same `urlHash` directory prefix (will demonstrate collision on unfixed code)
2. **Pipeline Skips .txt Test**: A `.txt` file upload at `raw/web/...` is skipped by pipeline-trigger even when it has `render-method: browser-capture` metadata (will demonstrate wrong behaviour on unfixed code)
3. **Normalisation Reads HTML Test**: Normalisation receives a browser-capture `.html` key and applies `normaliseHtml()` to the minimal wrapper, producing degraded text (will demonstrate wrong behaviour on unfixed code)
4. **Cross-Contamination Test**: Second capture from same URL can access files from first capture's directory (will demonstrate collision on unfixed code)

**Expected Counterexamples**:
- Two captures from `https://airline.com/waivers` both produce S3 key prefix `raw/web/abc123.../`
- Pipeline-trigger fires on `.html` upload, skips `.txt` upload for browser-capture sources
- Normalisation strips `<div><p>Waiver text</p></div>` to just "Waiver text" losing formatting context

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := browserCapture_fixed(input)
  ASSERT result.s3KeyPath CONTAINS UUID (not urlHash)
  ASSERT result.s3KeyPath IS UNIQUE across all captures
  ASSERT pipelineTrigger_fixed(result.txtUploadEvent) STARTS execution
  ASSERT pipelineTrigger_fixed(result.htmlUploadEvent) SKIPS execution
  ASSERT normalisation_fixed(result.txtKey) RETURNS raw text without HTML stripping
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT pipelineTrigger_original(input) = pipelineTrigger_fixed(input)
  ASSERT normalisation_original(input) = normalisation_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many S3 key patterns across web-fetcher, email, and PDF sources
- It catches edge cases in the skip logic that manual unit tests might miss
- It provides strong guarantees that non-browser-capture paths are unchanged

**Test Plan**: Observe behavior on UNFIXED code first for web-fetcher, email, and PDF uploads, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Web-Fetcher Preservation**: Verify web-fetcher uploads at `raw/web/${urlHash}/...html` continue to trigger the pipeline and normalise via `normaliseHtml()`
2. **Email Preservation**: Verify email uploads at `raw/email/...` continue to trigger and normalise via email parsing
3. **PDF Preservation**: Verify PDF uploads at `raw/pdf/...` continue to trigger and normalise via pdf-parse
4. **Auxiliary Skip Preservation**: Verify `.txt` and `.png` files from web-fetcher (without `render-method: browser-capture` metadata) continue to be skipped

### Unit Tests

- Test browser-capture handler generates UUID-based paths (not urlHash-based)
- Test pipeline-trigger allows browser-capture `.txt` files through
- Test pipeline-trigger skips browser-capture `.html` files
- Test pipeline-trigger continues to skip non-browser-capture `.txt` files
- Test normalisation passes through raw text for browser-capture `.txt` sources
- Test normalisation continues to apply `normaliseHtml()` for web-fetcher `.html` sources

### Property-Based Tests

- Generate random URLs and verify browser-capture always produces unique captureId-based paths
- Generate random S3 key patterns across all source types and verify pipeline-trigger routing is correct
- Generate random text content and verify normalisation preserves it unchanged for browser-capture `.txt` inputs
- Generate random HTML content and verify normalisation still strips tags for web-fetcher `.html` inputs

### Integration Tests

- End-to-end test: browser-capture request → S3 upload → pipeline-trigger → normalisation → extraction with correct text
- Test two captures from same URL produce independent pipeline executions with isolated data
- Test web-fetcher capture continues to work end-to-end after the fix
