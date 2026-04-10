# Requirements Document

## Introduction

The existing duplicate-waiver-detection feature flags individual duplicate records during ingestion and shows a simple "Duplicate" badge in the UI. However, when the same waiver is ingested multiple times (e.g. 5 times), the list views display all 5 copies, cluttering the interface. This feature introduces duplicate grouping: list views collapse duplicate waivers into a single row showing only the latest copy (by ingestion time) with a count badge (e.g. "Duplicate (5)"), and the waiver detail page provides a "Previous copies" section listing all earlier duplicates with navigation links. The grouping logic uses the `airline_code` + `waiver_code` composite key and works for both pre-existing records (without `is_duplicate` flags) and newly ingested ones.

## Glossary

- **API_Handler**: The Lambda function (`lambdas/src/api/handler.ts`) that serves waiver data to the UI via REST endpoints.
- **Waiver_Group**: A set of waiver records sharing the same `airline_code` and `waiver_code` values, representing multiple ingestions of the same waiver.
- **Latest_Copy**: The waiver record within a Waiver_Group that has the most recent `ingestion_timestamp`.
- **Previous_Copy**: Any waiver record within a Waiver_Group that is not the Latest_Copy.
- **Duplicate_Count**: An integer representing the total number of waiver records in a Waiver_Group, including the Latest_Copy.
- **Waivers_Table**: The DynamoDB table that stores all waiver records, with a GSI `airline_code-waiver_code-index` for composite-key lookups.
- **Dashboard_UI**: The React component (`ui/src/pages/Dashboard.tsx`) that renders the main dashboard including a recent waivers table.
- **Waiver_List_UI**: The React component (`ui/src/pages/WaiverList.tsx`) that renders the paginated list of all waivers.
- **Review_Queue_UI**: The React component (`ui/src/pages/ReviewQueue.tsx`) that renders waivers pending human review.
- **Waiver_Detail_UI**: The React component (`ui/src/pages/WaiverDetail.tsx`) that renders a single waiver's full details.
- **Group_Copies_Endpoint**: An API endpoint or parameter that returns all waiver records belonging to a specific Waiver_Group.

## Requirements

### Requirement 1: Group waivers by composite key and return only the latest per group

**User Story:** As a waiver operations user, I want the API to return only the latest copy of each waiver group in list responses, so that I see a de-duplicated view without redundant rows.

#### Acceptance Criteria

1. WHEN the API_Handler returns a list of waivers, THE API_Handler SHALL group records by `airline_code` + `waiver_code` and return only the Latest_Copy for each Waiver_Group.
2. WHEN a Waiver_Group contains more than one record, THE API_Handler SHALL include a `duplicate_count` field on the Latest_Copy indicating the total number of records in the Waiver_Group.
3. WHEN a Waiver_Group contains exactly one record, THE API_Handler SHALL set `duplicate_count` to `1` on that record.
4. THE API_Handler SHALL determine the Latest_Copy by selecting the record with the most recent `updated_at` timestamp within each Waiver_Group, so that user-edited records (drafts) are preferred over newer but unedited ingestions.
5. THE API_Handler SHALL apply grouping to all list endpoints that feed the Dashboard_UI, Waiver_List_UI, and Review_Queue_UI.
6. WHEN a Waiver_Group contains records created before the duplicate-waiver-detection feature (records without `is_duplicate` flag), THE API_Handler SHALL include those records in the grouping logic using the same `airline_code` + `waiver_code` composite key.

### Requirement 2: Provide an endpoint to retrieve all copies of a waiver group

**User Story:** As a waiver operations user, I want to view all copies of a duplicated waiver, so that I can inspect each ingestion and compare sources.

#### Acceptance Criteria

1. WHEN a request is made to the Group_Copies_Endpoint with an `airline_code` and `waiver_code`, THE API_Handler SHALL return all waiver records in the corresponding Waiver_Group.
2. THE API_Handler SHALL sort the returned records by `ingestion_timestamp` in descending order, with the Latest_Copy first.
3. THE API_Handler SHALL include `id`, `ingestion_timestamp`, `source_type`, `status`, and `created_at` fields on each returned record.
4. IF no records exist for the provided `airline_code` and `waiver_code`, THEN THE API_Handler SHALL return an empty list with a 200 status code.

### Requirement 3: Display grouped waivers with count badge on the Dashboard

**User Story:** As a waiver operations user, I want the dashboard recent waivers table to show only the latest copy per group with a duplicate count, so that the dashboard is not cluttered with repeated entries.

#### Acceptance Criteria

1. WHEN a waiver in the recent waivers table has a `duplicate_count` greater than 1, THE Dashboard_UI SHALL display a "Duplicate (N)" badge where N is the Duplicate_Count.
2. WHEN a waiver in the recent waivers table has a `duplicate_count` of 1, THE Dashboard_UI SHALL not display a duplicate badge for that waiver.
3. THE Dashboard_UI SHALL render the "Duplicate (N)" badge with the same base colour scheme used by the existing "Duplicate" badge (orange background, dark orange text).

