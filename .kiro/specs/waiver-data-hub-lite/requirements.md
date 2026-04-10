# Requirements Document

## Introduction

Waiver Data Hub Lite is an AWS-native platform that ingests unstructured airline waiver content (email, PDF, web), transforms it into structured machine-readable data using AI, incorporates human-in-the-loop review for accuracy, and exposes the resulting data via a secure public API. This requirements document covers three primary areas: the backend services and API layer, the React-based Review UI (Review Queue and Waiver Detail screens), and the ingestion pipeline built on AWS services.

## Glossary

- **Ingestion_Pipeline**: The set of AWS services (SES, S3, Lambda) responsible for receiving raw waiver content from email, PDF upload, or web sources and storing it in normalized form.
- **Normalisation_Service**: A Lambda function that converts raw waiver content from various formats (email, PDF, HTML) into a uniform plain-text representation suitable for AI extraction.
- **AI_Extraction_Service**: A Lambda function that uses AWS Bedrock and Textract to extract structured waiver fields from normalized plain-text content.
- **Confidence_Scorer**: A component within the AI_Extraction_Service that assigns a numeric confidence score (0.0–1.0) to each extracted waiver field.
- **Waiver_Record**: The canonical structured JSON object representing a single airline waiver, stored in Aurora PostgreSQL.
- **Review_Queue**: A prioritized list of Waiver_Records with low confidence scores that require human verification before publication.
- **Review_UI**: A React-based web application hosted on AWS Amplify that provides the human-in-the-loop interface for reviewing, editing, approving, and rejecting waiver data.
- **Waiver_Detail_Screen**: A split-screen view in the Review_UI showing the source document on the left and the structured data form on the right.
- **Waiver_API**: A RESTful API exposed via AWS API Gateway that provides authenticated access to Waiver_Records.
- **Step_Functions_Orchestrator**: An AWS Step Functions state machine that coordinates the end-to-end workflow from ingestion through storage.
- **Cognito_Auth**: AWS Cognito-based authentication and authorization service providing JWT tokens and RBAC for the Waiver_API and Review_UI.
- **RBAC**: Role-Based Access Control defining permissions for Reviewer, Admin, and API Consumer roles.
- **Confidence_Threshold**: A configurable numeric value (default 0.85) below which a Waiver_Record is routed to the Review_Queue for human review.

## Requirements

### Requirement 1: Email Ingestion

**User Story:** As a system operator, I want the platform to automatically receive airline waiver emails, so that waiver content is captured without manual intervention.

#### Acceptance Criteria

1. WHEN an email is received at the configured SES domain, THE Ingestion_Pipeline SHALL store the raw email content (headers, body, attachments) in the designated S3 ingestion bucket within 30 seconds.
2. WHEN an email with PDF attachments is received, THE Ingestion_Pipeline SHALL extract and store each PDF attachment as a separate S3 object linked to the parent email record.
3. WHEN an email with no parseable waiver content is received, THE Ingestion_Pipeline SHALL tag the S3 object with a status of "unprocessable" and log the event.
4. IF the SES service fails to deliver the email to S3, THEN THE Ingestion_Pipeline SHALL retry delivery up to 3 times with exponential backoff and publish a failure notification to an SNS alert topic.

### Requirement 2: PDF and Web Content Ingestion

**User Story:** As a system operator, I want to upload PDF files and provide web URLs for waiver content, so that waivers from non-email sources are also captured.

#### Acceptance Criteria

