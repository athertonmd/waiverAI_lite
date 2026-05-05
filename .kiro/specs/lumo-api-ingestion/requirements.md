# Requirements Document

## Introduction

Integrate with the Lumo (thinklumo.com) third-party API to automatically poll for airline waiver data and ingest it into WaiverHub. The Lumo API provides a `waivers/search` endpoint that returns pre-structured JSON waiver data. Unlike existing ingestion sources (email, PDF, web scraping), Lumo data arrives as structured JSON and does not require document normalisation. The raw Lumo JSON response is stored as the source document, and AI (Bedrock) maps the Lumo fields to WaiverHub's 16-field extraction schema. Human corrections feed the existing learning loop to improve future Lumo-to-WaiverHub mappings.

## Glossary

- **Lumo_Poller**: The Lambda function that runs on an EventBridge schedule to call the Lumo API and initiate ingestion of waiver data into WaiverHub.
- **Lumo_API**: The third-party Lumo waivers/search REST endpoint (documented at SwaggerHub thinklumo/flapi/2.0.0) that returns structured JSON waiver data.
- **Extraction_Lambda**: The existing WaiverHub Lambda function that uses Amazon Bedrock to extract and map waiver fields from source text into the WaiverHub schema.
- **Storage_Lambda**: The existing WaiverHub Lambda function that persists mapped waiver fields, AI extraction snapshots, and duplicate detection results to DynamoDB.
- **Settings_Table**: The existing DynamoDB table that stores application configuration, including the last Lumo poll timestamp and known Lumo waiver IDs.
- **Ingestion_Bucket**: The existing S3 bucket where raw source documents and extracted records are stored.
- **WaiverHub_Schema**: The 16 Mantic Point extraction fields defined in the field-schema module (airline_code, airline_name, waiver_title, waiver_code, issued_date, effective_date, expiration_date, travel_dates_qualifier, ticket_issued_qualifier, ticket_issued_date, airports_qualifier, airports, fare_classes, rebooking_rules, refund_rules, release_notes).
- **Waiver_Detail_View**: The existing two-pane UI page that displays the source document on the left and the AI-mapped extracted fields on the right.
- **Corrections_Loop**: The existing mechanism where human edits to AI-extracted fields are recorded as corrections and used as few-shot examples in future extraction prompts.
- **Lumo_Waiver_ID**: The unique identifier (`id` field) assigned to each waiver by the Lumo API.
- **Active_Waiver_Registry**: A record in the Settings_Table that tracks known Lumo_Waiver_IDs and their last-seen timestamps to distinguish new waivers from updated waivers.

## Requirements

### Requirement 1: Scheduled Polling of Lumo API

**User Story:** As a WaiverHub operator, I want the system to automatically poll the Lumo API on a fixed schedule, so that new and updated airline waivers are ingested without manual intervention.

#### Acceptance Criteria

1. THE Lumo_Poller SHALL call the Lumo_API waivers/search endpoint every 2 minutes using an EventBridge scheduled rule.
2. WHEN the Lumo_Poller invokes the Lumo_API, THE Lumo_Poller SHALL authenticate using an API key retrieved from AWS Secrets Manager.
3. IF the Lumo_API returns an HTTP error status (4xx or 5xx), THEN THE Lumo_Poller SHALL log the error details including HTTP status code and response body, and terminate the current poll cycle without throwing an unhandled exception.
4. IF the Lumo_API does not respond within 10 seconds, THEN THE Lumo_Poller SHALL abort the request and log a timeout error.
5. WHEN the Lumo_Poller completes a successful poll, THE Lumo_Poller SHALL update the last poll timestamp in the Settings_Table.

### Requirement 2: New vs Updated Waiver Detection

**User Story:** As a WaiverHub operator, I want the system to distinguish between new and updated Lumo waivers, so that new waivers are ingested and updated waivers are re-processed without creating unnecessary duplicates.

#### Acceptance Criteria

