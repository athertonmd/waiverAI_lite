# WaiverHub — Technical Handover Document

## 1. Overview

WaiverHub is a web application for the airline industry that automates the ingestion, extraction, normalisation, and management of airline fare waivers. Waivers arrive via email, web URL fetch, file upload, or browser extension capture. An AI-powered pipeline (Amazon Bedrock / Claude) extracts structured data from unstructured waiver documents, scores extraction confidence, and routes low-confidence results to a human review queue. The system learns from human corrections over time.

Production URL: https://waiverhub.info

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, React Router, TanStack Query |
| Backend API | AWS Lambda (Node.js 20), API Gateway REST |
| Auth | Amazon Cognito (User Pool, PKCE flow, custom login page) |
| Database | Amazon DynamoDB (7 tables, PAY_PER_REQUEST) |
| Storage | Amazon S3 (versioned ingestion bucket) |
| Pipeline | AWS Step Functions (Normalise → Chromium Render → Extract → Score → Store) |
| AI/ML | Amazon Bedrock (Claude 3 Haiku / Claude 3.7 Sonnet) |
| Email | Amazon SES (receipt rules in eu-west-1, sending in eu-west-2) |
| Hosting | S3 + CloudFront (OAC), ACM certificate |
| IaC | AWS CDK v2 (TypeScript) |
| Monorepo | npm workspaces |

## 3. Repository Structure

```
WaiverAI_Lite/
├── infra/              # CDK infrastructure (8 stacks)
│   ├── bin/app.ts      # CDK app entry point
│   └── lib/            # Stack definitions
├── lambdas/            # All Lambda function handlers
│   └── src/
│       ├── api/            # Main authenticated API (waivers, dashboard, settings, users)
│       ├── public-api/     # Public API (API-key gated + registration endpoint)
│       ├── extraction/     # AI extraction via Bedrock
│       ├── normalisation/  # Document normalisation (PDF/HTML → text)
│       ├── chromium-renderer/ # Headless Chromium for JS-heavy pages
│       ├── storage/        # DynamoDB persistence + duplicate detection
│       ├── email-processor/   # SES email parsing
│       ├── pipeline-trigger/  # S3 event → Step Functions
│       ├── browser-capture/   # Chrome extension capture endpoint
│       ├── upload-generator/  # Pre-signed S3 upload URLs
│       ├── web-fetcher/       # URL fetch + Chromium rendering
│       ├── web-monitor/       # Scheduled URL monitoring
│       ├── webhooks/          # Outbound webhook dispatcher
│       ├── a2i/               # Amazon A2I human review (start/complete)
│       ├── high-impact/       # High-impact change detector
│       └── shared/            # DB helpers, cache, field schema
├── shared/             # Shared types and utilities
│   └── src/
├── ui/                 # React SPA
│   └── src/
│       ├── api/            # API client (fetch wrapper)
│       ├── auth/           # PKCE auth, role resolution
│       ├── components/     # Layout, Sidebar, TopNav, ProtectedRoute
│       ├── pages/          # Dashboard, WaiverList, WaiverDetail, ReviewQueue,
│       │                   # Ingest, Monitoring, RulesEngine, Reports,
│       │                   # Settings, UserManagement, Login
│       └── styles/
├── extension/          # Chrome extension for browser capture
├── scripts/            # Deployment scripts
└── docs/               # This document
```

## 4. CDK Stacks

All infrastructure is defined in `infra/lib/` and wired together in `infra/bin/app.ts`.

