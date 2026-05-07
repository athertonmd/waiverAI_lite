# Requirements Document

## Introduction

This feature adds an "Expired Waivers" KPI tile to the WaiverHub Dashboard page and filters the recent waivers list to exclude expired waivers. The expiry checker already runs daily and marks waivers with `expiration_date < today` as `status = 'expired'`. Currently, the Dashboard does not surface the expired count as a metric, and expired waivers clutter the recent waivers list. This feature provides at-a-glance visibility into expired waivers and keeps the recent list focused on actionable items.

## Glossary

- **Dashboard**: The main overview page at `ui/src/pages/Dashboard.tsx` that displays KPI tiles, charts, and a recent waivers table.
- **API_Handler**: The Lambda function at `lambdas/src/api/handler.ts` that serves the `/v1/dashboard/metrics` endpoint.
- **KPI_Tile**: A summary card on the Dashboard displaying a single numeric metric with a label.
- **Expired_Waiver**: A waiver record whose `status` field equals `'expired'`, set by the daily expiry checker when `expiration_date < today`.
- **Recent_Waivers_List**: The table at the bottom of the Dashboard showing the 10 most recently ingested waivers.
- **Expiry_Checker**: A daily Lambda that scans for waivers past their expiration date and transitions their status to `'expired'`.

## Requirements

### Requirement 1: Expired Waivers KPI Tile

**User Story:** As a dashboard user, I want to see the total count of expired waivers displayed as a KPI tile, so that I can quickly assess how many waivers have passed their expiration date.

#### Acceptance Criteria

1. WHEN the Dashboard page loads, THE API_Handler SHALL return an `expiredWaivers` field in the `/v1/dashboard/metrics` response containing the count of waivers with status equal to `'expired'`.
2. WHEN the Dashboard page renders, THE Dashboard SHALL display a KPI_Tile labelled "Expired Waivers" showing the `expiredWaivers` count.
3. WHEN a user clicks the "Expired Waivers" KPI_Tile, THE Dashboard SHALL navigate to the waivers list filtered by `status=expired`.
4. THE API_Handler SHALL compute the `expiredWaivers` count by counting all waiver records where the `status` field equals `'expired'`.

### Requirement 2: Exclude Expired Waivers from Recent Waivers List

**User Story:** As a dashboard user, I want the recent waivers list to exclude expired waivers, so that I only see actionable and current waivers in the summary table.

#### Acceptance Criteria

1. WHEN the API_Handler computes the recent waivers list for the dashboard metrics response, THE API_Handler SHALL exclude waiver records with status equal to `'expired'` from the Recent_Waivers_List.
2. WHEN the Dashboard renders the Recent_Waivers_List, THE Dashboard SHALL display only non-expired waivers returned by the API.
3. THE API_Handler SHALL continue to return up to 10 waivers in the Recent_Waivers_List after applying the expired status filter.

### Requirement 3: Dashboard KPI Grid Layout

**User Story:** As a dashboard user, I want the KPI tiles to remain visually balanced after adding the new tile, so that the Dashboard layout is consistent and readable.

#### Acceptance Criteria

1. WHEN the Dashboard renders the KPI grid, THE Dashboard SHALL display five KPI tiles in a single row: "Active Waivers", "Processed Today", "Pending Review", "Expired Waivers", and "Avg Confidence".
2. THE Dashboard SHALL adjust the grid layout to accommodate five columns equally spaced.

### Requirement 4: Cache Invalidation for Expired Count

**User Story:** As a system operator, I want the expired waivers count to reflect the latest data within the existing cache window, so that the metric stays reasonably current without additional performance cost.

#### Acceptance Criteria

1. THE API_Handler SHALL include the `expiredWaivers` count within the same cached `dashboard:metrics` response that already caches for 30 seconds.
2. WHEN the Expiry_Checker transitions waivers to expired status, THE Expiry_Checker SHALL invalidate the `dashboard:metrics` cache entry so the next Dashboard request reflects updated counts.
