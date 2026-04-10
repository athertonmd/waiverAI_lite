# Requirements Document

## Introduction

This feature adds two new flows to the existing custom login page: a Forgot Password flow (using Cognito's built-in ForgotPassword / ConfirmForgotPassword APIs directly from the browser) and a Registration / Request Access flow (storing requests in DynamoDB for admin approval, since Cognito self-sign-up is disabled). The admin approves or rejects requests from the existing User Management page, where user creation already works.

## Glossary

- **Login_Page**: The custom login page at `ui/src/pages/Login.tsx` that authenticates users via Cognito USER_PASSWORD_AUTH.
- **Auth_Module**: The frontend authentication module at `ui/src/auth/pkce.ts` that handles Cognito API calls.
- **Cognito_Service**: The AWS Cognito Identity Provider service used for user authentication and password management.
- **Registration_Request**: A record stored in DynamoDB representing a new user's request for access, containing name, email, and company.
- **Registration_Table**: A DynamoDB table that stores Registration_Request records with a status field (pending, approved, rejected).
- **API_Handler**: The Lambda function at `lambdas/src/api/handler.ts` that handles authenticated API requests with RBAC.
- **Public_API**: An unauthenticated API endpoint that accepts registration requests without requiring a bearer token.
- **User_Management_Page**: The existing admin page at `ui/src/pages/UserManagement.tsx` for creating and managing Cognito users.

## Requirements

### Requirement 1: Forgot Password — Initiate Reset

**User Story:** As a user who has forgotten their password, I want to request a password reset code from the login page, so that I can regain access to my account.

#### Acceptance Criteria

1. WHEN the user clicks the "Forgot password?" link on the Login_Page, THE Login_Page SHALL display a password reset form requesting the user's email address.
2. WHEN the user submits a valid email address, THE Auth_Module SHALL call the Cognito_Service ForgotPassword API with the provided email and the app client ID.
3. WHEN the Cognito_Service returns a successful response, THE Login_Page SHALL display a verification code form requesting the code, new password, and password confirmation.
4. IF the Cognito_Service returns an error during the ForgotPassword call, THEN THE Login_Page SHALL display the error message to the user.
5. WHEN the user clicks a "Back to sign in" link from the password reset form, THE Login_Page SHALL return to the sign-in form.

### Requirement 2: Forgot Password — Confirm Reset

**User Story:** As a user who has received a password reset code, I want to submit the code and a new password, so that my password is updated and I can sign in.

#### Acceptance Criteria

1. WHEN the user submits a valid verification code and matching new password, THE Auth_Module SHALL call the Cognito_Service ConfirmForgotPassword API with the email, code, new password, and app client ID.
2. WHEN the Cognito_Service confirms the password reset, THE Login_Page SHALL display a success message and return the user to the sign-in form.
3. IF the verification code is invalid or expired, THEN THE Login_Page SHALL display the error message returned by the Cognito_Service.
4. IF the new password does not meet the Cognito_Service password policy (minimum 8 characters, uppercase, digit, symbol), THEN THE Login_Page SHALL display a validation error before submitting.
5. WHEN the user clicks a "Back to sign in" link from the verification code form, THE Login_Page SHALL return to the sign-in form.

### Requirement 3: Registration — Submit Access Request

**User Story:** As a new user without an account, I want to submit a registration request from the login page, so that an administrator can review and grant me access.

#### Acceptance Criteria

1. WHEN the user clicks the "Request access" link on the Login_Page, THE Login_Page SHALL display a registration form with fields for full name, email address, and company name.
2. THE Login_Page SHALL validate that all three fields (name, email, company) are non-empty and that the email field contains a valid email format before allowing submission.
3. WHEN the user submits a valid registration form, THE Login_Page SHALL send a POST request to the Public_API registration endpoint without requiring authentication.
4. WHEN the Public_API receives a valid registration request, THE Public_API SHALL store a Registration_Request in the Registration_Table with a unique ID, the submitted fields, status "pending", and a created-at timestamp.
5. IF a Registration_Request with the same email already exists in "pending" status, THEN THE Public_API SHALL return an error indicating a request is already pending for that email.
6. WHEN the registration request is stored successfully, THE Login_Page SHALL display a confirmation message informing the user that their request has been submitted and is awaiting admin approval.
7. IF the Public_API returns an error, THEN THE Login_Page SHALL display the error message to the user.
8. WHEN the user clicks a "Back to sign in" link from the registration form, THE Login_Page SHALL return to the sign-in form.

### Requirement 4: Registration — Admin Review

**User Story:** As an administrator, I want to see pending registration requests on the User Management page, so that I can approve or reject access requests.

#### Acceptance Criteria

1. WHEN an admin navigates to the User_Management_Page, THE User_Management_Page SHALL fetch and display all Registration_Request records from the API_Handler.
2. THE User_Management_Page SHALL display each pending Registration_Request showing the requester's name, email, company, and submission date.
3. WHEN an admin clicks "Approve" on a pending Registration_Request, THE API_Handler SHALL create a new Cognito user via the existing user creation flow (AdminCreateUser) using the email from the request, update the Registration_Request status to "approved", and remove the request from the pending list.
4. WHEN an admin clicks "Reject" on a pending Registration_Request, THE API_Handler SHALL update the Registration_Request status to "rejected" and remove the request from the pending list.
5. THE API_Handler SHALL restrict access to registration request management endpoints to users with the "admin" role.

### Requirement 5: Registration — DynamoDB Storage

**User Story:** As a system operator, I want registration requests stored in DynamoDB, so that they persist reliably and can be queried by status.

#### Acceptance Criteria

1. THE Registration_Table SHALL use a partition key of "id" (string) to uniquely identify each Registration_Request.
2. THE Registration_Table SHALL include a Global Secondary Index on the "status" field to allow efficient queries for pending requests.
3. THE Registration_Table SHALL store the following attributes for each record: id, name, email, company, status, and createdAt.

### Requirement 6: Login Page Navigation

**User Story:** As a user on the login page, I want clear navigation links to the forgot password and registration flows, so that I can easily find these options.

#### Acceptance Criteria

1. THE Login_Page SHALL display a "Forgot password?" link below the password field on the sign-in form.
2. THE Login_Page SHALL display a "Request access" link below the sign-in button.
3. THE Login_Page SHALL maintain the existing visual style (dark translucent panel, white text, green accent button) for all new forms and links.