| Stack | Region | Purpose |
|---|---|---|
| WaiverDataHubBase | eu-west-2 | VPC (2 AZs, 1 NAT), S3 ingestion bucket, SNS alert topic |
| WaiverDataHubDatabase | eu-west-2 | 7 DynamoDB tables (Waivers, WaiverVersions, MonitorSchedules, WebContentVersions, Settings, WebhookSubscriptions, Corrections) |
| WaiverDataHubAuth | eu-west-2 | Cognito User Pool, App Client (PKCE), admin/user groups |
| WaiverDataHubApi | eu-west-2 | API Gateway REST API, main Lambda, public API Lambda, upload/web-fetch/browser-capture Lambdas, Cognito authorizer, usage plans |
| WaiverDataHubEmailIngestion | eu-west-1 | SES receipt rule set, email processor Lambda |
| WaiverDataHubPipeline | eu-west-2 | Step Functions state machine, normalise/extract/chromium/store Lambdas, S3 trigger |
| WaiverDataHubCertificate | us-east-1 | ACM certificate for waiverhub.info (required by CloudFront) |
| WaiverDataHubHosting | eu-west-2 | S3 bucket + CloudFront distribution with OAC |

## 5. DynamoDB Tables

| Table | Partition Key | Sort Key | GSIs |
|---|---|---|---|
| Waivers | id (S) | — | status-index, airline_code-index, airline_code-waiver_code-index |
| WaiverVersions | waiver_id (S) | version_number (N) | — |
| MonitorSchedules | id (S) | — | status-index |
| WebContentVersions | schedule_id (S) | fetched_at (S) | — |
| Settings | key (S) | — | — |
| WebhookSubscriptions | id (S) | — | — |
| Corrections | id (S) | — | created_at-index (source_type / created_at) |

Note: The `airline_code-waiver_code-index` GSI on the Waivers table was created via CLI (stack drift). Always use `--exclusively` when deploying other stacks to avoid drift issues.

## 6. Processing Pipeline

The Step Functions pipeline processes incoming waiver documents:

```
S3 Object Created (raw/ prefix)
  → Pipeline Trigger Lambda
    → Step Functions State Machine:
        1. Normalise (PDF/HTML → plain text, stored to S3)
        2. Chromium Render (re-fetch JS-heavy pages with headless browser)
        3. Extract (Bedrock Claude AI extracts structured fields + confidence scores)
        4. Score Check:
           - confidence >= 0.85 → Auto-Approve → Store
           - confidence < 0.85  → Review Queue → Store
        5. Store (write to DynamoDB, duplicate detection, version tracking)
```

The extraction Lambda uses few-shot learning: it queries the Corrections table for recent human corrections and includes them as examples in the Bedrock prompt, improving accuracy over time.

## 7. Authentication and Authorization

- Cognito User Pool with two groups: `admin` and `user`
- Custom login page (not Cognito Hosted UI) using `USER_PASSWORD_AUTH` flow
- PKCE authorization code flow also supported for OAuth
- ID tokens sent to API Gateway (Cognito authorizer validates claims)
- Role-based access control:
  - Admin: full access to all pages and API endpoints
  - User: read-only access to Dashboard, Waivers, and Reports
- Admin-only routes: /review, /ingest, /rules, /settings, /users, /monitoring
- 30-minute inactivity auto-logout timer
- API client auto-logs out on 401/403 responses
- Self-registration: users submit access requests via POST /v1/register (public, no auth); admins approve/reject in the User Management page
- Forgot password flow with Cognito verification codes

## 8. API Routes

All authenticated routes use Cognito authorizer. Public routes use API key or no auth.

