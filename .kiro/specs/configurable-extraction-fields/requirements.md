# Requirements Document

## Introduction

The Waiver Data Hub currently uses 9 hardcoded extraction fields (airline_code, waiver_title, waiver_code, effective_date, expiration_date, applicable_routes, fare_classes, rebooking_rules, refund_rules). This feature makes extraction fields configurable through the Settings page, allowing administrators to add, edit, remove, and reorder fields without code changes. Each field includes a definition that guides the AI extraction model. The field schema is stored in DynamoDB and consumed by the extraction Lambda, the UI form renderer, and the save/review APIs.

## Glossary

- **Field_Schema**: The ordered collection of Field_Definition objects stored in the Settings table under the key `extraction_fields`. Represents the complete set of fields the system extracts from waiver documents.
- **Field_Definition**: A single field configuration object containing key, label, type, definition, required, and order properties.
- **Extraction_Lambda**: The AWS Lambda function (`lambdas/src/extraction/handler.ts`) that invokes Amazon Bedrock to extract structured waiver data from normalized text.
- **Bedrock_Prompt**: The text prompt sent to the Bedrock foundation model instructing it which fields to extract and how.
- **Settings_Table**: The existing DynamoDB table used for application configuration, accessed via the `settings` key in `TableNames`.
- **Settings_Page**: The UI page (`ui/src/pages/Settings.tsx`) where administrators configure application settings.
- **WaiverDetail_Page**: The UI page (`ui/src/pages/WaiverDetail.tsx`) that renders the waiver form and source viewer.
- **Field_Editor**: The UI component within the Settings_Page that allows administrators to manage Field_Definition objects.
- **Default_Schema**: The set of 9 original Field_Definition objects seeded when no Field_Schema exists in the Settings_Table.
- **API_Handler**: The Lambda function (`lambdas/src/api/handler.ts`) that serves the REST API for waivers and settings.
- **Source_Viewer**: The panel in WaiverDetail_Page that displays the original waiver text with per-field color highlighting.

## Requirements

### Requirement 1: Field Schema Storage

**User Story:** As an administrator, I want extraction field definitions stored in DynamoDB, so that field configuration persists across deployments and is accessible to all system components.

#### Acceptance Criteria

1. THE Settings_Table SHALL store the Field_Schema as a JSON value under the key `extraction_fields`.
2. WHEN no Field_Schema exists in the Settings_Table, THE API_Handler SHALL return the Default_Schema containing the 9 original fields with appropriate definitions, types, and ordering.
3. THE Field_Definition SHALL contain exactly these properties: `key` (string, machine-readable name), `label` (string, display name), `type` (one of "text", "date", "array", "textarea"), `definition` (string, AI guidance text), `required` (boolean), and `order` (number, display position).
4. THE Field_Definition `key` property SHALL be unique within the Field_Schema.
5. THE Field_Definition `key` property SHALL contain only lowercase letters, digits, and underscores.

### Requirement 2: Field Schema API Endpoints

**User Story:** As a frontend developer, I want API endpoints to read and update the field schema, so that the Settings page can manage field definitions.

#### Acceptance Criteria

1. WHEN a GET request is sent to `/v1/settings/extraction-fields`, THE API_Handler SHALL return the current Field_Schema as a JSON array ordered by the `order` property.
2. WHEN a PUT request is sent to `/v1/settings/extraction-fields` with a valid Field_Schema, THE API_Handler SHALL persist the Field_Schema to the Settings_Table and return the saved schema.
3. WHEN a PUT request is sent to `/v1/settings/extraction-fields` with duplicate `key` values, THE API_Handler SHALL return a 400 error with a descriptive message.
4. WHEN a PUT request is sent to `/v1/settings/extraction-fields` with a Field_Definition missing a required property, THE API_Handler SHALL return a 400 error identifying the missing property.
5. WHEN a PUT request is sent to `/v1/settings/extraction-fields` by a non-admin user, THE API_Handler SHALL return a 403 error.

### Requirement 3: Dynamic Bedrock Prompt Construction

**User Story:** As a product owner, I want the AI extraction prompt to be built dynamically from the field definitions, so that adding a new field automatically includes it in extraction without code changes.

#### Acceptance Criteria

1. WHEN the Extraction_Lambda runs, THE Extraction_Lambda SHALL read the Field_Schema from the Settings_Table.
2. THE Extraction_Lambda SHALL build the Bedrock_Prompt by iterating over each Field_Definition in the Field_Schema and including the field `key`, `type`, and `definition` in the prompt instructions.
3. WHEN a Field_Definition has type "array", THE Bedrock_Prompt SHALL instruct the model to return a JSON array of strings for that field.
4. WHEN a Field_Definition has type "date", THE Bedrock_Prompt SHALL instruct the model to return an ISO 8601 date string for that field.
5. WHEN a Field_Definition has type "text" or "textarea", THE Bedrock_Prompt SHALL instruct the model to return a string for that field.
6. THE Bedrock_Prompt SHALL include the `definition` text from each Field_Definition to guide the model on what to extract.
7. THE Bedrock_Prompt SHALL request a confidence score (0.0 to 1.0) for each field defined in the Field_Schema.
8. IF the Settings_Table is unreachable, THEN THE Extraction_Lambda SHALL fall back to the Default_Schema and log a warning.

### Requirement 4: Dynamic Confidence Scoring

**User Story:** As a reviewer, I want confidence scores generated for every configured field, so that I can assess extraction quality for both original and newly added fields.

#### Acceptance Criteria

