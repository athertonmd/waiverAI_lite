# Implementation Plan: Login Flows

## Overview

Add Forgot Password and Registration/Request Access flows to the existing Login page. Forgot Password is entirely client-side (Cognito APIs). Registration stores requests in the Settings table with `REG#` prefix keys and uses a Scan with filter (no GSI needed). Admins approve/reject from the User Management page.

## Tasks

- [x] 1. Add Forgot Password functions to Auth Module
  - [x] 1.1 Add `forgotPassword` and `confirmForgotPassword` functions to `ui/src/auth/pkce.ts`
    - `forgotPassword(email)` calls Cognito `ForgotPassword` API using existing `COGNITO_REGION` and `CLIENT_ID`
    - `confirmForgotPassword(email, code, newPassword)` calls Cognito `ConfirmForgotPassword` API
    - Both return `{ success: boolean; error?: string }`
    - Use the same fetch pattern as existing `signInWithPassword`
    - _Requirements: 1.2, 2.1_

  - [x] 1.2 Add `validatePassword` helper to `ui/src/auth/pkce.ts`
    - Validate: min 8 chars, at least 1 uppercase, 1 digit, 1 symbol
    - Return `{ valid: boolean; message?: string }` with specific failure reason
    - _Requirements: 2.4_

  - [ ]* 1.3 Write property test for password validation (Property 1)
    - **Property 1: Password policy validation**
    - **Validates: Requirements 2.4**
    - Use `fast-check` to generate random strings and verify the validator agrees with a reference implementation

  - [ ]* 1.4 Write unit tests for `forgotPassword` and `confirmForgotPassword`
    - Test success and error responses from Cognito
    - Test `validatePassword` with specific edge cases (empty, 7-char, no uppercase, no digit, no symbol, valid)
    - _Requirements: 1.2, 1.4, 2.1, 2.3, 2.4_

- [x] 2. Add Forgot Password and Registration views to Login Page
  - [x] 2.1 Refactor `ui/src/pages/Login.tsx` to use a view state machine
    - Add `view` state: `'signIn' | 'forgotPassword' | 'confirmReset' | 'register' | 'registerSuccess'`
    - Keep existing sign-in and new-password forms as `'signIn'` view
    - Add "Forgot password?" link below password field, "Request access" link below sign-in button
    - Maintain existing dark panel styling for all new elements
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 2.2 Implement Forgot Password view in Login component
    - `'forgotPassword'` view: email input + submit button, calls `forgotPassword()` from auth module
    - On success, transition to `'confirmReset'` view storing the email
    - On error, display error message
    - "Back to sign in" link returns to `'signIn'`
    - _Requirements: 1.1, 1.2, 1.4, 1.5_

  - [x] 2.3 Implement Confirm Reset view in Login component
    - `'confirmReset'` view: verification code + new password + confirm password fields
    - Client-side password validation using `validatePassword` before submission
    - Calls `confirmForgotPassword()` from auth module
    - On success, show success message and return to `'signIn'`
    - On error, display error message
    - "Back to sign in" link returns to `'signIn'`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 2.4 Implement Registration form view in Login component
    - `'register'` view: full name, email, company fields + submit button
    - Validate all fields non-empty and email format before submission
    - POST to `/v1/register` (no auth header) using `fetch` directly
    - On success, transition to `'registerSuccess'` view with confirmation message
    - On error (409 duplicate, 400 validation, network), display error message
    - "Back to sign in" link returns to `'signIn'`
    - _Requirements: 3.1, 3.2, 3.3, 3.6, 3.7, 3.8_

  - [ ]* 2.5 Write property test for registration form validation (Property 2)
    - **Property 2: Registration form validation**
    - **Validates: Requirements 3.2**
    - Use `fast-check` to generate random (name, email, company) tuples