### Authenticated (Cognito)
- `GET /v1/waivers` — list waivers (with filters)
- `GET /v1/waivers/active` — active waivers only
- `GET /v1/waivers/search` — search waivers
- `GET /v1/waivers/{id}` — get waiver detail
- `POST /v1/waivers/{id}/approve` — approve waiver
- `POST /v1/waivers/{id}/reject` — reject waiver
- `PUT /v1/waivers/{id}/draft` — save draft edits
- `POST /v1/waivers/{id}/archive` — archive waiver
- `POST /v1/waivers/{id}/reinstate` — reinstate archived waiver
- `GET /v1/waivers/{id}/versions` — version history
- `GET /v1/waivers/{id}/source` — original source content
- `POST /v1/ingestion/upload` — get pre-signed S3 upload URL
- `POST /v1/ingestion/web-url` — fetch waiver from URL
- `POST /v1/ingestion/browser-capture` — Chrome extension capture
- `GET /v1/monitoring/schedules` — list monitor schedules
- `PUT /v1/monitoring/schedules/{id}` — update schedule
- `DELETE /v1/monitoring/schedules/{id}` — terminate schedule
- `GET /v1/dashboard/metrics` — dashboard statistics
- `GET/PUT /v1/settings/threshold` — confidence threshold
- `GET/PUT /v1/settings/extraction-fields` — configurable extraction fields
- `GET/PUT /v1/settings/notification-recipients` — email notification recipients
- `POST/GET /v1/settings/api-keys` — manage public API keys
- `DELETE /v1/settings/api-keys/{keyId}` — revoke API key
- `POST/GET /v1/webhooks` — manage webhook subscriptions
- `DELETE /v1/webhooks/{id}` — delete webhook
- `GET/POST /v1/users` — list/create users (admin only)
- `DELETE /v1/users/{username}` — delete user
- `PUT /v1/users/{username}/role` — change user role
- `POST /v1/users/{username}/disable` — disable user
- `POST /v1/users/{username}/enable` — enable user
- `GET /v1/registration-requests` — list pending access requests
- `POST /v1/registration-requests/{id}/approve` — approve request
- `POST /v1/registration-requests/{id}/reject` — reject request

### Public (API Key)
- `GET /v1/public/waivers` — list waivers
- `GET /v1/public/waivers/search` — search
- `GET /v1/public/waivers/{id}` — get waiver
- `GET /v1/public/docs` — OpenAPI spec (no key required)

### Public (No Auth)
- `POST /v1/register` — submit access request

## 9. UI Pages

| Route | Page | Access | Description |
|---|---|---|---|
| `/` | Dashboard | All | Metrics overview (total waivers, pending review, active, expiring soon) |
| `/waivers` | WaiverList | All | Searchable/filterable list of all waivers |
| `/waivers/:id` | WaiverDetail | All | Full waiver detail with edit, approve, reject, archive actions |
| `/review` | ReviewQueue | Admin | Waivers pending human review |
| `/ingest` | Ingest | Admin | File upload, URL fetch, manual ingestion |
| `/monitoring` | Monitoring | Admin | Web URL monitoring schedules |
| `/rules` | RulesEngine | Admin | Confidence threshold, duplicate detection toggle |
| `/reports` | Reports | Admin | Reporting and analytics |
| `/settings` | Settings | Admin | Extraction fields, notification recipients, API keys, webhooks |
| `/users` | UserManagement | Admin | User CRUD, role management, pending access requests |

Login page is shown automatically when unauthenticated (no redirect to Cognito Hosted UI).

## 10. Deployment

### Prerequisites
- Node.js >= 18
- AWS CLI configured with appropriate credentials
- AWS CDK v2 installed (`npm install -g aws-cdk`)
- CDK bootstrapped in eu-west-2 and us-east-1

### Install Dependencies
```bash
cd ~/Library/CloudStorage/OneDrive-Personal/WaiverAI_Lite
npm install
```

### Deploy Backend (CDK Stacks)
Always use `--exclusively` to avoid drift issues with the Database stack.

```bash
cd ~/Library/CloudStorage/OneDrive-Personal/WaiverAI_Lite/infra

# Deploy a specific stack
npx cdk deploy WaiverDataHubApi --exclusively -c recipientDomain=waiverhub.info --require-approval never

# Deploy all stacks (use with caution due to Database stack drift)
npx cdk deploy --all -c recipientDomain=waiverhub.info --require-approval never
```

Important: The `-c recipientDomain=waiverhub.info` context parameter is required. Without it, the domain defaults to `waivers.example.com`.

### Deploy Frontend (UI Only)
No CDK deploy needed. The script builds the Vite app and syncs to S3.

```bash
cd ~/Library/CloudStorage/OneDrive-Personal/WaiverAI_Lite
bash scripts/deploy-ui.sh
```

