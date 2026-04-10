# Requirements Document

## Introduction

The Waiver Data Hub ingests airline fare waivers from multiple sources (email, PDF, web). Because the same waiver can arrive through different channels or be re-ingested after a page refresh, duplicate records accumulate in the system. This feature adds duplicate detection during the storage step, flags duplicates visually in the UI, and links each duplicate to the original waiver it matches. It also handles the "update number" variant where a waiver code carries a version or update suffix (e.g. `WVR-1234-U2`), treating these as related but distinct records rather than exact duplicates.

## Glossary

- **Storage_Handler**: The Lambda function (`lambdas/src/storage/handler.ts`) that persists extracted waiver records into DynamoDB after normalisation.
- **Waivers_Table**: The DynamoDB table that stores all waiver records, partitioned by `id` with GSIs on `status` and `airline_code`.
- **Duplicate_Detector**: The logic component within the Storage_Handler that queries the Waivers_Table to determine whether an incoming waiver matches an existing record.
- **Original_Waiver**: The earliest-stored waiver record that a newly detected duplicate matches against.
- **Duplicate_Flag**: A boolean attribute (`is_duplicate`) on a waiver record indicating the record is a duplicate of an existing waiver.
- **Duplicate_Of_ID**: A string attribute (`duplicate_of_id`) on a waiver record that references the `id` of the Original_Waiver.
- **Base_Waiver_Code**: The waiver code with any trailing update-number suffix stripped (e.g. `WVR-1234` from `WVR-1234-U2`).
- **Update_Number**: An optional version or update suffix appended to a waiver code (e.g. `-U2`, `-REV3`).
- **Waiver_List_UI**: The React component (`ui/src/pages/WaiverList.tsx`) that renders the paginated list of waivers.
- **Waiver_Detail_UI**: The React component (`ui/src/pages/WaiverDetail.tsx`) that renders a single waiver's details.
- **Review_Queue_UI**: The React component (`ui/src/pages/ReviewQueue.tsx`) that renders waivers pending review.
- **API_Handler**: The Lambda function (`lambdas/src/api/handler.ts`) that serves waiver data to the UI.

## Requirements

### Requirement 1: Detect exact duplicates during storage

**User Story:** As a waiver operations user, I want the system to detect when an incoming waiver is identical to one already stored, so that I do not end up with redundant records.

#### Acceptance Criteria

1. WHEN a waiver record is received for storage, THE Duplicate_Detector SHALL query the Waivers_Table for existing records with the same `airline_code` and `waiver_code`.
2. WHEN an existing record with the same `airline_code` and `waiver_code` is found, THE Duplicate_Detector SHALL mark the incoming record as a duplicate by setting `is_duplicate` to `true` and `duplicate_of_id` to the `id` of the Original_Waiver.
3. WHEN no existing record with the same `airline_code` and `waiver_code` is found, THE Duplicate_Detector SHALL store the incoming record with `is_duplicate` set to `false` and `duplicate_of_id` set to `null`.
4. THE Storage_Handler SHALL persist the incoming waiver record regardless of whether the record is a duplicate, so that no ingested data is silently discarded.

### Requirement 2: Handle update-number variants

**User Story:** As a waiver operations user, I want waivers with update-number suffixes (e.g. `WVR-1234-U2`) to be recognised as related to the base waiver code, so that I can see the relationship without them being treated as exact duplicates.

#### Acceptance Criteria

1. WHEN a waiver code contains an Update_Number suffix, THE Duplicate_Detector SHALL parse the waiver code into a Base_Waiver_Code and an Update_Number.
2. WHEN the incoming waiver has a different Update_Number than the existing record but the same `airline_code` and Base_Waiver_Code, THE Duplicate_Detector SHALL store the incoming record with `is_duplicate` set to `false` and `duplicate_of_id` set to `null`.
3. WHEN the incoming waiver has the same `airline_code`, the same full `waiver_code` (including Update_Number), THE Duplicate_Detector SHALL treat the record as an exact duplicate per Requirement 1.

