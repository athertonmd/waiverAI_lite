# Requirements Document

## Introduction

The Waiver Data Hub currently requires AWS CLI access to create and manage Cognito users. This feature adds an Admin User Management page to the UI so that administrators can create, list, and manage users and their role assignments (admin or user) directly from the application, eliminating the need for CLI-based provisioning.

## Glossary

- **Admin_User_Management_Page**: A new UI page accessible only to admins for creating and managing Cognito users.
- **User_Management_API**: The set of API endpoints under `/v1/users` that proxy Cognito admin operations.
- **Cognito_User_Pool**: The AWS Cognito User Pool (`WaiverDataHubAuth`) that stores user accounts and group memberships.
- **Role**: One of two Cognito group memberships: `admin` (full access) or `user` (read-only on allowed paths).
- **User_Record**: A representation of a Cognito user containing email, status, role, and creation date.
- **API_Handler**: The Lambda function (`lambdas/src/api/handler.ts`) that processes API Gateway requests and enforces RBAC.
- **Sidebar**: The navigation component that renders menu items conditionally based on the current user's role.

## Requirements

### Requirement 1: List Users

**User Story:** As an admin, I want to see a list of all users in the system, so that I can understand who has access and what roles they hold.

#### Acceptance Criteria

1. WHEN an admin navigates to the Admin_User_Management_Page, THE User_Management_API SHALL return a list of all User_Records from the Cognito_User_Pool.
2. THE Admin_User_Management_Page SHALL display each User_Record's email, role, account status, and creation date.
3. WHILE the user list is loading, THE Admin_User_Management_Page SHALL display a loading indicator.
4. IF the User_Management_API returns an error, THEN THE Admin_User_Management_Page SHALL display a descriptive error message.
5. WHEN a non-admin user attempts to access the User_Management_API list endpoint, THE API_Handler SHALL return a 403 Forbidden response.

### Requirement 2: Create User

**User Story:** As an admin, I want to create new users with an email and role assignment, so that I can onboard team members without using the AWS CLI.

#### Acceptance Criteria

1. WHEN an admin submits the create user form with a valid email and a selected role, THE User_Management_API SHALL create a new user in the Cognito_User_Pool with a temporary password.
2. WHEN the User_Management_API creates a user, THE Cognito_User_Pool SHALL send an invitation email to the new user's email address containing the temporary password.
3. WHEN the User_Management_API creates a user, THE User_Management_API SHALL add the new user to the Cognito group matching the selected role.
4. THE Admin_User_Management_Page SHALL validate that the email field is non-empty and matches a valid email format before submission.
5. THE Admin_User_Management_Page SHALL require the admin to select exactly one role (admin or user) before submission.
6. IF the email address already exists in the Cognito_User_Pool, THEN THE User_Management_API SHALL return a 409 Conflict response with a descriptive message.
7. WHEN a user is created successfully, THE Admin_User_Management_Page SHALL display a success message and refresh the user list.
8. IF the User_Management_API returns an error during user creation, THEN THE Admin_User_Management_Page SHALL display the error message to the admin.

### Requirement 3: Change User Role

**User Story:** As an admin, I want to change a user's role, so that I can adjust access levels as responsibilities change.

#### Acceptance Criteria

1. WHEN an admin selects a new role for an existing user, THE User_Management_API SHALL remove the user from the current Cognito group and add the user to the new Cognito group.
2. THE Admin_User_Management_Page SHALL display the current role for each user and allow the admin to select a different role.
3. WHEN a role change succeeds, THE Admin_User_Management_Page SHALL display a success message and update the displayed role.
4. IF the User_Management_API fails to change the role, THEN THE Admin_User_Management_Page SHALL display a descriptive error message.
5. THE User_Management_API SHALL prevent an admin from changing their own role to avoid accidental lockout.

### Requirement 4: Disable User

**User Story:** As an admin, I want to disable a user account, so that I can revoke access without permanently deleting the account.

#### Acceptance Criteria

1. WHEN an admin clicks the disable action for a user, THE Admin_User_Management_Page SHALL display a confirmation prompt before proceeding.
2. WHEN the admin confirms the disable action, THE User_Management_API SHALL disable the user account in the Cognito_User_Pool.
3. WHEN a user account is disabled, THE Cognito_User_Pool SHALL reject authentication attempts from that user.
4. THE Admin_User_Management_Page SHALL visually distinguish disabled users from enabled users in the user list.
5. THE User_Management_API SHALL prevent an admin from disabling their own account.

### Requirement 5: Enable User

**User Story:** As an admin, I want to re-enable a previously disabled user account, so that I can restore access when appropriate.

#### Acceptance Criteria

1. WHEN an admin clicks the enable action for a disabled user, THE User_Management_API SHALL enable the user account in the Cognito_User_Pool.
2. WHEN a user account is re-enabled, THE Admin_User_Management_Page SHALL update the user's displayed status to enabled.
3. WHEN a user account is re-enabled, THE Admin_User_Management_Page SHALL display a success message.

### Requirement 6: Delete User

**User Story:** As an admin, I want to permanently delete a user account, so that I can remove users who no longer need access.

#### Acceptance Criteria

1. WHEN an admin clicks the delete action for a user, THE Admin_User_Management_Page SHALL display a confirmation prompt warning that the action is permanent.
2. WHEN the admin confirms the delete action, THE User_Management_API SHALL permanently delete the user from the Cognito_User_Pool.
3. WHEN a user is deleted successfully, THE Admin_User_Management_Page SHALL remove the user from the displayed list and show a success message.
4. THE User_Management_API SHALL prevent an admin from deleting their own account.
5. IF the User_Management_API fails to delete the user, THEN THE Admin_User_Management_Page SHALL display a descriptive error message.

### Requirement 7: Navigation and Access Control

**User Story:** As an admin, I want to access user management from the sidebar, so that it is easy to find alongside other admin tools.

#### Acceptance Criteria

1. THE Sidebar SHALL display a "Users" navigation item visible only to admin users.
2. WHEN an admin clicks the "Users" navigation item, THE application SHALL navigate to the Admin_User_Management_Page.
3. WHEN a non-admin user accesses the Admin_User_Management_Page URL directly, THE application SHALL redirect the user away or display an access denied message.

### Requirement 8: API RBAC Enforcement

**User Story:** As a system operator, I want all user management API endpoints to enforce admin-only access, so that non-admin users cannot modify user accounts.

#### Acceptance Criteria

1. THE API_Handler SHALL restrict all `/v1/users` endpoints to requests from users with the admin role.
2. WHEN a non-admin user sends a request to any `/v1/users` endpoint, THE API_Handler SHALL return a 403 Forbidden response.
3. THE API_Handler SHALL pass the Cognito User Pool ID to the user management functions via an environment variable.