1. THE Extraction_Lambda SHALL generate a confidence score for each field present in the Field_Schema.
2. THE Extraction_Lambda SHALL compute the overall confidence as the minimum of all per-field confidence scores.
3. WHEN a new field is added to the Field_Schema, THE Extraction_Lambda SHALL include a confidence score for the new field in subsequent extractions without code changes.

### Requirement 5: Dynamic WaiverDetail Form Rendering

**User Story:** As a reviewer, I want the waiver detail form to render fields dynamically from the schema, so that newly added fields appear automatically without UI code changes.

#### Acceptance Criteria

1. WHEN the WaiverDetail_Page loads, THE WaiverDetail_Page SHALL fetch the Field_Schema from the API and render form inputs for each Field_Definition.
2. THE WaiverDetail_Page SHALL render a text input for fields with type "text".
3. THE WaiverDetail_Page SHALL render a date input for fields with type "date".
4. THE WaiverDetail_Page SHALL render a comma-separated text input for fields with type "array".
5. THE WaiverDetail_Page SHALL render a multi-line textarea for fields with type "textarea".
6. THE WaiverDetail_Page SHALL display fields in the order specified by the `order` property.
7. THE WaiverDetail_Page SHALL display the Field_Definition `label` as the form field label.
8. WHEN a Field_Definition has `required` set to true, THE WaiverDetail_Page SHALL mark the form field as required and validate that it is non-empty before saving.

### Requirement 6: Dynamic Source Viewer Highlighting

**User Story:** As a reviewer, I want field highlighting in the source viewer to work with dynamically configured fields, so that I can visually identify extracted content for any field.

#### Acceptance Criteria

1. THE Source_Viewer SHALL assign a distinct highlight color to each field in the Field_Schema.
2. WHEN a new field is added to the Field_Schema, THE Source_Viewer SHALL assign a highlight color to the new field without code changes.
3. THE Source_Viewer SHALL display the field `label` in the highlight legend.

### Requirement 7: Settings Page Field Editor

**User Story:** As an administrator, I want a Field Definitions section on the Settings page, so that I can add, edit, remove, and reorder extraction fields through the UI.

#### Acceptance Criteria

1. THE Settings_Page SHALL display a "Field Definitions" section listing all Field_Definition objects from the Field_Schema.
2. THE Field_Editor SHALL allow the administrator to add a new Field_Definition with all required properties.
3. THE Field_Editor SHALL allow the administrator to edit any property of an existing Field_Definition.
4. THE Field_Editor SHALL allow the administrator to remove a Field_Definition from the Field_Schema.
5. THE Field_Editor SHALL allow the administrator to reorder Field_Definition objects by changing their `order` values.
6. WHEN the administrator saves changes in the Field_Editor, THE Settings_Page SHALL send a PUT request to `/v1/settings/extraction-fields` with the updated Field_Schema.
7. IF the PUT request fails validation, THEN THE Settings_Page SHALL display the error message returned by the API_Handler.

### Requirement 8: Dynamic Save Draft API

**User Story:** As a reviewer, I want the save draft API to accept any fields defined in the current schema, so that edits to dynamically added fields are persisted.

#### Acceptance Criteria

1. WHEN a PUT request is sent to `/v1/waivers/{id}/draft`, THE API_Handler SHALL read the Field_Schema from the Settings_Table to determine the set of editable fields.
2. THE API_Handler SHALL accept and persist values for any field `key` present in the Field_Schema.
3. THE API_Handler SHALL ignore fields in the request body that are not present in the Field_Schema.

### Requirement 9: Dynamic Field Display in List and Queue Pages

**User Story:** As a user, I want newly added fields to appear in the Waivers list and Review Queue pages, so that I can see all extracted data across the application.

#### Acceptance Criteria

1. WHEN the WaiverList page loads, THE WaiverList page SHALL fetch the Field_Schema and display columns for fields marked as visible or required.
2. WHEN the ReviewQueue page loads, THE ReviewQueue page SHALL display extraction data for all fields in the Field_Schema.
3. WHEN a new field is added to the Field_Schema, THE WaiverList page and ReviewQueue page SHALL display the new field without code changes.

### Requirement 10: Default Schema Seeding

**User Story:** As a system operator, I want the 9 original fields to be seeded as the default schema on first load, so that the system works out of the box without manual configuration.

#### Acceptance Criteria

1. WHEN the API_Handler receives a GET request for the Field_Schema and no `extraction_fields` entry exists in the Settings_Table, THE API_Handler SHALL return the Default_Schema.
2. THE Default_Schema SHALL contain exactly 9 Field_Definition objects corresponding to: airline_code, waiver_title, waiver_code, effective_date, expiration_date, applicable_routes, fare_classes, rebooking_rules, and refund_rules.
3. EACH Field_Definition in the Default_Schema SHALL include a meaningful `definition` property that guides the AI extraction model (e.g., airline_code definition: "The IATA 2-letter airline code, e.g. AA for American Airlines, UA for United Airlines").
4. THE Default_Schema SHALL assign appropriate `type` values: "date" for effective_date and expiration_date, "array" for applicable_routes and fare_classes, "textarea" for rebooking_rules and refund_rules, and "text" for the remaining fields.

### Requirement 11: Extraction Lambda Infrastructure Access

**User Story:** As a DevOps engineer, I want the extraction Lambda to have DynamoDB read access to the Settings table, so that it can fetch the field schema at runtime.

#### Acceptance Criteria

1. THE Pipeline_Stack SHALL grant the Extraction_Lambda DynamoDB `GetItem` permission on the Settings_Table.
2. THE Pipeline_Stack SHALL pass the Settings_Table name as the `SETTINGS_TABLE` environment variable to the Extraction_Lambda.