1. WHEN a PDF file is uploaded to the S3 ingestion bucket via the presigned URL endpoint, THE Ingestion_Pipeline SHALL validate the file type and store the PDF for processing.
2. WHEN a web URL is submitted to the ingestion endpoint, THE Ingestion_Pipeline SHALL fetch the HTML content from the URL and store the raw HTML in the S3 ingestion bucket.
3. IF a submitted PDF file exceeds 25 MB, THEN THE Ingestion_Pipeline SHALL reject the upload and return an error response indicating the size limit.
4. IF a submitted web URL is unreachable or returns a non-200 HTTP status, THEN THE Ingestion_Pipeline SHALL record the failure with the HTTP status code and URL in the error log.
5. WHEN a user submits a web URL with a monitoring schedule, THE Ingestion_Pipeline SHALL store the URL along with the user-defined polling interval and end date/time.
6. WHILE a monitoring schedule is active, THE Ingestion_Pipeline SHALL fetch the HTML content from the specified URL at the defined interval until the end date/time is reached or the schedule is manually terminated.
7. WHEN HTML content is fetched for a monitored URL, THE Ingestion_Pipeline SHALL store each retrieved version in the S3 ingestion bucket with a timestamped version identifier.
8. WHEN a new version of HTML content is retrieved, THE Ingestion_Pipeline SHALL compare the new version against the most recent previously stored version to detect changes.
9. IF differences are detected between the new and previous HTML versions, THEN THE Ingestion_Pipeline SHALL record the detected changes, mark the document as "Updated", and trigger the AI extraction process for the updated content.
10. IF no differences are detected between the new and previous HTML versions, THEN THE Ingestion_Pipeline SHALL record the fetch event and take no further processing action.
11. IF a monitored web URL becomes unreachable or returns a non-200 HTTP status during scheduled polling, THEN THE Ingestion_Pipeline SHALL record the failure including timestamp, URL, and HTTP status code, and continue monitoring until the next scheduled interval unless a configurable failure threshold is exceeded.
12. IF the configured monitoring end date/time is reached, THEN THE Ingestion_Pipeline SHALL automatically terminate the monitoring schedule and mark the URL as "Completed".
13. THE Review_UI SHALL provide the user with the ability to view active monitoring schedules, modify polling intervals and end date/time, and pause or terminate monitoring manually.
14. THE Ingestion_Pipeline SHALL maintain a version history of all retrieved HTML content and detected changes for each monitored URL.
15. THE Review_UI SHALL ensure that all monitored content, versions, and change logs are available for review within the Waiver_Detail_Screen.
16. IF changes are detected that materially impact waiver rules (dates, routes, fare classes, waiver codes), THEN THE Ingestion_Pipeline SHALL flag the update as "High Impact" and prioritise it in the Review_Queue.

### Requirement 3: Content Normalisation

**User Story:** As a data engineer, I want all ingested content normalized to a uniform format, so that the AI extraction service receives consistent input regardless of the original source.

#### Acceptance Criteria

1. WHEN a new raw object is stored in the S3 ingestion bucket, THE Normalisation_Service SHALL convert the content to plain text within 60 seconds.
2. WHEN a PDF document is processed, THE Normalisation_Service SHALL use AWS Textract to perform OCR and extract text content from the PDF.
3. WHEN an HTML document is processed, THE Normalisation_Service SHALL strip HTML tags, scripts, and styles, retaining only the visible text content.
4. THE Normalisation_Service SHALL store the normalized plain-text output in a separate S3 "normalized" prefix with a reference to the original raw object.
5. IF the Normalisation_Service fails to extract text from a document, THEN THE Normalisation_Service SHALL mark the document as "normalisation_failed" and route it to a dead-letter queue for manual inspection.

### Requirement 4: AI-Powered Waiver Extraction

**User Story:** As a data engineer, I want AI to extract structured waiver fields from normalized text, so that waiver data is available in a machine-readable format.

#### Acceptance Criteria

1. WHEN normalized text is available, THE AI_Extraction_Service SHALL invoke AWS Bedrock to extract the following fields: airline code, waiver title, effective date, expiration date, applicable routes, fare classes, rebooking rules, refund rules, and waiver code.
2. THE AI_Extraction_Service SHALL produce a Waiver_Record conforming to the canonical JSON schema for each successfully extracted waiver.
3. WHEN the AI_Extraction_Service extracts waiver fields, THE Confidence_Scorer SHALL assign a confidence score between 0.0 and 1.0 to each extracted field.
4. THE AI_Extraction_Service SHALL assign an overall confidence score to the Waiver_Record computed as the minimum of all individual field confidence scores.
5. IF the AI_Extraction_Service receives a malformed or empty normalized text input, THEN THE AI_Extraction_Service SHALL return an error result with a descriptive message and mark the source document as "extraction_failed".

