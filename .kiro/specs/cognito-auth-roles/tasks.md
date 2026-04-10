# Implementation Plan: Cognito Auth Roles

## Overview

Implement a two-role (admin/user) authorization model by removing the authentication bypass, reconfiguring Cognito groups, and enforcing RBAC at the API, UI, and infrastructure layers. Tasks are ordered so backend RBAC changes come first (testable with auth still disabled), then UI role context and guards, then CDK infrastructure changes last (the "flip the switch" step) to minimize risk of locking users out.

## Tasks

- [x] 1. Refactor Lambda RBAC middleware to two-role model
  - [x] 1.1 Replace three-role model with admin/user in `lambdas/src/api/handler.ts`
    - Change `type Role` from `'api_consumer' | 'reviewer' | 'admin'` to `'admin' | 'user'`
    - Remove `ROLE_PERMISSIONS` map and `AUTH_DISABLED` bypass
    - Add `USER_ALLOWED_PATHS` prefix array (`/v1/waivers`, `/v1/dashboard`, `/v1/reports`) and `USER_ALLOWED_EXACT` array (`/v1/settings/extraction-fields`)
    - Add `isUserAllowedPath(path)` helper
    - Update `extractRole()` to return `'admin'` if groups include "admin", `'user'` if groups include "user", `null` otherwise (no bypass)
    - Update `isAuthorized()`: admin → all methods/paths allowed; user → GET only on allowed paths; else → false
    - Return 403 with `"Forbidden: no valid role assigned"` when role is null
    - Return 403 with `"Forbidden: insufficient permissions"` when role lacks access
    - _Requirements: 1.2, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 1.2 Update existing unit tests in `lambdas/src/api/__tests__/handler.test.ts`
    - Update tests for `extractRole` to cover: admin-only groups, user-only groups, both groups (admin wins), empty groups, unrecognized groups, mixed case
    - Update tests for `isAuthorized` to cover: admin all methods/paths, user GET on allowed paths, user GET on disallowed paths, user POST/PUT/DELETE rejected, null role rejected
    - Remove any tests referencing `AUTH_DISABLED`, `reviewer`, or `api_consumer` roles
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 1.3 Write property test for RBAC authorization correctness
    - **Property 1: RBAC authorization correctness**
    - Generate random roles (`'admin'`, `'user'`, `null`), random HTTP methods (`GET`, `POST`, `PUT`, `DELETE`), and random paths (mix of allowed and disallowed)
    - Assert `isAuthorized(role, method, path)` returns `true` iff role is admin OR (role is user AND method is GET AND path is in allowed set)
    - Use `fast-check` with minimum 100 iterations
    - Tag: `Feature: cognito-auth-roles, Property 1: RBAC authorization correctness`
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

  - [ ]* 1.4 Write property test for role resolution from groups
    - **Property 2: Role resolution from groups**
    - Generate random arrays of strings including "admin", "user", random strings, varying lengths and orderings
    - Assert `extractRole` returns `'admin'` if array contains "admin", `'user'` if array contains "user" but not "admin", `null` otherwise
    - Use `fast-check` with minimum 100 iterations
    - Tag: `Feature: cognito-auth-roles, Property 2: Role resolution from groups`
    - **Validates: Requirements 10.1, 10.2**

- [x] 2. Checkpoint - Verify backend RBAC
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Create UI role resolution and context
  - [x] 3.1 Create `ui/src/auth/role.ts` with `resolveRole` function
    - Export `type AppRole = 'admin' | 'user' | null`
    - Export `resolveRole(groups: string[] | undefined): AppRole` — admin wins over user, null if neither
    - _Requirements: 10.1, 10.2_

  - [x] 3.2 Create `ui/src/auth/RoleContext.tsx` React context provider
    - Create `RoleContext` with `{ role: AppRole; isAdmin: boolean }`
    - Create `RoleProvider` component that reads `getUserInfo().groups`, calls `resolveRole`, and provides the value
    - Export `useRole()` hook
    - _Requirements: 10.1, 10.2, 10.3_

  - [ ]* 3.3 Write property test for UI role resolution
    - **Property 2: Role resolution from groups (UI side)**
    - Generate random arrays of group strings and verify `resolveRole` matches the spec: admin wins, then user, then null
    - Use `fast-check` with minimum 100 iterations
    - Tag: `Feature: cognito-auth-roles, Property 2: Role resolution from groups`
    - **Validates: Requirements 10.1, 10.2**

- [x] 4. Add token refresh to PKCE module
  - [x] 4.1 Add `refreshAccessToken()` and `ensureFreshToken()` to `ui/src/auth/pkce.ts`
    - `refreshAccessToken()`: POST to Cognito `/oauth2/token` with `grant_type=refresh_token`
    - `ensureFreshToken()`: check if access token expires within 5 minutes, call refresh if needed
    - On refresh failure, clear tokens and redirect to login
    - Update `getAccessToken()` to call `ensureFreshToken()` before returning the token
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ]* 4.2 Write property test for token refresh timing
    - **Property 4: Token refresh triggers near expiry**
    - Generate random `expires_at` timestamps relative to `Date.now()` covering near-expiry, fresh, and expired ranges
    - Assert refresh is triggered iff token expires within 5 minutes and refresh token exists
    - Use `fast-check` with minimum 100 iterations
    - Tag: `Feature: cognito-auth-roles, Property 4: Token refresh triggers near expiry`
    - **Validates: Requirements 8.1**

