# Implementation Plan: Public Waiver Browsing

## Overview

Add unauthenticated public waiver browsing at `/browse` and `/browse/:id` using the existing public API. Create a dedicated API client, simplified layout, two page components, a registration CTA, and wire public routes outside `ProtectedRoute` in `App.tsx`. All work is frontend-only (TypeScript/React).

## Tasks

- [x] 1. Set up public API client and environment config
  - [x] 1.1 Add `VITE_PUBLIC_API_KEY` to env and type declarations
    - Add `VITE_PUBLIC_API_KEY=<api-key-value>` to `ui/.env.production`
    - Add `readonly VITE_PUBLIC_API_KEY: string` to `ImportMetaEnv` in `ui/src/vite-env.d.ts`
    - _Requirements: 3.1, 3.3_

  - [x] 1.2 Create `ui/src/api/publicClient.ts`
    - Export `publicApiGet<T>(path, params?)` that fetches using `X-Api-Key` header from `VITE_PUBLIC_API_KEY`
    - Construct URL from `VITE_API_URL` base + path + query params
    - Throw `Error` with parsed message on non-OK responses
    - _Requirements: 3.1, 3.2, 3.3_

  - [ ]* 1.3 Write unit tests for `publicApiGet`
    - Create `ui/src/api/__tests__/publicClient.test.ts`
    - Mock `fetch` globally
    - Test that `X-Api-Key` header is included with correct value
    - Test URL construction with and without query params
    - Test error throwing on non-OK responses with parsed error body
    - _Requirements: 3.1, 3.2, 3.3_

  - [ ]* 1.4 Write property test: publicApiGet always includes X-Api-Key header
    - **Property 3: publicApiGet always includes the X-Api-Key header**
    - Generate random path strings and query param records with `fast-check`
    - Mock `fetch`, call `publicApiGet`, assert `X-Api-Key` header is present with configured value
    - **Validates: Requirements 3.1, 3.3**

- [x] 2. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Create shared UI components (PublicLayout and RegistrationCTA)
  - [x] 3.1 Create `ui/src/components/PublicLayout.tsx`
    - Render minimal header with "✈ Waiver Hub" branding on left and "Sign In" link on right (links to `/`)
    - Render `<Outlet />` for child routes
    - No Sidebar, no TopNav, no auth context
    - White background, same font family as main app
    - _Requirements: 6.4, 6.5_

  - [x] 3.2 Create `ui/src/components/RegistrationCTA.tsx`
    - Render full-width banner with distinct background colour (e.g. `#e8f0fe`)
    - Display message: "Want to add your own waivers via email? Register for a free account."
    - "Register" button navigates to `/login?view=register` (or `/` to trigger login register view)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 3.3 Write unit tests for PublicLayout and RegistrationCTA
    - Test PublicLayout renders header with branding and "Sign In" link, no Sidebar/TopNav
    - Test RegistrationCTA renders message text and register button with distinct background
    - _Requirements: 6.4, 6.5, 5.3, 5.5_

- [x] 4. Implement PublicWaiverList page
  - [x] 4.1 Create `ui/src/pages/PublicWaiverList.tsx`
    - Call `publicApiGet('/v1/public/waivers', { page, pageSize: '20' })` via TanStack Query
    - Display table with columns: Airline Code, Waiver Code, Effective Date, Expiration Date, Applicable Routes
    - Implement pagination controls (Previous / Next) using response pagination metadata
    - Row click navigates to `/browse/:id`
    - Render `<RegistrationCTA />` at bottom
    - Handle loading and error states with user-friendly messages
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 5.1_

  - [ ]* 4.2 Write unit tests for PublicWaiverList
    - Mock `publicApiGet` responses
    - Test table renders correct columns with waiver data
    - Test pagination controls navigate pages
    - Test row click navigates to `/browse/:id`
    - Test error state renders friendly message
    - Test RegistrationCTA is present
    - _Requirements: 1.4, 1.5, 1.7, 3.2, 5.1_

  - [ ]* 4.3 Write property test: Public list view renders all required columns
    - **Property 1: Public list view renders all required columns for any waiver**
    - Generate random `PublicWaiver` objects with `fast-check` `fc.record(...)`
    - Render list table row, assert airline code, waiver code, effective date, expiration date, and applicable routes all appear in output
    - **Validates: Requirements 1.5**

- [x] 5. Implement PublicWaiverDetail page
  - [x] 5.1 Create `ui/src/pages/PublicWaiverDetail.tsx`
    - Call `publicApiGet('/v1/public/waivers/:id')` via TanStack Query using `useParams`
    - Display all returned fields in read-only card layout
    - No approve/reject/draft/archive/forward buttons
    - Show "Registration required to forward waivers" message
    - Render `<RegistrationCTA />` at bottom
    - Handle 404: show "Waiver not found" with link back to `/browse`
    - Handle loading and error states
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 4.1, 4.3, 5.2_

  - [ ]* 5.2 Write unit tests for PublicWaiverDetail
    - Mock `publicApiGet` responses
    - Test fields render in read-only format (no editable inputs)
    - Test 404 response shows "Waiver not found" message
    - Test forward button is hidden, registration-required message is shown
    - Test RegistrationCTA is present
    - _Requirements: 2.3, 2.4, 2.6, 4.1, 4.3, 5.2_

  - [ ]* 5.3 Write property test: Public detail view renders all fields as read-only
    - **Property 2: Public detail view renders all waiver fields as read-only**
    - Generate random `PublicWaiver` objects with `fast-check`
    - Render detail view, assert all non-null field values appear in output
    - Assert zero editable input/textarea elements for waiver data
    - **Validates: Requirements 2.4, 2.6**

- [x] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Wire public routes in App.tsx
  - [x] 7.1 Update `ui/src/App.tsx` to add public routes
    - Import `PublicLayout`, `PublicWaiverList`, `PublicWaiverDetail`
    - Add `/browse` and `/browse/:id` routes wrapped in `<PublicLayout />` as siblings before the `ProtectedRoute` block
    - Ensure existing protected routes remain unchanged inside `ProtectedRoute`
    - _Requirements: 1.1, 2.1, 6.1, 6.2, 6.3, 7.1, 7.2, 7.3, 7.4_

  - [ ]* 7.2 Write unit tests for routing isolation
    - Test `/browse` renders PublicWaiverList without triggering auth
    - Test `/browse/:id` renders PublicWaiverDetail without triggering auth
    - Test existing protected routes still require authentication
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 8. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- No backend changes needed — the existing public API Lambda already serves redacted, active-only data
- CloudFront SPA routing already handles direct links to `/browse` paths
