# Requirements Document

## Introduction

The Mantic Point Solutions "Waiver Automation Fields" specification defines the required fields for waiver data integration. A gap analysis comparing these fields against the current WaiverHub extraction schema (defined in `lambdas/src/shared/field-schema.ts` DEFAULT_SCHEMA) reveals 7 missing required fields and 1 field that needs renaming/retyping. This feature aligns the DEFAULT_SCHEMA with the Mantic Point specification by adding the missing fields, renaming `applicable_routes` to `airports`, and ensuring the extraction prompt, storage layer, UI rendering, and public API all handle the new and modified fields correctly. Because the system already supports configurable extraction fields via the Settings table, the primary change is updating the DEFAULT_SCHEMA fallback and ensuring all downstream consumers handle the expanded field set.

## Glossary

- **DEFAULT_SCHEMA**: The hardcoded fallback array of Field_Definition objects in `lambdas/src/shared/field-schema.ts`, used when no custom schema exists in the Settings_Table.
- **Field_Schema**: The ordered collection of Field_Definition objects stored in the Settings_Table under the key `extraction_fields`.
- **Field_Definition**: A single field configuration object containing key, label, type, definition, required, and order properties.
- **Extraction_Lambda**: The AWS Lambda function (`lambdas/src/extraction/handler.ts`) that invokes Amazon Bedrock to extract structured waiver data from normalized text.
- **Storage_Lambda**: The AWS Lambda function (`lambdas/src/storage/handler.ts`) that persists extracted waiver records to DynamoDB.
- **Settings_Table**: The existing DynamoDB table used for application configuration, accessed via the `settings` key in `TableNames`.
- **WaiverDetail_Page**: The UI page (`ui/src/pages/WaiverDetail.tsx`) that renders the waiver review form and source viewer.
- **PublicWaiverDetail_Page**: The UI page (`ui/src/pages/PublicWaiverDetail.tsx`) that renders waiver data for unauthenticated users.
- **API_Handler**: The Lambda function (`lambdas/src/api/handler.ts`) that serves the REST API for waivers and settings.
- **Public_API_Handler**: The Lambda function (`lambdas/src/public-api/handler.ts`) that serves the public-facing REST API.
- **Mantic_Point_Spec**: The Mantic Point Solutions "Waiver Automation Fields" document defining the required field set for waiver data integration.
- **Bedrock_Prompt**: The text prompt sent to the Bedrock foundation model instructing it which fields to extract and how.

## Requirements

### Requirement 1: Add Missing Required Fields to DEFAULT_SCHEMA

**User Story:** As a system integrator, I want the DEFAULT_SCHEMA to include all fields required by the Mantic Point specification, so that new deployments extract the complete field set without manual configuration.

#### Acceptance Criteria

1. THE DEFAULT_SCHEMA SHALL contain a Field_Definition for `issued_date` with label "Issued Date", type "date", definition "The date the waiver was issued by the airline, in ISO 8601 format (YYYY-MM-DD)", and required set to true.
2. THE DEFAULT_SCHEMA SHALL contain a Field_Definition for `airline_name` with label "Airline Name", type "text", definition "The full airline name as published, e.g. 'American Airlines', 'United Airlines', 'Delta Air Lines'. Extract from the document text; do not infer solely from the airline code", and required set to true.
3. THE DEFAULT_SCHEMA SHALL contain a Field_Definition for `release_notes` with label "Release Notes", type "textarea", definition "Administrative release notes describing what changed in this waiver version, limited to 500 characters", and required set to true.
4. THE DEFAULT_SCHEMA SHALL contain a Field_Definition for `ticket_issued_qualifier` with label "Ticket Issued Qualifier", type "text", definition "The qualifier for ticket issuance date rules. Must be one of: 'on or before', 'on or after', 'between'", and required set to true.
5. THE DEFAULT_SCHEMA SHALL contain a Field_Definition for `ticket_issued_date` with label "Ticket Issued Date", type "date", definition "The ticket issuance date referenced by the waiver, in ISO 8601 format (YYYY-MM-DD). When the qualifier is 'between', this is the start date", and required set to true.
6. THE DEFAULT_SCHEMA SHALL contain a Field_Definition for `travel_dates_qualifier` with label "Travel Dates Qualifier", type "text", definition "The qualifier for affected travel dates. Must be one of: 'on or before', 'on or after', 'between'", and required set to true.
7. THE DEFAULT_SCHEMA SHALL contain a Field_Definition for `airports_qualifier` with label "Airports Qualifier", type "text", definition "The directional qualifier for airports. Must be one of: 'From', 'To', 'From-To'", and required set to true.