### Requirement 5: Extraction Round-Trip Integrity

**User Story:** As a data engineer, I want to verify that extracted waiver data can be serialized and deserialized without data loss, so that data integrity is maintained across the pipeline.

#### Acceptance Criteria

1. THE AI_Extraction_Service SHALL serialize each Waiver_Record to the canonical JSON format.
2. THE AI_Extraction_Service SHALL deserialize the canonical JSON back into a Waiver_Record object.
3. FOR ALL valid Waiver_Records, serializing to JSON then deserializing back to a Waiver_Record SHALL produce an object equivalent to the original (round-trip property).

### Requirement 6: Workflow Orchestration

**User Story:** As a system operator, I want the end-to-end pipeline orchestrated reliably, so that each waiver progresses through all stages automatically.

#### Acceptance Criteria

1. WHEN a new object is stored in the S3 ingestion bucket, THE Step_Functions_Orchestrator SHALL initiate a new workflow execution for that object.
2. THE Step_Functions_Orchestrator SHALL execute the following stages in order: normalisation, AI extraction, confidence scoring, conditional human review routing, and storage.
3. WHILE a workflow execution is in progress, THE Step_Functions_Orchestrator SHALL track the current stage and timestamp for each Waiver_Record.
4. IF any stage in the workflow fails after retries, THEN THE Step_Functions_Orchestrator SHALL mark the Waiver_Record as "pipeline_failed", store the error details, and publish a notification to the SNS alert topic.
5. WHEN the overall confidence score of a Waiver_Record is below the Confidence_Threshold, THE Step_Functions_Orchestrator SHALL route the Waiver_Record to the Review_Queue.
6. WHEN the overall confidence score of a Waiver_Record is at or above the Confidence_Threshold, THE Step_Functions_Orchestrator SHALL store the Waiver_Record directly with a status of "auto_approved".

### Requirement 7: Waiver Storage

**User Story:** As a data engineer, I want extracted waiver data stored in a relational database, so that it can be queried efficiently by the API and UI.

#### Acceptance Criteria

1. WHEN a Waiver_Record is approved (auto or human), THE Waiver_API SHALL persist the Waiver_Record to Aurora PostgreSQL with a status of "active".
2. THE Waiver_API SHALL store each Waiver_Record with the following metadata: record ID, source type, ingestion timestamp, extraction timestamp, approval timestamp, reviewer ID (if human-reviewed), and version number.
3. WHEN a Waiver_Record is updated, THE Waiver_API SHALL increment the version number and retain the previous version for audit purposes.
4. THE Waiver_API SHALL enforce a unique constraint on the combination of airline code, waiver code, and effective date to prevent duplicate records.

### Requirement 8: Waiver API — List and Retrieve

**User Story:** As an API consumer, I want to list and retrieve waivers, so that I can integrate waiver data into downstream systems.

#### Acceptance Criteria

1. WHEN a GET request is made to /v1/waivers, THE Waiver_API SHALL return a paginated list of Waiver_Records with a default page size of 20 and a maximum page size of 100.
2. WHEN a GET request is made to /v1/waivers/{id}, THE Waiver_API SHALL return the full Waiver_Record for the specified ID.
3. IF a GET request is made to /v1/waivers/{id} with a non-existent ID, THEN THE Waiver_API SHALL return a 404 status code with a descriptive error message.
4. WHEN a GET request is made to /v1/waivers/active, THE Waiver_API SHALL return only Waiver_Records with a status of "active" and an expiration date in the future.
5. WHEN a GET request is made to /v1/waivers/search with query parameters (airline, date range, route, status), THE Waiver_API SHALL return Waiver_Records matching all provided filter criteria.

### Requirement 9: API Authentication and Authorization

**User Story:** As a security engineer, I want the API protected by authentication and role-based access control, so that only authorized users and systems can access waiver data.

#### Acceptance Criteria

