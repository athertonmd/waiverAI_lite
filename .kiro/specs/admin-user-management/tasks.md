# Implementation Plan: Admin User Management

## Overview

Add user management capabilities to the Waiver Data Hub so admins can create, list, disable, enable, delete, and change roles for Cognito users from the UI. Implementation spans infrastructure (CDK), backend (API Lambda), and frontend (React page + routing).

## Tasks

- [x] 1. Infrastructure: Pass User Pool ID and grant Cognito permissions to API Lambda
  - [x] 1.1 Update `infra/bin/app.ts` to pass `userPoolId` and `userPoolArn` to `ApiStack`
    - Add `userPoolId: string` and `userPoolArn: string` to `ApiStackProps`
    - Pass `auth.userPool.userPoolId` and `auth.userPool.userPoolArn` from `app.ts`
    - _Requirements: 8.3_

  - [x] 1.2 Update `infra/lib/api-stack.ts` to add `USER_POOL_ID` env var and Cognito IAM policy
    - Add `USER_POOL_ID` environment variable to the `apiFn` Lambda
    - Add IAM policy statement granting `cognito-idp:AdminCreateUser`, `AdminSetUserPassword`, `AdminAddUserToGroup`, `AdminRemoveUserFromGroup`, `AdminDisableUser`, `AdminEnableUser`, `AdminDeleteUser`, `ListUsers`, `AdminListGroupsForUser` on the User Pool ARN
    - _Requirements: 8.3_

  - [x] 1.3 Add API Gateway routes for `/v1/users` endpoints in `infra/lib/api-stack.ts`
    - Add resources: `/v1/users`, `/v1/users/{username}`, `/v1/users/{username}/role`, `/v1/users/{username}/disable`, `/v1/users/{username}/enable`
    - Wire GET, POST, PUT, DELETE methods using the existing `addRoute` helper and `apiIntegration`
    - _Requirements: 1.1, 2.1, 3.1, 4.2, 5.1, 6.2_

- [x] 2. Checkpoint - Verify infrastructure changes synthesize
  - Ensure CDK synth succeeds with the new props and routes, ask the user if questions arise.