### Requirement 3: Add duplicate metadata to the waiver record

**User Story:** As a developer, I want duplicate metadata stored on the waiver record, so that the API and UI can surface duplicate information without additional lookups.

#### Acceptance Criteria

1. THE Waivers_Table SHALL include an `is_duplicate` boolean attribute on every waiver record.
2. THE Waivers_Table SHALL include a `duplicate_of_id` string attribute on every waiver record, containing the `id` of the Original_Waiver or `null` when the record is not a duplicate.
3. WHEN a waiver record is created before this feature is deployed, THE Storage_Handler SHALL treat the absence of `is_duplicate` as `false`.

### Requirement 4: Expose duplicate information through the API

**User Story:** As a front-end developer, I want the API to return duplicate metadata on waiver records, so that the UI can display duplicate status.

#### Acceptance Criteria

1. WHEN the API_Handler returns a waiver record, THE API_Handler SHALL include the `is_duplicate` and `duplicate_of_id` fields in the response payload.
2. WHEN the API_Handler returns a list of waivers, THE API_Handler SHALL include the `is_duplicate` and `duplicate_of_id` fields on each waiver in the list.
3. WHERE a `duplicate` filter parameter is provided, THE API_Handler SHALL filter the waiver list to return only records where `is_duplicate` matches the filter value.

### Requirement 5: Display duplicate badge in the waiver list

**User Story:** As a waiver operations user, I want to see a visual indicator on duplicate waivers in the list view, so that I can quickly identify duplicates without opening each record.

#### Acceptance Criteria

1. WHEN a waiver has `is_duplicate` set to `true`, THE Waiver_List_UI SHALL display a "Duplicate" badge next to the waiver's status.
2. THE Waiver_List_UI SHALL render the "Duplicate" badge with a distinct colour that differentiates the badge from existing status and confidence badges.
3. WHEN a waiver has `is_duplicate` set to `false` or the attribute is absent, THE Waiver_List_UI SHALL not display a "Duplicate" badge.

### Requirement 6: Display duplicate badge in the review queue

**User Story:** As a reviewer, I want to see which waivers in the review queue are duplicates, so that I can prioritise my review work.

#### Acceptance Criteria

1. WHEN a waiver in the review queue has `is_duplicate` set to `true`, THE Review_Queue_UI SHALL display a "Duplicate" badge in the waiver row.
2. THE Review_Queue_UI SHALL render the "Duplicate" badge with the same styling used in the Waiver_List_UI for consistency.

### Requirement 7: Show duplicate details on the waiver detail page

**User Story:** As a waiver operations user, I want to see which existing waiver a duplicate matches, so that I can compare the two records and decide how to proceed.

#### Acceptance Criteria

1. WHEN a waiver has `is_duplicate` set to `true`, THE Waiver_Detail_UI SHALL display a notice indicating the waiver is a duplicate.
2. WHEN a waiver has a non-null `duplicate_of_id`, THE Waiver_Detail_UI SHALL display a link to the Original_Waiver detail page.
3. WHEN the user clicks the link to the Original_Waiver, THE Waiver_Detail_UI SHALL navigate to the detail page of the Original_Waiver.
4. IF the Original_Waiver referenced by `duplicate_of_id` no longer exists, THEN THE Waiver_Detail_UI SHALL display a message indicating the original waiver has been removed.

### Requirement 8: Add a DynamoDB index for duplicate lookups

**User Story:** As a developer, I want efficient duplicate lookups during storage, so that the detection step does not add significant latency to the ingestion pipeline.

#### Acceptance Criteria

1. THE Waivers_Table SHALL have a Global Secondary Index with `airline_code` as the partition key and `waiver_code` as the sort key, enabling the Duplicate_Detector to query by composite key without a full table scan.
2. WHEN the Duplicate_Detector queries for existing records, THE Duplicate_Detector SHALL use the GSI to retrieve matching records in a single query operation.