1. THE Cognito_Auth SHALL require a valid JWT token in the Authorization header for all Waiver_API requests.
2. IF a request is made without a valid JWT token, THEN THE Waiver_API SHALL return a 401 status code.
3. IF a request is made with a valid JWT token but insufficient role permissions, THEN THE Waiver_API SHALL return a 403 status code.
4. THE Cognito_Auth SHALL support three roles: "reviewer" (read + review actions), "admin" (full access), and "api_consumer" (read-only access to published waivers).
5. THE Waiver_API SHALL log all API requests including the caller identity, endpoint, method, and timestamp to CloudTrail.


### Requirement 10: Review Queue Screen

**User Story:** As a reviewer, I want to see a prioritized list of low-confidence waivers, so that I can efficiently review the waivers most likely to contain errors first.

#### Acceptance Criteria

1. WHEN a reviewer navigates to the Review Queue screen, THE Review_UI SHALL display a table of Waiver_Records with a status of "pending_review", sorted by overall confidence score in ascending order.
2. THE Review_UI SHALL display the following columns in the Review Queue table: waiver code, airline code, effective date, expiration date, overall confidence score, source type, and ingestion timestamp.
3. WHEN a reviewer applies filters (airline, date range, confidence range) on the Review Queue, THE Review_UI SHALL update the table to show only matching Waiver_Records.
4. WHEN a reviewer selects one or more Waiver_Records in the Review Queue, THE Review_UI SHALL enable bulk actions: bulk approve and bulk reject.
5. WHEN a reviewer clicks on a Waiver_Record row in the Review Queue, THE Review_UI SHALL navigate to the Waiver_Detail_Screen for that record.
6. THE Review_UI SHALL display a badge on each row indicating the confidence level: green for scores above 0.7, yellow for scores between 0.5 and 0.7, and red for scores below 0.5.

### Requirement 11: Waiver Detail Screen — Source Document View

**User Story:** As a reviewer, I want to see the original source document alongside the extracted data, so that I can verify extraction accuracy.

#### Acceptance Criteria

1. WHEN a reviewer opens the Waiver_Detail_Screen, THE Review_UI SHALL display a split-screen layout with the source document rendered on the left panel and the structured data form on the right panel.
2. THE Review_UI SHALL render PDF source documents using an embedded PDF viewer in the left panel.
3. THE Review_UI SHALL render email and HTML source documents as formatted text in the left panel.
4. WHEN the source document is not available, THE Review_UI SHALL display a placeholder message indicating the source is unavailable.
5. THE Review_UI SHALL allow the reviewer to resize the split-screen panels by dragging the divider.

### Requirement 12: Waiver Detail Screen — Structured Data Form

**User Story:** As a reviewer, I want to edit extracted waiver fields, so that I can correct any AI extraction errors before approval.

#### Acceptance Criteria

1. THE Review_UI SHALL display all extracted waiver fields (airline code, waiver title, effective date, expiration date, applicable routes, fare classes, rebooking rules, refund rules, waiver code) as editable form fields on the right panel.
2. THE Review_UI SHALL display the confidence score next to each field, using color coding: green for scores above 0.85, yellow for scores between 0.6 and 0.85, and red for scores below 0.6.
3. WHEN a reviewer modifies a field value, THE Review_UI SHALL visually highlight the modified field to distinguish it from unmodified fields.
4. THE Review_UI SHALL validate date fields to ensure the effective date is before the expiration date before allowing form submission.
5. THE Review_UI SHALL validate that required fields (airline code, waiver code, effective date, expiration date) are not empty before allowing form submission.

### Requirement 13: Waiver Detail Screen — Review Actions

**User Story:** As a reviewer, I want to approve, edit, or reject a waiver, so that only verified data is published to the API.

#### Acceptance Criteria