- [x] 3. Checkpoint — Verify frontend flows
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement Registration backend endpoint
  - [x] 4.1 Add `POST /v1/register` handler to `lambdas/src/public-api/handler.ts`
    - Parse and validate request body (name, email, company — all required, email format check)
    - Generate UUID for the request ID
    - Scan Settings table for existing `REG#` items with same email and `pending` status
    - If duplicate pending exists, return 409 with `DUPLICATE_REQUEST` error
    - Store item in Settings table: `key: REG#<uuid>`, `id`, `name`, `email`, `company`, `status: "pending"`, `createdAt`
    - Return 201 with `{ data: { id, status: "pending" } }`
    - Allow POST methods in CORS headers
    - _Requirements: 3.3, 3.4, 3.5, 5.1, 5.3_

  - [ ]* 4.2 Write property test for registration storage round-trip (Property 3)
    - **Property 3: Registration storage round-trip**
    - **Validates: Requirements 3.4, 5.3**
    - Mock DynamoDB, generate random valid inputs, verify stored record matches

  - [ ]* 4.3 Write property test for duplicate pending email rejection (Property 4)
    - **Property 4: Duplicate pending email rejection**
    - **Validates: Requirements 3.5**
    - Mock DynamoDB, insert pending request, attempt second with same email, assert 409

  - [ ]* 4.4 Write unit tests for registration endpoint
    - Test 201 success, 409 duplicate, 400 missing fields, 400 invalid email
    - _Requirements: 3.4, 3.5_

- [x] 5. Add registration API route to API Gateway
  - [x] 5.1 Add `POST /v1/register` route in `infra/lib/api-stack.ts`
    - Add route under `v1` resource with `authorizationType: NONE` (no Cognito authorizer)
    - Use the existing `publicApiFn` Lambda and `publicApiGatewayRole` integration
    - Grant the public API Lambda `PutItem` and `Scan` permissions on the Settings table
    - Pass `SETTINGS_TABLE` env var to public API Lambda (already present)
    - _Requirements: 3.3_

- [x] 6. Implement admin registration management endpoints
  - [x] 6.1 Add registration request routes to `lambdas/src/api/handler.ts`
    - `GET /v1/registration-requests` — Scan Settings table for items with `key` starting with `REG#`, filter by `status = "pending"`
    - `POST /v1/registration-requests/{id}/approve` — Get item by `key: REG#<id>`, verify status is `pending`, call `AdminCreateUser` with the email (role: `user`), update status to `approved`
    - `POST /v1/registration-requests/{id}/reject` — Get item by `key: REG#<id>`, verify status is `pending`, update status to `rejected`
    - All three endpoints require admin role (existing RBAC pattern)
    - Return 400 if request is not in pending status
    - _Requirements: 4.1, 4.3, 4.4, 4.5_

  - [ ]* 6.2 Write property test for resolution status updates (Property 5)
    - **Property 5: Registration request resolution updates status**
    - **Validates: Requirements 4.3, 4.4**

  - [ ]* 6.3 Write property test for RBAC on registration endpoints (Property 6)
    - **Property 6: RBAC on registration management endpoints**
    - **Validates: Requirements 4.5**

  - [ ]* 6.4 Write unit tests for admin registration endpoints
    - Test list pending, approve (creates Cognito user + updates status), reject (updates status only)
    - Test 400 on non-pending request, 403 for non-admin
    - _Requirements: 4.1, 4.3, 4.4, 4.5_

- [x] 7. Add registration management API routes to API Gateway
  - [x] 7.1 Add registration request routes in `infra/lib/api-stack.ts`
    - `GET /v1/registration-requests` with Cognito auth
    - `POST /v1/registration-requests/{id}/approve` with Cognito auth
    - `POST /v1/registration-requests/{id}/reject` with Cognito auth
    - All use the existing `apiIntegration` and `authOpts` pattern
    - _Requirements: 4.5_

- [x] 8. Checkpoint — Verify backend endpoints
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Add Pending Requests section to User Management page
  - [x] 9.1 Add pending registration requests UI to `ui/src/pages/UserManagement.tsx`
    - Add a "Pending Access Requests" card above the existing users table
    - Fetch `GET /v1/registration-requests` using `useQuery`
    - Display each request: name, email, company, submission date
    - "Approve" button → `POST /v1/registration-requests/{id}/approve` via `useMutation`, invalidates both `registration-requests` and `users` queries
    - "Reject" button with confirmation → `POST /v1/registration-requests/{id}/reject` via `useMutation`
    - Show success/error banners using existing banner pattern
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ]* 9.2 Write unit tests for pending requests UI
    - Test rendering of pending requests list
    - Test approve and reject button interactions
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 10. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Forgot password is entirely client-side — no backend Lambda needed
- Registration uses the Settings table with `REG#` prefix keys to avoid DatabaseStack changes
- Uses Scan with filter on `REG#` prefix instead of GSI to avoid DatabaseStack drift issues
- Deploy with `--exclusively` flag to avoid Database stack drift
- The public API Lambda already has Settings table access via env var