- [x] 3. Backend: Implement user management route handlers in API Lambda
  - [x] 3.1 Add Cognito SDK imports and `USER_POOL_ID` constant in `lambdas/src/api/handler.ts`
    - Import `CognitoIdentityProviderClient`, `ListUsersCommand`, `AdminCreateUserCommand`, `AdminSetUserPasswordCommand`, `AdminAddUserToGroupCommand`, `AdminRemoveUserFromGroupCommand`, `AdminDisableUserCommand`, `AdminEnableUserCommand`, `AdminDeleteUserCommand`, `AdminListGroupsForUserCommand`
    - Instantiate `cognitoClient` and read `USER_POOL_ID` from env
    - _Requirements: 8.3_

  - [x] 3.2 Implement `listUsers` handler function
    - Call `ListUsers` and `AdminListGroupsForUser` to build `UserRecord[]` response
    - Map Cognito attributes (email, status, enabled, createdAt) to the response shape
    - _Requirements: 1.1_

  - [x] 3.3 Implement `createUser` handler function
    - Validate request body (email format, role in `{admin, user}`)
    - Call `AdminCreateUser` with `DesiredDeliveryMediums: ['EMAIL']` so Cognito sends the invitation
    - Call `AdminAddUserToGroup` with the selected role
    - Return 409 if `UsernameExistsException`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 3.4 Implement `changeUserRole` handler function
    - Accept `username` path param and `{ role }` body
    - Prevent self-action by comparing target username with caller email
    - Call `AdminListGroupsForUser` to find current group, `AdminRemoveUserFromGroup`, then `AdminAddUserToGroup`
    - _Requirements: 3.1, 3.5_

  - [x] 3.5 Implement `disableUser` and `enableUser` handler functions
    - `disableUser`: prevent self-action, call `AdminDisableUser`
    - `enableUser`: call `AdminEnableUser`
    - _Requirements: 4.2, 4.5, 5.1_

  - [x] 3.6 Implement `deleteUser` handler function
    - Prevent self-action, call `AdminDeleteUser`
    - Return 404 if `UserNotFoundException`
    - _Requirements: 6.2, 6.4_

  - [x] 3.7 Wire `/v1/users` routes into the main `handler` function's routing logic
    - Add route matching for GET `/v1/users`, POST `/v1/users`, PUT `/v1/users/{username}/role`, POST `/v1/users/{username}/disable`, POST `/v1/users/{username}/enable`, DELETE `/v1/users/{username}`
    - Enforce admin-only RBAC check before dispatching to handler functions
    - _Requirements: 8.1, 8.2_

  - [ ]* 3.8 Write unit tests for user management handlers in `lambdas/src/api/__tests__/handler.test.ts`
    - Mock Cognito SDK calls
    - Test RBAC enforcement (403 for non-admin)
    - Test self-action prevention (400 for self-targeted role change, disable, delete)
    - Test validation errors (invalid email, missing role)
    - Test duplicate email (409)
    - Test user not found (404)
    - _Requirements: 1.5, 2.4, 2.6, 3.5, 4.5, 6.4, 8.1, 8.2_

  - [ ]* 3.9 Write property test: RBAC enforcement on /v1/users endpoints
    - **Property 1: RBAC enforcement on /v1/users endpoints**
    - **Validates: Requirements 1.5, 8.1, 8.2**

  - [ ]* 3.10 Write property test: User record mapping preserves all Cognito attributes
    - **Property 2: User record mapping preserves all Cognito attributes**
    - **Validates: Requirements 1.1**

  - [ ]* 3.11 Write property test: Email validation rejects invalid formats
    - **Property 3: Email validation rejects invalid formats**
    - **Validates: Requirements 2.4**

  - [ ]* 3.12 Write property test: Create user assigns the selected Cognito group
    - **Property 4: Create user assigns the selected Cognito group**
    - **Validates: Requirements 2.3**

  - [ ]* 3.13 Write property test: Role change removes old group and adds new group
    - **Property 5: Role change removes old group and adds new group**
    - **Validates: Requirements 3.1**

  - [ ]* 3.14 Write property test: Self-action prevention
    - **Property 6: Self-action prevention**
    - **Validates: Requirements 3.5, 4.5, 6.4**

- [x] 4. Checkpoint - Verify backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Frontend: Add UserManagement page and routing
  - [x] 5.1 Create `ui/src/pages/UserManagement.tsx`
    - Implement user table displaying email, role, status (enabled/disabled), and creation date
    - Add "Create User" form with email input and role select dropdown
    - Add per-row action buttons: change role dropdown, disable/enable toggle, delete button
    - Add confirmation dialogs for disable and delete actions
    - Use `react-query` (`useQuery` for list, `useMutation` for create/update/delete) with cache invalidation
    - Use existing `apiGet`, `apiPost`, `apiPut`, `apiDelete` from `ui/src/api/client.ts`
    - Show loading indicator while fetching, error messages on failure, success toasts on mutations
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.4, 2.5, 2.7, 2.8, 3.2, 3.3, 3.4, 4.1, 4.4, 5.2, 5.3, 6.1, 6.3, 6.5_

  - [x] 5.2 Add route and sidebar entry for UserManagement page
    - Add `<Route path="users" element={<UserManagement />} />` in `ui/src/App.tsx`
    - Add `{ to: '/users', label: 'Users', icon: '👥', requiredRole: 'admin' }` to `navItems` in `ui/src/components/Sidebar.tsx`
    - Add `'/users'` to `ADMIN_ONLY_ROUTES` in `ui/src/components/ProtectedRoute.tsx`
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties from the design document
- The API Lambda handler file (`lambdas/src/api/handler.ts`) is large — all new route handlers and functions go there following existing patterns
- Deploy with `npx cdk deploy WaiverDataHubApi --exclusively -c recipientDomain=waiverhub.info --require-approval never` (use `--exclusively` due to database stack drift)
