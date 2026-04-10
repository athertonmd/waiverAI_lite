# Requirements Document

## Introduction

Re-enable Cognito-based authentication and implement a two-role authorization model for the Waiver Data Hub application. The system currently bypasses all authentication via `DISABLE_AUTH=true`. This feature removes that bypass, enforces Cognito login for all users, and restricts functionality based on two Cognito groups: **admin** (full access) and **user** (read-only access to a subset of pages).

## Glossary

- **Auth_System**: The combined Cognito User Pool, API Gateway authorizer, Lambda RBAC middleware, and UI route/component guards that together enforce authentication and authorization.
- **Admin**: A Cognito user assigned to the "admin" group with full read-write access to all application features.
- **User**: A Cognito user assigned to the "user" group with read-only access to a limited set of pages (Dashboard, Waivers, Reports).
- **RBAC_Middleware**: The `extractRole` and `isAuthorized` functions in the API Lambda handler that read `cognito:groups` from the JWT and enforce HTTP method restrictions per role.
- **Sidebar**: The left navigation component that displays links to application pages.
- **ProtectedRoute**: The React component that gates the entire application behind Cognito authentication.
- **PKCE_Flow**: The RFC 7636 authorization code flow with Proof Key for Code Exchange used by the SPA to authenticate against the Cognito Hosted UI.
- **Token_Manager**: The client-side module (`pkce.ts`) responsible for storing, retrieving, refreshing, and clearing JWT tokens in session storage.
- **API_Client**: The HTTP client module (`client.ts`) that attaches the Bearer token to all outgoing API requests.
- **Admin_Pages**: Dashboard, Waivers, Review Queue, Ingest, Rules Engine, Reports, Settings, Monitoring.
- **User_Pages**: Dashboard, Waivers (list and detail view only), Reports.
- **Write_Actions**: Approve, Reject, Save Draft, edit waiver fields, manage API keys, manage notification recipients, manage extraction fields, change confidence threshold.

## Requirements

### Requirement 1: Remove Authentication Bypass

**User Story:** As a system operator, I want the authentication bypass removed, so that all API and UI access requires a valid Cognito session.

#### Acceptance Criteria

1. WHEN the Auth_System is deployed, THE Auth_System SHALL require a valid Cognito JWT on every API Gateway request.
2. WHEN the Auth_System is deployed, THE Auth_System SHALL remove the `disableAuth` CDK context flag and the `DISABLE_AUTH` Lambda environment variable.
3. WHEN the Auth_System is deployed, THE API_Client SHALL remove the `VITE_DISABLE_AUTH` environment variable check and send the Authorization header on every request.
4. WHEN the Auth_System is deployed, THE ProtectedRoute SHALL remove the `VITE_DISABLE_AUTH` bypass and require a valid token for all routes.

### Requirement 2: Cognito Group Configuration

**User Story:** As a system operator, I want exactly two Cognito groups ("admin" and "user"), so that role assignment is simple and matches the two-role model.

#### Acceptance Criteria

1. WHEN the Auth_System is deployed, THE Auth_System SHALL create a Cognito group named "admin" with the description "Full access to all resources".
2. WHEN the Auth_System is deployed, THE Auth_System SHALL create a Cognito group named "user" with the description "Read-only access to Dashboard, Waivers, and Reports".
3. WHEN the Auth_System is deployed, THE Auth_System SHALL remove the legacy "reviewer" and "api_consumer" Cognito groups from the AuthStack.

### Requirement 3: API Role-Based Access Control

**User Story:** As a developer, I want the API handler to enforce role-based access based on the "admin" and "user" Cognito groups, so that Users cannot perform write operations or access restricted endpoints.

#### Acceptance Criteria

1. WHEN a request is received with a JWT containing the "admin" group, THE RBAC_Middleware SHALL permit GET, POST, PUT, and DELETE methods on all API endpoints.
2. WHEN a request is received with a JWT containing the "user" group, THE RBAC_Middleware SHALL permit only GET methods on the `/v1/waivers`, `/v1/waivers/:id`, `/v1/waivers/:id/source`, `/v1/waivers/:id/versions`, `/v1/dashboard`, and `/v1/reports` endpoints.
3. WHEN a request is received with a JWT containing the "user" group, THE RBAC_Middleware SHALL reject POST, PUT, and DELETE methods with HTTP status 403 and an error message "Forbidden: insufficient permissions".
4. WHEN a request is received with a JWT containing the "user" group, THE RBAC_Middleware SHALL reject GET requests to `/v1/settings`, `/v1/review`, `/v1/ingest`, `/v1/monitoring`, and `/v1/rules` endpoints with HTTP status 403.
5. IF a request is received with a JWT that contains no recognized group, THEN THE RBAC_Middleware SHALL return HTTP status 403 with an error message "Forbidden: no valid role assigned".
6. IF a request is received without a valid JWT, THEN THE Auth_System SHALL return HTTP status 401 before the request reaches the Lambda handler.