1. WHEN a reviewer clicks the "Approve" button on the Waiver_Detail_Screen, THE Review_UI SHALL submit the Waiver_Record with a status of "approved" to the Waiver_API and navigate back to the Review_Queue.
2. WHEN a reviewer clicks the "Reject" button on the Waiver_Detail_Screen, THE Review_UI SHALL prompt for a rejection reason, submit the Waiver_Record with a status of "rejected" and the reason to the Waiver_API, and navigate back to the Review_Queue.
3. WHEN a reviewer clicks the "Save Draft" button after editing fields, THE Review_UI SHALL persist the edits without changing the review status.
4. IF the Waiver_API returns an error during an approve or reject action, THEN THE Review_UI SHALL display an error notification with the error message and retain the current screen state.
5. WHEN a reviewer approves a Waiver_Record with modified fields, THE Review_UI SHALL include the modified field values and the reviewer ID in the submission to the Waiver_API.

### Requirement 14: Review UI — Dashboard

**User Story:** As a reviewer or admin, I want a dashboard showing key metrics, so that I can monitor the health and throughput of the waiver processing pipeline.

#### Acceptance Criteria

1. WHEN a user navigates to the Dashboard screen, THE Review_UI SHALL display KPI cards showing: count of active waivers, count of waivers processed today, count of waivers pending review, and average confidence score.
2. THE Review_UI SHALL display a bar chart showing waiver ingestion volume over the last 30 days.
3. THE Review_UI SHALL display a pie chart showing waiver distribution by airline.
4. THE Review_UI SHALL display a table of the 10 most recently ingested waivers with columns: waiver code, airline, status, and ingestion timestamp.
5. THE Review_UI SHALL refresh dashboard data automatically every 60 seconds without requiring a full page reload.

### Requirement 15: Review UI — Navigation and Layout

**User Story:** As a user, I want a clean and intuitive navigation structure, so that I can quickly access different sections of the application.

#### Acceptance Criteria

1. THE Review_UI SHALL display a persistent left sidebar with navigation links to: Dashboard, Waivers, Review Queue, Rules Engine, Reports, and Settings.
2. THE Review_UI SHALL display a top navigation bar with a global search input, notification icon, user profile menu, and action buttons.
3. THE Review_UI SHALL use a light grey background (#F5F5F5) with white card containers and subtle box shadows for content sections.
4. THE Review_UI SHALL use a blue primary action color (#1A73E8) for buttons and interactive elements.
5. THE Review_UI SHALL use status badges with green (#34A853) for active/approved, red (#EA4335) for rejected/failed, and yellow (#FBBC04) for pending states.
6. THE Review_UI SHALL be responsive and render correctly on viewport widths from 1024px to 1920px.

### Requirement 16: Review UI — Waiver List Screen

**User Story:** As a user, I want to browse and search all waivers, so that I can find specific waivers regardless of their review status.

#### Acceptance Criteria

1. WHEN a user navigates to the Waiver List screen, THE Review_UI SHALL display a paginated table of all Waiver_Records with columns: waiver code, airline code, waiver title, effective date, expiration date, status, and confidence score.
2. THE Review_UI SHALL provide a search bar that filters Waiver_Records by waiver code, airline code, or waiver title using substring matching.
3. THE Review_UI SHALL provide filter dropdowns for: airline, status (active, pending_review, rejected, expired), and date range.
4. WHEN a user clicks on a row in the Waiver List table, THE Review_UI SHALL navigate to the Waiver_Detail_Screen for that record.
5. THE Review_UI SHALL display the total count of matching records and the current page number.

### Requirement 17: Review UI — Authentication

**User Story:** As a security engineer, I want the Review UI to require authentication, so that only authorized personnel can access the review interface.

#### Acceptance Criteria

1. WHEN an unauthenticated user accesses the Review_UI, THE Review_UI SHALL redirect the user to the Cognito-hosted login page.
2. WHEN a user successfully authenticates via Cognito, THE Review_UI SHALL store the JWT token and redirect the user to the Dashboard.
3. WHEN a user's JWT token expires, THE Review_UI SHALL attempt to refresh the token using the refresh token, and redirect to the login page if the refresh fails.
4. THE Review_UI SHALL include the JWT token in the Authorization header of all requests to the Waiver_API.
5. THE Review_UI SHALL display the authenticated user's name and role in the top navigation bar profile menu.
6. WHEN a user clicks "Sign Out" in the profile menu, THE Review_UI SHALL invalidate the session and redirect to the login page.