### Requirement 4: Display grouped waivers with count badge in the Waiver List

**User Story:** As a waiver operations user, I want the waiver list page to show only the latest copy per group with a duplicate count badge, so that I can browse waivers without seeing repeated entries.

#### Acceptance Criteria

1. WHEN a waiver in the list has a `duplicate_count` greater than 1, THE Waiver_List_UI SHALL display a "Duplicate (N)" badge where N is the Duplicate_Count.
2. WHEN a waiver in the list has a `duplicate_count` of 1, THE Waiver_List_UI SHALL not display a duplicate badge for that waiver.
3. THE Waiver_List_UI SHALL replace the existing simple "Duplicate" badge with the new "Duplicate (N)" count badge.
4. THE Waiver_List_UI SHALL render the "Duplicate (N)" badge with the same base colour scheme used by the existing "Duplicate" badge (orange background, dark orange text).

### Requirement 5: Display grouped waivers with count badge in the Review Queue

**User Story:** As a reviewer, I want the review queue to show only the latest copy per group with a duplicate count badge, so that I review each unique waiver once rather than reviewing every duplicate copy.

#### Acceptance Criteria

1. WHEN a waiver in the review queue has a `duplicate_count` greater than 1, THE Review_Queue_UI SHALL display a "Duplicate (N)" badge where N is the Duplicate_Count.
2. WHEN a waiver in the review queue has a `duplicate_count` of 1, THE Review_Queue_UI SHALL not display a duplicate badge for that waiver.
3. THE Review_Queue_UI SHALL replace the existing simple "Duplicate" badge with the new "Duplicate (N)" count badge.
4. THE Review_Queue_UI SHALL render the "Duplicate (N)" badge with the same styling used in the Waiver_List_UI for consistency.

### Requirement 6: Show previous copies section on the Waiver Detail page

**User Story:** As a waiver operations user, I want to see all previous copies of a duplicated waiver on the detail page, so that I can review the ingestion history and compare sources.

#### Acceptance Criteria

1. WHEN a waiver has a `duplicate_count` greater than 1, THE Waiver_Detail_UI SHALL display a "Previous copies" section listing all Previous_Copy records in the Waiver_Group.
2. THE Waiver_Detail_UI SHALL display each Previous_Copy as a clickable link that navigates to the detail page of that copy.
3. THE Waiver_Detail_UI SHALL display the `ingestion_timestamp` and `source_type` for each Previous_Copy in the list.
4. THE Waiver_Detail_UI SHALL sort the Previous_Copy list by `ingestion_timestamp` in descending order (most recent first).
5. WHEN a waiver has a `duplicate_count` of 1, THE Waiver_Detail_UI SHALL not display the "Previous copies" section.
6. THE Waiver_Detail_UI SHALL fetch the list of Previous_Copy records from the Group_Copies_Endpoint using the current waiver's `airline_code` and `waiver_code`.

### Requirement 7: Backward compatibility with pre-existing records

**User Story:** As a developer, I want the grouping logic to work correctly for waiver records created before the duplicate-waiver-detection feature was deployed, so that the UI presents a consistent grouped view regardless of when records were ingested.

#### Acceptance Criteria

1. WHEN a waiver record does not have an `is_duplicate` attribute, THE API_Handler SHALL still include the record in Waiver_Group aggregation using the `airline_code` + `waiver_code` composite key.
2. WHEN grouping produces a Duplicate_Count greater than 1 for a group containing only pre-existing records (none with `is_duplicate` set), THE API_Handler SHALL return the Latest_Copy with the computed `duplicate_count` field.
3. THE API_Handler SHALL treat the absence of `is_duplicate` as `false` when computing group membership and selecting the Latest_Copy.

### Requirement 8: Preserve user edits when selecting the primary record

**User Story:** As a waiver operations user, I want my draft edits to be preserved as the primary record even when a new duplicate is ingested afterwards, so that my manual corrections are never hidden by a fresh AI extraction.

#### Acceptance Criteria

1. WHEN a user saves draft edits on a waiver record (updating its `updated_at` timestamp), and a subsequent duplicate is ingested into the same Waiver_Group, THE API_Handler SHALL select the user-edited record as the Latest_Copy because its `updated_at` is more recent than the new ingestion's `updated_at`.
2. WHEN multiple records in a Waiver_Group have the same `updated_at` timestamp, THE API_Handler SHALL break the tie by selecting the record with the most recent `ingestion_timestamp`.
3. THE Waiver_Detail_UI SHALL indicate when the displayed record contains user edits by showing the `updated_at` timestamp alongside the `ingestion_timestamp` in the "Previous copies" section, so the user can distinguish between AI-extracted and human-edited records.
4. WHEN a new duplicate is ingested and the user-edited record remains the Latest_Copy, THE Duplicate_Count SHALL still increment to reflect the new ingestion.