### Requirement 4: UI Navigation Filtering by Role

**User Story:** As a User, I want to see only the pages I have access to in the sidebar, so that I am not confused by links to pages I cannot use.

#### Acceptance Criteria

1. WHEN an Admin is logged in, THE Sidebar SHALL display navigation links for all Admin_Pages: Dashboard, Waivers, Review Queue, Ingest, Rules Engine, Reports, Settings, and Monitoring.
2. WHEN a User is logged in, THE Sidebar SHALL display navigation links only for User_Pages: Dashboard, Waivers, and Reports.
3. WHEN a User is logged in, THE Sidebar SHALL hide navigation links for Review Queue, Ingest, Rules Engine, Settings, and Monitoring.

### Requirement 5: UI Action Button Restrictions by Role

**User Story:** As a User, I want write-action buttons hidden from my view, so that I understand I have read-only access without encountering disabled or error-producing controls.

#### Acceptance Criteria

1. WHEN a User views the Waiver Detail page, THE Auth_System SHALL hide the "Approve", "Reject", and "Save Draft" buttons.
2. WHEN a User views the Waiver Detail page, THE Auth_System SHALL render all form fields as read-only (non-editable).
3. WHEN an Admin views the Waiver Detail page, THE Auth_System SHALL display the "Approve", "Reject", and "Save Draft" buttons and render form fields as editable.
4. WHEN a User views the Dashboard page, THE Auth_System SHALL display dashboard data in read-only mode without any edit controls.

### Requirement 6: UI Route Guards by Role

**User Story:** As a system operator, I want the UI to prevent Users from navigating to admin-only pages via direct URL, so that authorization is enforced on the client side as well as the server side.

#### Acceptance Criteria

1. WHEN a User navigates to `/review`, `/ingest`, `/rules`, `/settings`, or `/monitoring` via direct URL, THE ProtectedRoute SHALL redirect the User to the Dashboard page.
2. WHEN an Admin navigates to any application route via direct URL, THE ProtectedRoute SHALL allow access to the requested page.

### Requirement 7: Login Flow via Cognito Hosted UI

**User Story:** As a user, I want to be redirected to the Cognito Hosted UI login page when I am not authenticated, so that I can sign in securely.

#### Acceptance Criteria

1. WHEN an unauthenticated user accesses any application route, THE ProtectedRoute SHALL redirect the user to the Cognito Hosted UI using the PKCE_Flow.
2. WHEN the Cognito Hosted UI returns an authorization code, THE Token_Manager SHALL exchange the code for access, ID, and refresh tokens using the PKCE code verifier.
3. WHEN the token exchange succeeds, THE Token_Manager SHALL store the tokens in session storage and redirect the user to the originally requested page.
4. IF the token exchange fails, THEN THE Token_Manager SHALL clear all stored tokens and redirect the user back to the Cognito Hosted UI login page.

### Requirement 8: Token Refresh and Session Management

**User Story:** As a user, I want my session to remain active without re-authenticating frequently, so that I can work without interruption during a normal work session.

#### Acceptance Criteria

1. WHEN the access token is within 5 minutes of expiration, THE Token_Manager SHALL use the refresh token to obtain a new access token from the Cognito token endpoint.
2. WHEN the token refresh succeeds, THE Token_Manager SHALL update the stored access token and expiration timestamp in session storage.
3. IF the refresh token is expired or invalid, THEN THE Token_Manager SHALL clear all stored tokens and redirect the user to the Cognito Hosted UI login page.
4. WHEN the user clicks "Sign Out", THE Token_Manager SHALL clear all stored tokens and redirect the user to the Cognito logout endpoint.

### Requirement 9: Initial Admin User Provisioning

**User Story:** As a system operator deploying the application for the first time, I want a documented method to create the initial admin user, so that I can bootstrap access to the system.

#### Acceptance Criteria

1. THE Auth_System SHALL output the Cognito User Pool ID and User Pool Client ID as CDK stack outputs.
2. THE Auth_System SHALL include documented AWS CLI commands in a deployment guide to: create a user, set a permanent password, and add the user to the "admin" group.
3. WHEN a new user is created via the AWS CLI and added to the "admin" group, THE Auth_System SHALL allow that user to log in and access all Admin_Pages.

### Requirement 10: Role Propagation to UI

**User Story:** As a developer, I want the UI to know the current user's role from the JWT, so that navigation and action visibility can be determined client-side without extra API calls.

#### Acceptance Criteria

1. WHEN a user is authenticated, THE Token_Manager SHALL decode the `cognito:groups` claim from the ID token and expose the user's role ("admin" or "user") to the application.
2. WHEN the ID token contains both "admin" and "user" groups, THE Token_Manager SHALL resolve the effective role as "admin" (highest privilege wins).
3. IF the ID token contains no recognized group, THEN THE Auth_System SHALL treat the user as having no access and redirect to an "Access Denied" informational page.
