# Requirements Document

## Introduction

The Rules Engine feature replaces the current hardcoded waiver processing behaviours with a configurable, persisted rule system. Admins can enable or disable rules via the UI, and the backend reads rule configurations at processing time to determine which behaviours are active. The MVP scope covers the four existing hardcoded behaviours (auto-approve threshold, duplicate detection, expired waiver flagging, high-impact priority boost) as persistable, toggleable rules stored in DynamoDB.

## Glossary

- **Rules_Engine**: The backend subsystem that evaluates persisted rule configurations during waiver processing to determine which automated behaviours are active.
- **Rule**: A named configuration record stored in DynamoDB that defines an automated behaviour with an enabled/disabled state and optional parameters.
- **Settings_Table**: The existing DynamoDB table (partition key: `key`) used to store application configuration as key/value pairs.
- **Admin**: A user with the `admin` Cognito group membership who has full access to manage rules.
- **Rules_API**: The set of REST API endpoints under `/v1/rules` that allow reading and updating rule configurations.
- **Rules_UI**: The React page at `ui/src/pages/RulesEngine.tsx` that displays rule cards with enable/disable toggles and parameter editing.
- **Pipeline**: The Step Functions state machine that processes waivers through normalisation, extraction, confidence scoring, and storage.
- **Storage_Handler**: The Lambda function (`lambdas/src/storage/handler.ts`) that persists extracted waiver records to DynamoDB.
- **Confidence_Threshold**: A numeric parameter (0.0–1.0) that determines the minimum overall confidence score for auto-approval.

## Requirements

### Requirement 1: Rule Persistence

**User Story:** As an admin, I want rule configurations to be stored in DynamoDB, so that enable/disable states and parameters survive page refreshes and deployments.

#### Acceptance Criteria

1. THE Rules_Engine SHALL store each rule as a separate item in the Settings_Table with a key prefix of `rule:` followed by the rule identifier.
2. WHEN the application starts for the first time, THE Rules_Engine SHALL seed default rule records for the four built-in rules (auto_approve_threshold, duplicate_detection, expired_waiver_flagging, high_impact_priority_boost) with their default enabled states and parameters.
3. THE Rules_Engine SHALL persist the following attributes for each rule: `key`, `name`, `description`, `enabled` (boolean), `parameters` (JSON object), `condition` (human-readable string), `action` (human-readable string), `updated_at` (ISO 8601 timestamp).
4. WHEN a rule record is updated, THE Rules_Engine SHALL set the `updated_at` field to the current ISO 8601 timestamp.

### Requirement 2: Rules API Endpoints

**User Story:** As an admin, I want API endpoints to list and update rules, so that the UI can read and persist rule configurations.

#### Acceptance Criteria

1. WHEN a GET request is made to `/v1/rules`, THE Rules_API SHALL return all rule records as a JSON array sorted by rule identifier.
2. WHEN a PUT request is made to `/v1/rules/{ruleId}` with a valid JSON body, THE Rules_API SHALL update the specified rule record in the Settings_Table and return the updated rule.
3. WHEN a PUT request is made to `/v1/rules/{ruleId}` with an `enabled` field that is not a boolean, THE Rules_API SHALL return a 400 error with code `VALIDATION_ERROR`.
4. WHEN a PUT request is made to `/v1/rules/{ruleId}` for the `auto_approve_threshold` rule with a `parameters.threshold` value outside the range 0.0–1.0, THE Rules_API SHALL return a 400 error with code `VALIDATION_ERROR`.
5. WHEN a non-admin user makes a request to any `/v1/rules` endpoint, THE Rules_API SHALL return a 403 error with code `FORBIDDEN`.
6. WHEN a PUT request is made to `/v1/rules/{ruleId}` where `{ruleId}` does not match an existing rule, THE Rules_API SHALL return a 404 error with code `NOT_FOUND`.

### Requirement 3: Auto-Approve Threshold Rule

**User Story:** As an admin, I want to enable or disable the auto-approve behaviour and adjust the confidence threshold, so that I can control when waivers are automatically approved.

#### Acceptance Criteria

1. WHILE the `auto_approve_threshold` rule is enabled, THE Pipeline SHALL route waivers with an overall confidence score greater than or equal to the configured threshold to the auto-approve path.
2. WHILE the `auto_approve_threshold` rule is disabled, THE Pipeline SHALL route all waivers to the review queue regardless of confidence score.
3. WHEN the `auto_approve_threshold` rule parameters are updated, THE Pipeline SHALL use the new threshold value for subsequent waiver processing without requiring redeployment.
4. THE Rules_Engine SHALL default the `auto_approve_threshold` rule to enabled with a threshold parameter of 0.85.

### Requirement 4: Duplicate Detection Rule