### Requirement 2: Rename applicable_routes to airports

**User Story:** As a system integrator, I want the `applicable_routes` field renamed to `airports` with an updated definition, so that the field aligns with the Mantic Point specification which expects individual IATA airport or city codes rather than route pairs.

#### Acceptance Criteria

1. THE DEFAULT_SCHEMA SHALL replace the `applicable_routes` Field_Definition with a Field_Definition having key `airports`, label "Airports", type "array", definition "IATA 3-letter airport or city codes that the waiver applies to, e.g. ['JFK', 'LAX', 'ORD']. Extract individual codes, not origin-destination pairs", and required set to false.
2. WHEN the Storage_Lambda persists a waiver record, THE Storage_Lambda SHALL store the `airports` field value from the extracted record.
3. WHEN the Storage_Lambda persists a waiver record and the extracted record contains an `applicable_routes` field but no `airports` field, THE Storage_Lambda SHALL map the `applicable_routes` value to the `airports` attribute for backward compatibility with records extracted before the schema change.

### Requirement 3: Correct Field Ordering in DEFAULT_SCHEMA

**User Story:** As an administrator, I want the DEFAULT_SCHEMA fields ordered logically following the Mantic Point specification layout, so that the UI presents fields in a consistent and intuitive sequence.

#### Acceptance Criteria

1. THE DEFAULT_SCHEMA SHALL assign `order` values that produce the following field sequence: airline_code, airline_name, waiver_title, waiver_code, issued_date, effective_date, expiration_date, travel_dates_qualifier, ticket_issued_qualifier, ticket_issued_date, airports_qualifier, airports, fare_classes, rebooking_rules, refund_rules, release_notes.
2. THE DEFAULT_SCHEMA SHALL contain exactly 16 Field_Definition objects after all additions and the rename.

### Requirement 4: Extraction Prompt Handles Qualifier Fields

**User Story:** As a product owner, I want the AI extraction prompt to correctly guide the model on qualifier fields, so that the model returns valid qualifier values rather than free-form text.

#### Acceptance Criteria

1. WHEN the Extraction_Lambda builds the Bedrock_Prompt and the Field_Schema contains a field with key `ticket_issued_qualifier`, THE Bedrock_Prompt SHALL instruct the model to return one of the allowed values: "on or before", "on or after", or "between".
2. WHEN the Extraction_Lambda builds the Bedrock_Prompt and the Field_Schema contains a field with key `travel_dates_qualifier`, THE Bedrock_Prompt SHALL instruct the model to return one of the allowed values: "on or before", "on or after", or "between".
3. WHEN the Extraction_Lambda builds the Bedrock_Prompt and the Field_Schema contains a field with key `airports_qualifier`, THE Bedrock_Prompt SHALL instruct the model to return one of the allowed values: "From", "To", or "From-To".
4. THE Extraction_Lambda SHALL include the `definition` text from each Field_Definition in the Bedrock_Prompt, which contains the allowed values for qualifier fields.

### Requirement 5: Storage Lambda Handles New Fields

**User Story:** As a developer, I want the Storage Lambda to persist all new fields from the extracted record, so that no Mantic Point required data is lost during storage.

#### Acceptance Criteria

1. WHEN the Storage_Lambda persists a waiver record, THE Storage_Lambda SHALL store all field values present in the extracted record as top-level attributes on the DynamoDB item, including issued_date, airline_name, release_notes, ticket_issued_qualifier, ticket_issued_date, travel_dates_qualifier, and airports_qualifier.
2. WHEN the Storage_Lambda builds the `ai_extraction` snapshot for few-shot learning, THE Storage_Lambda SHALL include all fields defined in the current Field_Schema, not a hardcoded list of field names.
3. WHEN the Storage_Lambda builds the upsert item in the `upsertWaiver` function, THE Storage_Lambda SHALL include all fields defined in the current Field_Schema rather than a hardcoded list.

### Requirement 6: Release Notes Character Limit Enforcement

**User Story:** As an administrator, I want the release_notes field limited to 500 characters, so that the data conforms to the Mantic Point specification constraint.

#### Acceptance Criteria

1. WHEN the WaiverDetail_Page renders the `release_notes` field, THE WaiverDetail_Page SHALL display a character counter showing the current length and the 500-character limit.
2. WHEN a reviewer enters text into the `release_notes` field that exceeds 500 characters, THE WaiverDetail_Page SHALL truncate or prevent input beyond 500 characters.
3. WHEN the API_Handler receives a save-draft or approve request containing a `release_notes` value longer than 500 characters, THE API_Handler SHALL return a 400 error with a descriptive message.

