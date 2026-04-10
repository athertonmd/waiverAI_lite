# Requirements Document

## Introduction

When a waiver email is forwarded to waivers@waiverhub.info, the system should send an email notification to configured recipients informing them that a new waiver has arrived and is being processed. This feature integrates into the existing email ingestion pipeline (SES → S3 → Email Processor Lambda) and leverages the existing Settings infrastructure for recipient configuration.

## Glossary

- **Email_Processor**: The existing Lambda function (`email-processor/handler.ts`) that processes raw emails received via SES, extracts body text and PDF attachments, and stores them in S3 for pipeline processing.
- **Notification_Service**: The component responsible for sending email notifications to configured recipients via Amazon SES when a new waiver email arrives.
- **Notification_Recipients**: The list of email addresses configured in the Settings page to receive arrival notifications.
- **Settings_API**: The existing REST API endpoints under `/v1/settings/` that manage application configuration, backed by the DynamoDB `settings` table.
- **Waiver_Email**: An email forwarded to waivers@waiverhub.info containing waiver information in the body or as PDF attachments.

## Requirements

### Requirement 1: Send Arrival Notification

**User Story:** As an admin, I want to receive an email notification when a new waiver email arrives at waivers@waiverhub.info, so that I know a waiver is being processed without having to check the dashboard.

#### Acceptance Criteria

1. WHEN the Email_Processor successfully processes a Waiver_Email, THE Notification_Service SHALL send an email notification to each address in the Notification_Recipients list.
2. THE Notification_Service SHALL include the sender address, subject line, and timestamp of the original Waiver_Email in the notification email body.
3. THE Notification_Service SHALL include whether the Waiver_Email contained PDF attachments and the count of PDF attachments in the notification email body.
4. IF the Notification_Recipients list is empty, THEN THE Notification_Service SHALL skip sending notifications and log a message indicating no recipients are configured.
5. IF sending a notification email fails, THEN THE Notification_Service SHALL log the error and continue processing without interrupting the waiver ingestion pipeline.

### Requirement 2: Configure Notification Recipients

**User Story:** As an admin, I want to manage the list of email addresses that receive waiver arrival notifications, so that the right people are informed when new waivers come in.

#### Acceptance Criteria

1. THE Settings_API SHALL expose a GET endpoint at `/v1/settings/notification-recipients` that returns the current Notification_Recipients list.
2. THE Settings_API SHALL expose a PUT endpoint at `/v1/settings/notification-recipients` that accepts and stores an updated Notification_Recipients list.
3. WHEN a PUT request contains an email address that is not a valid email format, THE Settings_API SHALL return a 400 response with a descriptive error message.
4. WHEN a PUT request is successful, THE Settings_API SHALL persist the Notification_Recipients list to the DynamoDB settings table.
5. THE Settings_API SHALL allow the Notification_Recipients list to contain between zero and twenty email addresses.

### Requirement 3: Settings UI for Notification Recipients

**User Story:** As an admin, I want to manage notification recipients from the Settings page in the UI, so that I can add or remove recipients without direct API calls.

#### Acceptance Criteria

1. THE Settings page SHALL display a "Notification Recipients" card showing the current list of configured email addresses.
2. WHEN the admin clicks "Add Recipient", THE Settings page SHALL display an input field for entering a new email address.
3. WHEN the admin submits an invalid email address, THE Settings page SHALL display an inline validation error without making an API call.
4. WHEN the admin removes an email address from the list and saves, THE Settings page SHALL send a PUT request to the Settings_API with the updated list.
5. WHEN the save operation succeeds, THE Settings page SHALL display a success banner confirming the update.
6. WHEN the save operation fails, THE Settings page SHALL display an error banner with the failure reason.

### Requirement 4: SES Sending Identity

**User Story:** As a system operator, I want the notification emails to be sent from a verified SES identity, so that the emails are delivered reliably and not flagged as spam.

#### Acceptance Criteria

1. THE Notification_Service SHALL send notification emails using a verified SES sender address configured via an environment variable.
2. THE Email_Processor Lambda SHALL have IAM permissions to call the SES SendEmail API.
3. WHEN the SES sender address is not configured, THE Notification_Service SHALL skip sending notifications and log a warning.