**User Story:** As an admin, I want to enable or disable duplicate detection, so that I can control whether incoming waivers are checked against existing records.

#### Acceptance Criteria

1. WHILE the `duplicate_detection` rule is enabled, THE Storage_Handler SHALL check incoming waivers for duplicates using the airline_code and waiver_code fields and tag matches with `is_duplicate: true`.
2. WHILE the `duplicate_detection` rule is disabled, THE Storage_Handler SHALL skip duplicate checking and store all waivers with `is_duplicate: false`.
3. THE Rules_Engine SHALL default the `duplicate_detection` rule to enabled with no additional parameters.

### Requirement 5: Expired Waiver Flagging Rule

**User Story:** As an admin, I want to enable or disable expired waiver flagging, so that waivers past their expiration date are automatically marked as expired.

#### Acceptance Criteria

1. WHILE the `expired_waiver_flagging` rule is enabled, THE Rules_Engine SHALL identify waivers where the `expiration_date` is earlier than the current date and the `status` is `active`, and update their status to `expired`.
2. WHILE the `expired_waiver_flagging` rule is disabled, THE Rules_Engine SHALL not modify the status of expired waivers.
3. WHEN the `expired_waiver_flagging` rule is enabled, THE Rules_Engine SHALL evaluate expiration on a scheduled basis using an EventBridge rule triggering a Lambda function.
4. THE Rules_Engine SHALL default the `expired_waiver_flagging` rule to enabled with no additional parameters.

### Requirement 6: High-Impact Priority Boost Rule

**User Story:** As an admin, I want to enable or disable the high-impact priority boost, so that I can control whether waivers with material field changes are prioritised in the review queue.

#### Acceptance Criteria

1. WHILE the `high_impact_priority_boost` rule is enabled, THE Storage_Handler SHALL set a `priority: high` field on waivers flagged as high-impact by the detector.
2. WHILE the `high_impact_priority_boost` rule is disabled, THE Storage_Handler SHALL not modify the priority of any waiver based on high-impact detection.
3. THE Rules_Engine SHALL default the `high_impact_priority_boost` rule to enabled with no additional parameters.

### Requirement 7: Rules UI — Display and Toggle

**User Story:** As an admin, I want the Rules Engine page to display persisted rules and allow me to toggle them, so that I can manage rule states without editing code.

#### Acceptance Criteria

1. WHEN the Rules_UI page loads, THE Rules_UI SHALL fetch rule configurations from the `/v1/rules` API endpoint and display them as cards.
2. WHEN an admin toggles a rule's enabled state, THE Rules_UI SHALL send a PUT request to `/v1/rules/{ruleId}` with the updated `enabled` value and reflect the response in the UI.
3. IF the API request to toggle a rule fails, THEN THE Rules_UI SHALL display an error message and revert the toggle to its previous state.
4. WHILE a rule is disabled, THE Rules_UI SHALL render the rule card with reduced opacity to visually indicate the inactive state.
5. THE Rules_UI SHALL display a loading indicator while fetching rules from the API.

### Requirement 8: Rules UI — Parameter Editing

**User Story:** As an admin, I want to edit rule parameters (such as the confidence threshold) directly in the UI, so that I can fine-tune rule behaviour without code changes.

#### Acceptance Criteria

1. WHEN the `auto_approve_threshold` rule card is displayed, THE Rules_UI SHALL render an editable numeric input for the threshold parameter with a range of 0.0 to 1.0 and a step of 0.01.
2. WHEN an admin changes the threshold value and confirms, THE Rules_UI SHALL send a PUT request to `/v1/rules/auto_approve_threshold` with the updated parameters.
3. IF the threshold value entered is outside the range 0.0–1.0, THEN THE Rules_UI SHALL display a validation error and prevent submission.
4. WHEN a parameter update succeeds, THE Rules_UI SHALL display a success confirmation message.

### Requirement 9: Rule Evaluation at Processing Time

**User Story:** As a system operator, I want the pipeline to read rule configurations at processing time, so that rule changes take effect immediately without redeployment.

#### Acceptance Criteria

1. WHEN the Storage_Handler processes a waiver, THE Storage_Handler SHALL read the `duplicate_detection` and `high_impact_priority_boost` rule configurations from the Settings_Table.
2. WHEN the Pipeline evaluates the confidence threshold routing, THE Pipeline SHALL read the `auto_approve_threshold` rule configuration from the Settings_Table to determine the threshold value and enabled state.
3. IF a rule record is missing from the Settings_Table, THEN THE Rules_Engine SHALL fall back to the default behaviour (enabled with default parameters) for that rule.
4. THE Rules_Engine SHALL read rule configurations with a maximum latency of 100ms per rule lookup using DynamoDB GetItem operations.
