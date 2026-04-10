# Implementation Plan: Email Arrival Notification

## Overview

Implement email arrival notifications for the waiver ingestion pipeline. The notification module sends emails via SES when new waiver emails are processed. Recipients are managed through new Settings API endpoints and a UI card on the Settings page. Infrastructure changes grant SES send permissions and wire new API routes.

## Tasks

- [x] 1. Create the notification service module
  - [x] 1.1 Create `lambdas/src/email-processor/notification.ts`
    - Export `NotificationParams` interface with `from`, `subject`, `timestamp`, `pdfAttachmentCount`, `messageId`
    - Export `sendArrivalNotification(params: NotificationParams): Promise<void>`
    - Read `notification_recipients` from DynamoDB settings table using `docClient` and `TableNames.settings`
    - If recipients list is empty or missing, log message and return early
    - Read `NOTIFICATION_SENDER` env var; if not set, log warning and return early
    - Build notification email body containing sender, subject, timestamp, and PDF attachment count
    - Call SES `SendEmail` with all recipients as `ToAddresses`
    - Wrap SES call in try/catch — log errors, never re-throw
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.1, 4.3_

  - [ ]* 1.2 Write property tests for notification module
    - Add `fast-check` as a dev dependency in `lambdas/package.json`
    - Create `lambdas/src/email-processor/__tests__/notification.test.ts`
    - **Property 1: Notification body contains all email metadata**
    - **Validates: Requirements 1.2, 1.3**
    - **Property 2: Notification sent to every configured recipient**
    - **Validates: Requirements 1.1**
    - **Property 3: Notification failures never propagate**
    - **Validates: Requirements 1.5**

  - [ ]* 1.3 Write unit tests for notification module
    - Test `sendArrivalNotification` calls SES with correct parameters for known input
    - Test empty recipients list skips SES call
    - Test missing `NOTIFICATION_SENDER` env var skips SES call
    - Test SES error is caught and logged without throwing
    - _Requirements: 1.1, 1.4, 1.5, 4.3_

- [x] 2. Integrate notification into email processor handler
  - [x] 2.1 Call `sendArrivalNotification` from `lambdas/src/email-processor/handler.ts`
    - Import `sendArrivalNotification` from `./notification`
    - After successful email processing (body stored or PDFs stored), call `sendArrivalNotification` with parsed email metadata
    - Pass `from`, `subject`, current ISO timestamp, PDF attachment count, and `messageId`
    - Wrap call in try/catch to ensure notification failure never interrupts the pipeline
    - _Requirements: 1.1, 1.5_

- [x] 3. Checkpoint - Ensure notification module compiles and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Add notification recipients API routes
  - [x] 4.1 Add GET and PUT handlers in `lambdas/src/api/handler.ts`
    - Implement `getNotificationRecipients()` — read `notification_recipients` from settings table, return `{ data: { recipients: string[] } }`, default to empty array
    - Implement `updateNotificationRecipients(event, role)` — admin-only, parse `{ recipients: string[] }` from body
    - Validate recipients is an array, length 0–20, each entry matches `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
    - Return 400 with descriptive error for invalid email, >20 recipients, or non-array body
    - Store as `{ key: "notification_recipients", value: JSON.stringify(recipients), updated_at }` in settings table
    - Wire routes in the handler's router: `GET /v1/settings/notification-recipients` and `PUT /v1/settings/notification-recipients`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 4.2 Write property tests for notification recipients API
    - **Property 4: Recipients round-trip through settings API**
    - **Validates: Requirements 2.2, 2.4**
    - **Property 5: Invalid email addresses are rejected**
    - **Validates: Requirements 2.3, 3.3**
    - **Property 6: Recipients list size is bounded**
    - **Validates: Requirements 2.5**

  - [ ]* 4.3 Write unit tests for notification recipients API
    - Test GET returns empty array when no setting exists
    - Test PUT stores and returns valid recipients
    - Test PUT rejects invalid emails with 400
    - Test PUT rejects >20 recipients with 400
    - Test PUT rejects non-array body with 400
    - _Requirements: 2.1, 2.2, 2.3, 2.5_

- [x] 5. Checkpoint - Ensure API routes compile and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Add NotificationRecipientsCard to Settings UI
  - [x] 6.1 Create `NotificationRecipientsCard` component in `ui/src/pages/Settings.tsx`
    - Add query for `GET /v1/settings/notification-recipients` using `useQuery`
    - Display current recipients as a list with remove (✕) button per entry
    - "Add Recipient" button reveals an email input field
    - Client-side email validation with inline error (same regex as API)
    - Save button sends `PUT /v1/settings/notification-recipients` via `useMutation`
    - Show success/error banners consistent with existing cards
    - Render the card between the existing FieldDefinitionsCard and ApiKeysCard
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 7. Add infrastructure changes
  - [x] 7.1 Update `infra/lib/email-ingestion-stack.ts`
    - Accept `settingsTableName` and `settingsTableArn` in `EmailIngestionStackProps`
    - Add `NOTIFICATION_SENDER` and `SETTINGS_TABLE` environment variables to the Email Processor Lambda
    - Add IAM policy for `ses:SendEmail` on the SES identity ARN (use `arn:aws:ses:*:*:identity/*` or scoped to domain)
    - Add IAM policy for `dynamodb:GetItem` on the settings table ARN
    - _Requirements: 4.1, 4.2_

  - [x] 7.2 Update `infra/lib/api-stack.ts`
    - Add `/v1/settings/notification-recipients` resource under the existing `settings` resource
    - Wire GET and PUT methods to the existing API Lambda integration with auth options
    - _Requirements: 2.1, 2.2_

- [x] 8. Final checkpoint - Ensure all code compiles and tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The `fast-check` library is needed as a dev dependency for property-based tests
