# Requirements Document

## Introduction

The Waiver Data Hub currently ingests airline waiver content from web URLs using a headless Chromium Lambda. This approach fails for SPA sites (e.g. SalesLink by American Airlines) that require user authentication — the Lambda cannot access authenticated sessions. The Chrome Extension Capture feature provides a browser extension that captures fully rendered page content directly from the user's authenticated browser session and submits it to the existing Waiver Hub ingestion pipeline. The extension is for internal distribution only (loaded as an unpacked extension, not published to the Chrome Web Store).

## Glossary

- **Extension**: A Chrome browser extension (Manifest V3) that captures page content and sends it to the API
- **Popup**: The Extension's popup UI displayed when the user clicks the extension icon in the Chrome toolbar
- **Content_Script**: A script injected into the active tab by the Extension to extract page text and HTML
- **Background_Worker**: The Extension's service worker that orchestrates capture, screenshot, and API submission
- **Browser_Capture_API**: The new POST /v1/ingestion/browser-capture endpoint on the Waiver Hub API Gateway
- **Browser_Capture_Lambda**: The Lambda function backing the Browser_Capture_API that stores captured content in S3
- **Ingestion_Bucket**: The S3 bucket (waiverdatahubbase-ingestionbucket917a3a3a-iqauksbysonx) where raw content is stored
- **Pipeline**: The existing Step Functions pipeline triggered by S3 object creation under the raw/* prefix
- **Waiver_Hub_UI**: The existing React web application for viewing and managing waivers
- **Capture_Payload**: The JSON object containing url, text, html, and screenshot (base64) sent by the Extension

## Requirements

### Requirement 1: Page Content Capture

**User Story:** As a travel agent, I want to capture the fully rendered content of an airline waiver page from my authenticated browser session, so that the Waiver Hub can ingest waivers from sites that block server-side access.

#### Acceptance Criteria

1. WHEN the user clicks the Extension icon, THE Popup SHALL display a "Capture This Page" button and the current tab URL.
2. WHEN the user clicks the "Capture This Page" button, THE Content_Script SHALL extract the visible text from the active tab using document.body.innerText.
3. WHEN the user clicks the "Capture This Page" button, THE Content_Script SHALL extract the full rendered HTML from the active tab using document.documentElement.outerHTML.
4. WHEN the user clicks the "Capture This Page" button, THE Background_Worker SHALL capture a screenshot of the visible tab area using chrome.tabs.captureVisibleTab in PNG format.
5. WHEN the user clicks the "Capture This Page" button, THE Background_Worker SHALL capture the URL of the active tab using chrome.tabs.query.

### Requirement 2: API Submission

**User Story:** As a travel agent, I want the captured page content to be sent to the Waiver Hub API automatically, so that I do not need to manually upload files.

#### Acceptance Criteria

1. WHEN the Content_Script and Background_Worker have completed capture, THE Background_Worker SHALL send a POST request to the Browser_Capture_API with a Capture_Payload containing url, text, html, and screenshot (base64-encoded PNG without the data URI prefix).
2. THE Browser_Capture_API SHALL accept POST requests at the path /v1/ingestion/browser-capture.
3. WHEN the Browser_Capture_API receives a valid Capture_Payload, THE Browser_Capture_Lambda SHALL store the HTML content in the Ingestion_Bucket under the key raw/web/{urlHash}/{timestamp}.html with Content-Type text/html.
4. WHEN the Browser_Capture_API receives a valid Capture_Payload, THE Browser_Capture_Lambda SHALL store the visible text in the Ingestion_Bucket under the key raw/web/{urlHash}/{timestamp}.txt with Content-Type text/plain.
5. WHEN the Browser_Capture_API receives a valid Capture_Payload, THE Browser_Capture_Lambda SHALL store the screenshot in the Ingestion_Bucket under the key raw/web/{urlHash}/{timestamp}.png with Content-Type image/png.
6. THE Browser_Capture_Lambda SHALL attach the source URL as S3 object metadata (key: source-url) on all stored objects.
7. THE Browser_Capture_Lambda SHALL attach the render method as S3 object metadata (key: render-method, value: browser-capture) on the HTML and text objects.
8. WHEN the HTML object is stored under raw/web/, THE Pipeline SHALL be triggered by the existing S3 event notification and process the content through extraction.
9. WHEN the Browser_Capture_API receives a valid Capture_Payload, THE Browser_Capture_Lambda SHALL return a JSON response containing the s3Key, textS3Key, screenshotS3Key, urlHash, and timestamp.

### Requirement 3: User Feedback

**User Story:** As a travel agent, I want to see confirmation that my capture was successful and a link to view the waiver, so that I know the submission worked.

#### Acceptance Criteria

1. WHILE the Background_Worker is sending the Capture_Payload to the Browser_Capture_API, THE Popup SHALL display a loading indicator with the text "Capturing and submitting…".
2. WHEN the Browser_Capture_API returns a successful response, THE Popup SHALL display a success message with the text "Capture submitted successfully".
3. WHEN the Browser_Capture_API returns a successful response, THE Popup SHALL display a clickable link to view the waiver in the Waiver_Hub_UI.
4. IF the Browser_Capture_API returns an error response, THEN THE Popup SHALL display an error message containing the error description returned by the API.
5. IF the Content_Script fails to extract page content, THEN THE Popup SHALL display an error message indicating that content extraction failed.

### Requirement 4: Input Validation

**User Story:** As a developer, I want the API to validate incoming capture payloads, so that malformed or incomplete submissions do not enter the pipeline.

#### Acceptance Criteria

1. WHEN the Browser_Capture_API receives a request without a url field, THE Browser_Capture_Lambda SHALL return HTTP 400 with error code MISSING_URL.
2. WHEN the Browser_Capture_API receives a request with a url that is not a valid HTTP or HTTPS URL, THE Browser_Capture_Lambda SHALL return HTTP 400 with error code INVALID_URL.
3. WHEN the Browser_Capture_API receives a request without a text field, THE Browser_Capture_Lambda SHALL return HTTP 400 with error code MISSING_TEXT.
4. WHEN the Browser_Capture_API receives a request without an html field, THE Browser_Capture_Lambda SHALL return HTTP 400 with error code MISSING_HTML.
5. WHEN the Browser_Capture_API receives a request where the text field is an empty string, THE Browser_Capture_Lambda SHALL return HTTP 400 with error code EMPTY_TEXT.
6. WHEN the Browser_Capture_API receives a request without a screenshot field, THE Browser_Capture_Lambda SHALL accept the request and store only the HTML and text content (screenshot is optional).

### Requirement 5: Extension Manifest and Permissions

**User Story:** As a developer, I want the extension to declare only the minimum required permissions, so that it follows Chrome extension security best practices.

#### Acceptance Criteria

1. THE Extension SHALL use Manifest V3 format with manifest_version set to 3.
2. THE Extension SHALL declare the activeTab permission to access the current tab content only when the user clicks the extension icon.
3. THE Extension SHALL declare the scripting permission to inject the Content_Script into the active tab.
4. THE Extension SHALL declare host_permissions for the Waiver Hub API origin (https://1xwh2q6cxd.execute-api.eu-west-2.amazonaws.com/*) to allow cross-origin API requests.
5. THE Extension SHALL consist of the files: manifest.json, popup.html, popup.js, content.js, and background.js.

### Requirement 6: Extension Compatibility

**User Story:** As a travel agent, I want the extension to work on any airline website, so that I can capture waivers from any source.

#### Acceptance Criteria

1. THE Extension SHALL operate on any HTTP or HTTPS web page without requiring site-specific configuration.
2. WHEN the active tab URL uses a protocol other than HTTP or HTTPS (e.g. chrome://, about://), THE Popup SHALL display a message indicating that the current page cannot be captured.
3. THE Extension SHALL be loadable as an unpacked extension via chrome://extensions with Developer Mode enabled.

### Requirement 7: API Infrastructure

**User Story:** As a developer, I want the browser-capture endpoint integrated into the existing API Gateway and CDK stack, so that it follows the same patterns as other ingestion endpoints.

#### Acceptance Criteria

1. THE Browser_Capture_API SHALL be defined as a new resource under /v1/ingestion/browser-capture in the existing ApiStack CDK construct.
2. THE Browser_Capture_Lambda SHALL be a separate NodejsFunction with write access to the Ingestion_Bucket.
3. THE Browser_Capture_API SHALL use the same Cognito authorizer as other ingestion endpoints when authentication is enabled.
4. THE Browser_Capture_API SHALL configure CORS to allow requests from the Extension origin (chrome-extension://*).
5. THE Browser_Capture_Lambda SHALL have a timeout of 30 seconds and memory of 512 MB to handle large HTML payloads and base64 screenshot data.
