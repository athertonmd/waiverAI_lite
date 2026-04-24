# Requirements Document

## Introduction

This feature introduces a "General User" profile that allows unauthenticated visitors to browse the waiver list and waiver detail pages on Waiver Hub. General Users can view active waivers without registering or logging in. However, forwarding waiver emails requires registration. A call-to-action banner at the bottom of the public pages encourages General Users to register so they can add their own waivers via email. The public pages will be linkable from the company website (https://waiverhub.info).

## Glossary

- **General_User**: An unauthenticated visitor who can browse public waiver pages without logging in.
- **Registered_User**: A user who has completed the registration and approval process and holds a Cognito account with an assigned role (admin or user).
- **Public_Waiver_Page**: A set of routes (`/browse` and `/browse/:id`) accessible without authentication that display active waiver data.
- **Router**: The React Router configuration in `App.tsx` that determines which routes are public and which require authentication.
- **Public_API_Lambda**: The existing Lambda function at `/v1/public/waivers` that serves redacted, active-only waiver data gated by API key.
- **Registration_CTA**: A call-to-action section displayed at the bottom of Public_Waiver_Pages prompting General Users to register.
- **ProtectedRoute**: The existing wrapper component that enforces Cognito authentication on wrapped routes.
- **Forward_Action**: The ability to send a waiver's details via email to a specified recipient.

## Requirements

### Requirement 1: Public Waiver List Page

**User Story:** As a General User, I want to view a list of active waivers without logging in, so that I can browse available waivers from the company website.

#### Acceptance Criteria

1. WHEN a General_User navigates to `/browse`, THE Router SHALL render the Public_Waiver_Page list view without requiring authentication.
2. THE Public_Waiver_Page list view SHALL display only waivers with an "active" status and a non-expired expiration date.
3. THE Public_Waiver_Page list view SHALL fetch waiver data from the Public_API_Lambda endpoint (`/v1/public/waivers`).
4. THE Public_Waiver_Page list view SHALL display pagination controls allowing the General_User to navigate through pages of results.
5. THE Public_Waiver_Page list view SHALL display each waiver's airline code, waiver code, effective date, expiration date, and applicable routes.
6. THE Public_Waiver_Page list view SHALL redact sensitive fields (source S3 key, normalized S3 key, reviewer ID) from the displayed data.
7. WHEN a General_User clicks on a waiver row, THE Public_Waiver_Page SHALL navigate to `/browse/:id` to show the waiver detail.

### Requirement 2: Public Waiver Detail Page

**User Story:** As a General User, I want to view the details of a specific waiver without logging in, so that I can read the full waiver information.

#### Acceptance Criteria

1. WHEN a General_User navigates to `/browse/:id`, THE Router SHALL render the Public_Waiver_Page detail view without requiring authentication.
2. THE Public_Waiver_Page detail view SHALL fetch waiver data from the Public_API_Lambda endpoint (`/v1/public/waivers/{id}`).
3. IF the requested waiver does not exist or is not active, THEN THE Public_Waiver_Page detail view SHALL display a "Waiver not found" message.
4. THE Public_Waiver_Page detail view SHALL display the waiver's extracted fields in a read-only format.
5. THE Public_Waiver_Page detail view SHALL redact sensitive fields (source S3 key, normalized S3 key, reviewer ID) from the displayed data.
6. THE Public_Waiver_Page detail view SHALL omit admin-only controls (approve, reject, save draft, archive, reinstate).

### Requirement 3: Public API Access for Frontend

**User Story:** As a developer, I want the public waiver pages to call the public API without requiring a user-managed API key, so that General Users can browse waivers seamlessly.

#### Acceptance Criteria

1. THE Public_Waiver_Page SHALL call the Public_API_Lambda endpoints using a server-embedded or environment-configured API key that the General_User does not need to provide.
2. IF the Public_API_Lambda returns an error, THEN THE Public_Waiver_Page SHALL display a user-friendly error message.
3. THE Public_Waiver_Page SHALL include the API key in the `X-Api-Key` header of each request to the Public_API_Lambda.

### Requirement 4: Forward Waiver Email Restriction

**User Story:** As a product owner, I want to restrict the waiver email forwarding action to registered users only, so that unauthenticated visitors cannot send emails from the platform.

#### Acceptance Criteria

1. WHEN a General_User views a waiver detail on the Public_Waiver_Page, THE Public_Waiver_Page SHALL hide the Forward_Action button.
2. WHEN a Registered_User views a waiver detail on the authenticated waiver detail page, THE waiver detail page SHALL display the Forward_Action button.
3. WHILE a General_User is viewing the Public_Waiver_Page detail view, THE Public_Waiver_Page SHALL display a message indicating that registration is required to forward waivers.

### Requirement 5: Registration Call-to-Action

**User Story:** As a product owner, I want a call-to-action at the bottom of the public waiver pages encouraging General Users to register, so that visitors are prompted to create an account and add their own waivers via email.

#### Acceptance Criteria

1. THE Public_Waiver_Page list view SHALL display a Registration_CTA section at the bottom of the page.
2. THE Public_Waiver_Page detail view SHALL display a Registration_CTA section at the bottom of the page.
3. THE Registration_CTA SHALL contain a message explaining that registered users can add their own waivers via email.
4. WHEN a General_User clicks the registration button in the Registration_CTA, THE Router SHALL navigate to the existing registration form (Login page with register view).
5. THE Registration_CTA SHALL be visually prominent with a distinct background colour and a clear action button.

### Requirement 6: Routing and Navigation Isolation

**User Story:** As a developer, I want the public waiver pages to be completely outside the ProtectedRoute wrapper, so that unauthenticated visitors are not redirected to the login page.

#### Acceptance Criteria

1. THE Router SHALL render `/browse` and `/browse/:id` routes outside the ProtectedRoute component.
2. THE Router SHALL continue to wrap all existing routes (`/`, `/waivers`, `/waivers/:id`, `/review`, etc.) inside the ProtectedRoute component.
3. WHEN a General_User navigates to `/browse`, THE Router SHALL render the page without triggering Cognito authentication checks.
4. THE Public_Waiver_Page SHALL use a simplified layout without the authenticated Sidebar and TopNav components.
5. THE Public_Waiver_Page SHALL display a minimal header with the Waiver Hub branding and a "Sign In" link.

### Requirement 7: Linkability from External Website

**User Story:** As a product owner, I want the public waiver pages to be directly linkable from the company website, so that visitors can navigate to specific waivers from external sources.

#### Acceptance Criteria

1. THE Public_Waiver_Page at `/browse` SHALL be accessible via a direct URL (e.g., `https://waiverhub.info/browse`).
2. THE Public_Waiver_Page at `/browse/:id` SHALL be accessible via a direct URL (e.g., `https://waiverhub.info/browse/abc-123`).
3. WHEN a General_User accesses a direct URL to a public waiver page, THE Router SHALL render the correct page without requiring prior navigation within the application.
4. THE hosting configuration SHALL support client-side routing for `/browse` and `/browse/:id` paths (CloudFront/S3 fallback to `index.html`).