- [x] 5. Update UI components for role-based access
  - [x] 5.1 Update `ui/src/components/Sidebar.tsx` to filter nav items by role
    - Import `useRole` from RoleContext
    - Add `requiredRole?: 'admin'` field to nav items for Review Queue, Ingest, Rules Engine, Settings, Monitoring
    - Filter nav items: admin sees all 8 items, user sees Dashboard, Waivers, Reports only
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 5.2 Update `ui/src/components/ProtectedRoute.tsx` with role guards
    - Remove `VITE_DISABLE_AUTH` bypass entirely
    - Wrap children with `RoleProvider`
    - Add role-based route guarding: if user role navigates to `/review`, `/ingest`, `/rules`, `/settings`, or `/monitoring`, redirect to `/`
    - If role is `null` (no recognized group), show an "Access Denied" informational page
    - _Requirements: 1.4, 6.1, 6.2, 10.3_

  - [x] 5.3 Update `ui/src/pages/WaiverDetail.tsx` to hide write actions for user role
    - Import `useRole` from RoleContext
    - If role is `'user'`: hide Approve, Reject, Save Draft buttons; set form fields to `readOnly`/`disabled`
    - If role is `'admin'`: keep current editable behavior
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 5.4 Update `ui/src/api/client.ts` to remove auth bypass
    - Remove `AUTH_DISABLED` / `VITE_DISABLE_AUTH` check
    - Always call `getAccessToken()` and attach `Authorization: Bearer <token>` header when token exists
    - _Requirements: 1.3_

  - [x] 5.5 Update `ui/src/components/TopNav.tsx` to remove auth bypass
    - Remove `AUTH_DISABLED` constant and conditional logic
    - Always read username from `getUserInfo()`
    - Always call `logout()` on sign out (remove dev-mode alert)
    - _Requirements: 1.4_

  - [ ]* 5.6 Write property test for UI route guard correctness
    - **Property 3: UI route guard correctness**
    - Generate random roles and random route paths from the full set of application routes
    - Assert access is allowed iff role is admin OR (role is user AND route is in user-allowed set)
    - Use `fast-check` with minimum 100 iterations
    - Tag: `Feature: cognito-auth-roles, Property 3: UI route guard correctness`
    - **Validates: Requirements 6.1, 6.2**

  - [ ]* 5.7 Write property test for API client auth header
    - **Property 5: API client always sends auth header**
    - Generate random token strings and verify the Authorization header is always attached when a token exists
    - Use `fast-check` with minimum 100 iterations
    - Tag: `Feature: cognito-auth-roles, Property 5: API client always sends auth header`
    - **Validates: Requirements 1.3**

- [x] 6. Checkpoint - Verify UI role-based access
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Wire RoleProvider into App component
  - [x] 7.1 Update `ui/src/App.tsx` to include `RoleProvider`
    - Wrap the `Routes` component (inside `ProtectedRoute`) with `RoleProvider` so all child components can access `useRole()`
    - _Requirements: 10.1_

- [x] 8. Update CDK infrastructure to remove auth bypass (flip the switch)
  - [x] 8.1 Update `infra/lib/auth-stack.ts` Cognito groups
    - Remove `CfnUserPoolGroup` for "reviewer" and "api_consumer"
    - Add `CfnUserPoolGroup` for "user" with description "Read-only access to Dashboard, Waivers, and Reports"
    - Keep "admin" group as-is
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 8.2 Update `infra/lib/api-stack.ts` to always require Cognito authorizer
    - Remove `disableAuth` prop from `ApiStackProps`
    - Make `userPool` prop required (not optional)
    - Remove conditional logic around authorizer creation — always create `CognitoUserPoolsAuthorizer` and apply to all methods
    - Remove `DISABLE_AUTH` from Lambda environment variables
    - _Requirements: 1.1, 1.2_

  - [x] 8.3 Update `infra/bin/app.ts` to remove disableAuth context
    - Remove `disableAuth` context variable lookup
    - Remove `disableAuth` prop from `ApiStack` instantiation
    - Always pass `auth.userPool` to `ApiStack`
    - _Requirements: 1.2_

- [x] 9. Add admin provisioning documentation
  - [x] 9.1 Add AWS CLI commands as comments in `infra/lib/auth-stack.ts`
    - Document CLI commands to create a user, set a permanent password, and add the user to the "admin" group
    - Reference the CDK stack outputs for User Pool ID and Client ID
    - _Requirements: 9.1, 9.2, 9.3_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Backend RBAC (tasks 1–2) is implemented first so it can be tested independently
- CDK infrastructure changes (task 8) are deliberately last — this is the "flip the switch" that removes the auth bypass
- UI guards are defense-in-depth; the API enforces authorization server-side
- Property tests use `fast-check` and validate universal correctness properties from the design document
- Each task references specific requirements for traceability