### Requirement 7: Public API and Browse Pages Display New Fields

**User Story:** As a public user, I want the public waiver browse pages to display the new Mantic Point fields, so that I can see the complete waiver information.

#### Acceptance Criteria

1. WHEN the PublicWaiverDetail_Page renders a waiver, THE PublicWaiverDetail_Page SHALL display all fields present in the waiver record dynamically rather than from a hardcoded field list.
2. WHEN the Public_API_Handler returns waiver data, THE Public_API_Handler SHALL include all top-level field attributes from the waiver record, including the new Mantic Point fields.
3. WHEN the Public_API_Handler search endpoint filters by route, THE Public_API_Handler SHALL filter on the `airports` field instead of `applicable_routes`.

### Requirement 8: Backward Compatibility with Existing Records

**User Story:** As a system operator, I want existing waiver records that were extracted with the old schema to continue displaying correctly, so that the schema change does not break the display of historical data.

#### Acceptance Criteria

1. WHEN the WaiverDetail_Page renders a waiver record that has an `applicable_routes` attribute but no `airports` attribute, THE WaiverDetail_Page SHALL display the `applicable_routes` value under the "Airports" field label.
2. WHEN the PublicWaiverDetail_Page renders a waiver record that has an `applicable_routes` attribute but no `airports` attribute, THE PublicWaiverDetail_Page SHALL display the `applicable_routes` value under the "Airports" field label.
3. WHEN the WaiverDetail_Page renders a waiver record that is missing any of the new Mantic Point fields, THE WaiverDetail_Page SHALL display those fields as empty rather than causing a rendering error.

### Requirement 9: Existing Schema Override Preservation

**User Story:** As an administrator who has already customized the extraction fields via the Settings page, I want my custom schema to remain unchanged after this update, so that the DEFAULT_SCHEMA change does not overwrite my configuration.

#### Acceptance Criteria

1. WHEN a custom Field_Schema exists in the Settings_Table, THE Extraction_Lambda SHALL use the custom Field_Schema and ignore the DEFAULT_SCHEMA.
2. WHEN a custom Field_Schema exists in the Settings_Table, THE API_Handler SHALL return the custom Field_Schema from the GET `/v1/settings/extraction-fields` endpoint.
3. THE DEFAULT_SCHEMA update SHALL only affect deployments where no custom Field_Schema has been saved to the Settings_Table.

### Requirement 10: Travel Dates Semantic Distinction

**User Story:** As a system integrator, I want the effective_date and expiration_date fields to remain as waiver validity dates, and the travel_dates_qualifier to describe affected travel dates separately, so that the Mantic Point distinction between waiver validity and affected travel periods is preserved.

#### Acceptance Criteria

1. THE DEFAULT_SCHEMA SHALL retain the `effective_date` Field_Definition with definition "The start date when the waiver becomes effective, in ISO 8601 format (YYYY-MM-DD)".
2. THE DEFAULT_SCHEMA SHALL retain the `expiration_date` Field_Definition with definition "The end date when the waiver expires, in ISO 8601 format (YYYY-MM-DD)".
3. THE DEFAULT_SCHEMA `travel_dates_qualifier` Field_Definition SHALL have a definition that distinguishes it from waiver validity dates: "The qualifier for affected travel dates (distinct from waiver effective/expiration dates). Must be one of: 'on or before', 'on or after', 'between'".

### Requirement 11: Update OpenAPI Specification for 3rd-Party API Consumers

**User Story:** As a 3rd-party system integrator, I want the OpenAPI specification at `/v1/public/docs` to document all new Mantic Point fields, so that API consumers can discover and use the complete field set programmatically.

#### Acceptance Criteria

1. THE `waiverSchema` in `lambdas/src/public-api/openapi-spec.ts` SHALL include property definitions for all new fields: `issued_date`, `airline_name`, `release_notes`, `ticket_issued_qualifier`, `ticket_issued_date`, `travel_dates_qualifier`, and `airports_qualifier`.
2. THE `waiverSchema` SHALL replace the `applicable_routes` property with an `airports` property of type array with string items.
3. THE search endpoint parameters in the OpenAPI spec SHALL include an `airport` query parameter (replacing `route`) with description "IATA airport or city code to filter by".
4. THE search endpoint parameters SHALL include a `search` query parameter with description "Search by waiver code, airline code, title, or airport".
5. WHEN a 3rd-party consumer fetches `GET /v1/public/docs`, THE response SHALL contain the updated schema reflecting all Mantic Point required fields.