This runs:
1. `npm run build --prefix ui` (Vite production build using `.env.production`)
2. `aws s3 sync ui/dist/ s3://<bucket> --delete`
3. `aws cloudfront create-invalidation --distribution-id <id> --paths "/*"`

The bucket name and CloudFront distribution ID are read automatically from the WaiverDataHubHosting stack outputs.

### Environment Variables (UI Production)
Defined in `ui/.env.production`:
- `VITE_API_URL` — API Gateway prod stage URL
- `VITE_COGNITO_USER_POOL_ID` — Cognito User Pool ID
- `VITE_COGNITO_CLIENT_ID` — Cognito App Client ID
- `VITE_COGNITO_DOMAIN` — Cognito domain for OAuth
- `VITE_REDIRECT_SIGN_IN` / `VITE_REDIRECT_SIGN_OUT` — OAuth callback URLs

## 11. Known Issues and Gotchas

1. **Database Stack Drift**: The `airline_code-waiver_code-index` GSI was created via CLI. Always deploy other stacks with `--exclusively` to avoid CloudFormation trying to reconcile drift.

2. **Lambda Resource Policy 20KB Limit**: The main API Lambda uses logical ID `ApiFnV2` (renamed from `ApiFn`) and `CfnAuthorizer` (L1) instead of `CognitoUserPoolsAuthorizer` (L2) to avoid accumulating Lambda::Permission entries. All routes use `AwsIntegration` with an IAM `credentialsRole` instead of `LambdaIntegration`.

3. **SES Sandbox**: SES in eu-west-2 is in sandbox mode. All recipient email addresses must be individually verified before they can receive notifications. To move to production, request production access via the SES console.

4. **SES Receipt Rules Region**: Email receipt rules (for inbound waiver emails) are deployed in eu-west-1 (SES requirement), while the rest of the infrastructure is in eu-west-2.

5. **Cross-Region Stacks**: CertificateStack deploys to us-east-1 (CloudFront requires ACM certs there). Both CertificateStack and HostingStack use `crossRegionReferences: true` and explicit `env: { region, account }`.

6. **Registration Requests**: Stored in the Settings table with `REG#` prefix keys to avoid needing changes to the Database stack.

## 12. Creating the First Admin User

After deploying the Auth stack, create the initial admin user via CLI:

```bash
# Create user
aws cognito-idp admin-create-user \
  --user-pool-id eu-west-2_lrlQ21oKk \
  --username admin@example.com \
  --user-attributes Name=email,Value=admin@example.com Name=email_verified,Value=true \
  --temporary-password 'TempPass1!'

# Set permanent password
aws cognito-idp admin-set-user-password \
  --user-pool-id eu-west-2_lrlQ21oKk \
  --username admin@example.com \
  --password 'YourSecurePassword1!' \
  --permanent

# Add to admin group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id eu-west-2_lrlQ21oKk \
  --username admin@example.com \
  --group-name admin
```

Subsequent users can be created via the User Management page in the UI.

## 13. Corrections Learning Loop

The system improves extraction accuracy over time:

1. When a waiver is first stored, the `ai_extraction` snapshot is saved alongside the record
2. When a user edits fields and saves as draft, the system compares the draft against `ai_extraction`
3. Any differences are recorded in the Corrections table as field-level corrections
4. The Extraction Lambda queries recent corrections and includes them as few-shot examples in the Bedrock prompt
5. This creates a feedback loop where human corrections improve future AI extractions

## 14. Chrome Extension

Located in `extension/`. A browser extension that captures waiver content from web pages:
- Content script captures selected page regions
- Background script sends captured content to the `/v1/ingestion/browser-capture` endpoint
- Supports region selection for targeted capture

## 15. Testing

```bash
# Run all tests
npm test

# Run Lambda tests only
cd lambdas && npm test

# Run shared library tests
cd shared && npm test
```

Tests use Jest with ts-jest. Test files are co-located in `__tests__/` directories alongside their source files.