1. THE Lumo_Poller SHALL maintain an Active_Waiver_Registry in the Settings_Table that maps each known Lumo_Waiver_ID to a content hash of the waiver payload.
2. WHEN the Lumo_API returns a waiver with a Lumo_Waiver_ID not present in the Active_Waiver_Registry, THE Lumo_Poller SHALL classify the waiver as new and initiate ingestion.
3. WHEN the Lumo_API returns a waiver with a Lumo_Waiver_ID already present in the Active_Waiver_Registry and the content hash differs from the stored hash, THE Lumo_Poller SHALL classify the waiver as updated and initiate re-ingestion.
4. WHEN the Lumo_API returns a waiver with a Lumo_Waiver_ID already present in the Active_Waiver_Registry and the content hash matches the stored hash, THE Lumo_Poller SHALL skip the waiver without initiating ingestion.
5. WHEN a waiver is ingested or re-ingested, THE Lumo_Poller SHALL update the Active_Waiver_Registry entry for that Lumo_Waiver_ID with the new content hash and current timestamp.

### Requirement 3: Raw Lumo JSON Storage

**User Story:** As a WaiverHub user, I want the raw Lumo API response stored as the source document, so that I can view the original data alongside the AI-mapped fields.

#### Acceptance Criteria

1. WHEN the Lumo_Poller receives a waiver from the Lumo_API, THE Lumo_Poller SHALL store the raw JSON response for that individual waiver as an object in the Ingestion_Bucket under the key pattern `raw/lumo/{lumo_waiver_id}/{timestamp}.json`.
2. THE Lumo_Poller SHALL set the S3 object content type to `application/json` and include metadata keys `source-type` with value `lumo` and `lumo-waiver-id` with the Lumo_Waiver_ID.
3. WHEN the raw JSON is stored in S3, THE Lumo_Poller SHALL start the extraction pipeline by invoking the Step Functions state machine with `sourceType` set to `lumo`, the `s3Key` pointing to the stored raw JSON, and a newly generated `recordId`.

### Requirement 4: AI-Driven Field Mapping via Extraction Pipeline

**User Story:** As a WaiverHub operator, I want the Lumo JSON data mapped to WaiverHub's schema using AI, so that human corrections can feed the learning loop and improve future mappings.

#### Acceptance Criteria

1. WHEN the Extraction_Lambda receives an event with `sourceType` equal to `lumo`, THE Extraction_Lambda SHALL read the raw Lumo JSON from S3 and pass the full JSON text as the source content to the Bedrock extraction prompt.
2. WHEN building the extraction prompt for a Lumo source, THE Extraction_Lambda SHALL include a preamble instructing the model that the source is structured JSON from the Lumo API and listing the Lumo field names alongside their corresponding WaiverHub_Schema field names.
3. THE Extraction_Lambda SHALL map the Bedrock response to all 16 WaiverHub_Schema fields and compute per-field confidence scores, consistent with the existing extraction behaviour for other source types.
4. WHEN the extraction is complete, THE Extraction_Lambda SHALL store the extracted record JSON in the Ingestion_Bucket under the `extracted/` prefix and pass the result to the confidence score routing step.

### Requirement 5: Normalisation Bypass for Lumo Sources

**User Story:** As a WaiverHub developer, I want the pipeline to skip the normalisation and Chromium rendering steps for Lumo sources, so that structured JSON is not unnecessarily processed as raw HTML or text.

#### Acceptance Criteria

1. WHEN the pipeline receives an input with `sourceType` equal to `lumo`, THE pipeline SHALL skip the Normalise step and the Chromium Render step, and proceed directly to the Extract step.
2. WHEN the pipeline skips normalisation for a Lumo source, THE pipeline SHALL set `normalizedS3Key` equal to the `s3Key` of the raw Lumo JSON, so that the Extraction_Lambda reads the correct file.
3. WHEN the pipeline skips normalisation for a Lumo source, THE pipeline SHALL set `sourceS3Key` equal to the `s3Key` of the raw Lumo JSON.

### Requirement 6: Storage and Duplicate Detection for Lumo Waivers

**User Story:** As a WaiverHub operator, I want Lumo waivers stored with proper source attribution and duplicate detection, so that they integrate seamlessly with existing waiver management workflows.

