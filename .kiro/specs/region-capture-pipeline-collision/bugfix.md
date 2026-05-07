# Bugfix Requirements Document

## Introduction

When multiple region captures are made from the same page URL, the browser-capture Lambda generates S3 key paths using `computeUrlHash(url)` which produces the same hash for all captures from the same page. This causes path collisions in the `raw/web/${urlHash}/` directory. Additionally, the pipeline's normalisation step reads the `.html` file (which contains only a minimal `<div><p>...</p></div>` wrapper from region captures) rather than the already-clean `.txt` file. The combination results in the pipeline either picking up a stale full-page HTML file from a previous capture or producing degraded extraction from the minimal HTML wrapper, causing the wrong waiver data to appear in WaiverHub.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN multiple region captures are performed from the same page URL THEN the system stores all captures under the same S3 directory path (`raw/web/${urlHash}/`) because `computeUrlHash(url)` produces an identical hash for the same URL regardless of which region was selected

1.2 WHEN the pipeline-trigger fires on a region capture's `.html` upload THEN the normalisation step reads the `.html` file which contains only a minimal `<div><p>...</p></div>` wrapper, producing degraded text that Bedrock struggles to extract meaningful waiver data from

1.3 WHEN a region capture's `.html` file is stored in the same directory as a previous full-page capture from the same URL THEN the pipeline may process stale data from the shared directory, resulting in a duplicate of an existing waiver instead of a new unique waiver from the selected region

1.4 WHEN the normalisation handler processes a browser-capture `.html` file THEN it applies `normaliseHtml()` which strips the simple `<div><p>` wrapper and produces minimal text, even though a clean `.txt` file with the exact region text already exists alongside it

### Expected Behavior (Correct)

2.1 WHEN a region capture is performed THEN the system SHALL generate a unique S3 key path using a UUID-based capture ID (e.g., `raw/web/${captureId}/${timestamp}.html`) so that each capture is stored in its own isolated directory regardless of the source page URL

2.2 WHEN the normalisation step processes a browser-capture source THEN the system SHALL use the `.txt` file (which contains the raw region text) instead of the `.html` file, since the text is already clean and does not require HTML stripping

2.3 WHEN multiple region captures are made from the same page URL THEN the system SHALL produce independent pipeline executions that each extract waiver data solely from their own captured region text, with no cross-contamination from other captures

2.4 WHEN a region capture contains valid waiver text THEN the system SHALL pass the exact captured text (as stored in the `.txt` file) to the extraction step, preserving the full fidelity of the selected region content

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a full-page web capture is performed via the web-fetcher Lambda THEN the system SHALL CONTINUE TO store files at `raw/web/${urlHash}/${timestamp}.html` and trigger the pipeline normally

3.2 WHEN an email or PDF source is ingested THEN the system SHALL CONTINUE TO process through the normalisation pipeline using the existing email/PDF normalisation paths without any changes

3.3 WHEN the pipeline-trigger receives a `.txt` or `.png` file upload event THEN the system SHALL CONTINUE TO skip those auxiliary files and not start a duplicate pipeline execution

3.4 WHEN a full-page web capture's `.html` file is processed by normalisation THEN the system SHALL CONTINUE TO apply `normaliseHtml()` to strip tags and produce clean text for extraction

3.5 WHEN the browser-capture API receives a valid request THEN the system SHALL CONTINUE TO return a successful response with the S3 key paths and store both `.html`, `.txt`, and optional `.png` files

---

## Bug Condition (Formal)

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type CaptureRequest
  OUTPUT: boolean
  
  // The bug triggers when a browser-capture (region or full-page) is made
  // from a URL that already has existing captures in the same urlHash directory
  RETURN X.source = "browser-capture" AND
         EXISTS previous_capture IN S3 WHERE
           computeUrlHash(previous_capture.url) = computeUrlHash(X.url)
END FUNCTION
```

## Fix Property

```pascal
// Property: Fix Checking - Each region capture gets a unique isolated path
FOR ALL X WHERE isBugCondition(X) DO
  result ← browserCapture'(X)
  ASSERT result.s3KeyPath IS UNIQUE (contains UUID, not shared with any other capture)
  ASSERT normalisation'(result) READS result.textS3Key (the .txt file, not .html)
  ASSERT extraction(normalisation'(result)) PRODUCES waiver data FROM X.regionText ONLY
END FOR
```

## Preservation Property

```pascal
// Property: Preservation Checking - Non-browser-capture sources unchanged
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
  // web-fetcher, email, and PDF pipelines behave identically before and after the fix
END FOR
```