#### Acceptance Criteria

1. WHEN the Storage_Lambda receives a record with `source_type` equal to `lumo`, THE Storage_Lambda SHALL persist the record to the Waivers DynamoDB table with `source_type` set to `lumo`.
2. THE Storage_Lambda SHALL store an `ai_extraction` snapshot of the AI-mapped fields for Lumo waivers, consistent with the existing behaviour for other source types.
3. THE Storage_Lambda SHALL run the existing duplicate detection logic (matching on `airline_code` and `waiver_code`) for Lumo waivers.
4. WHEN a Lumo waiver is stored, THE Storage_Lambda SHALL fire the `waiver.created` webhook event with the record ID and status.

### Requirement 7: Source Document Display in Waiver Detail View

**User Story:** As a WaiverHub user, I want to see the raw Lumo JSON in the source pane of the waiver detail view, so that I can compare the original API data with the AI-mapped fields.

#### Acceptance Criteria

1. WHEN the Waiver_Detail_View loads a waiver with `source_type` equal to `lumo`, THE Waiver_Detail_View SHALL display the raw Lumo JSON response in the left (source) pane, formatted as pretty-printed JSON with syntax highlighting.
2. WHEN the Waiver_Detail_View loads a waiver with `source_type` equal to `lumo`, THE Waiver_Detail_View SHALL hide the "Source Page" tab and screenshot viewer, as Lumo sources have no associated HTML page or screenshot.
3. THE Waiver_Detail_View SHALL display the AI-mapped extracted fields in the right (data) pane with confidence scores, consistent with the existing behaviour for other source types.

### Requirement 8: Human Corrections and Learning Loop for Lumo Waivers

**User Story:** As a WaiverHub operator, I want human corrections to Lumo-sourced waivers to feed the learning loop, so that future AI mappings from Lumo data improve over time.

#### Acceptance Criteria

1. WHEN a user saves a draft or approves a Lumo-sourced waiver with amended fields, THE API handler SHALL compare the amended values against the `ai_extraction` snapshot and record corrections in the Corrections table with `source_type` set to `lumo`.
2. WHEN the Extraction_Lambda processes a Lumo source, THE Extraction_Lambda SHALL fetch recent corrections with `source_type` equal to `lumo` and include them as few-shot examples in the Bedrock extraction prompt.

### Requirement 9: CDK Infrastructure for Lumo Poller

**User Story:** As a WaiverHub developer, I want the Lumo poller infrastructure defined in CDK, so that the polling Lambda, schedule, and secrets are deployed consistently.

#### Acceptance Criteria

1. THE CDK stack SHALL define a new Lambda function named `LumoPollerFn` with a Node.js 20.x runtime, 512 MB memory, and a 60-second timeout.
2. THE CDK stack SHALL define an EventBridge rule that triggers the LumoPollerFn every 2 minutes.
3. THE CDK stack SHALL grant the LumoPollerFn read access to the Lumo API key secret in AWS Secrets Manager.
4. THE CDK stack SHALL grant the LumoPollerFn read/write access to the Settings_Table for maintaining the Active_Waiver_Registry and last poll timestamp.
5. THE CDK stack SHALL grant the LumoPollerFn write access to the Ingestion_Bucket under the `raw/lumo/` prefix.
6. THE CDK stack SHALL grant the LumoPollerFn permission to start executions of the existing Step Functions state machine.

### Requirement 10: Lumo API Key Management

**User Story:** As a WaiverHub operator, I want the Lumo API key stored securely and rotatable without redeployment, so that credentials are managed safely.

#### Acceptance Criteria

1. THE Lumo_Poller SHALL retrieve the Lumo API key from AWS Secrets Manager at the start of each poll cycle.
2. IF the Lumo API key secret is missing or empty, THEN THE Lumo_Poller SHALL log an error indicating the missing secret and terminate the poll cycle without calling the Lumo_API.
3. THE CDK stack SHALL create an AWS Secrets Manager secret with a default placeholder value for the Lumo API key, with the secret name configurable via CDK context.
