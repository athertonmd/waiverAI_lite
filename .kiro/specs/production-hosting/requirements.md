# Requirements Document

## Introduction

Deploy the Waiver Data Hub React SPA to production on AWS using S3 static hosting behind CloudFront, with the custom domain `waiverhub.info`, HTTPS via ACM, production environment configuration, a build/deploy pipeline, and updated Cognito callback URLs. The backend (API Gateway, Lambda, DynamoDB, Cognito) is already deployed in `eu-west-2`. The domain `waiverhub.info` is already registered and used for SES email ingestion.

## Glossary

- **SPA**: The React single-page application built with Vite, located in the `ui/` directory
- **Hosting_Bucket**: An S3 bucket configured for static website hosting that stores the production build artifacts of the SPA
- **Distribution**: An Amazon CloudFront distribution that serves the SPA globally with HTTPS termination and caching
- **Certificate**: An AWS Certificate Manager (ACM) TLS/SSL certificate for the `waiverhub.info` domain, provisioned in `us-east-1` (required by CloudFront)
- **Hosting_Stack**: A new CDK stack (`infra/lib/hosting-stack.ts`) that provisions the Hosting_Bucket, Distribution, and Certificate
- **Auth_Stack**: The existing CDK stack (`infra/lib/auth-stack.ts`) that manages the Cognito User Pool and App Client
- **Build_Script**: A shell script or npm script that builds the SPA with production environment variables and deploys the output to the Hosting_Bucket
- **Environment_Config**: The set of `VITE_*` environment variables that configure the SPA for production (API URL, Cognito settings, redirect URLs)
- **OAC**: An Origin Access Control policy that restricts the Hosting_Bucket to only be accessible via the Distribution

## Requirements

### Requirement 1: S3 Static Hosting Bucket

**User Story:** As a developer, I want the SPA build artifacts stored in a dedicated S3 bucket, so that CloudFront can serve them to users.

#### Acceptance Criteria

1. THE Hosting_Stack SHALL create a Hosting_Bucket with public access blocked via `BlockPublicAccess.BLOCK_ALL`
2. THE Hosting_Stack SHALL configure the Hosting_Bucket with `RemovalPolicy.DESTROY` and `autoDeleteObjects: true` for clean teardown
3. THE Hosting_Stack SHALL create an OAC that grants the Distribution read access to the Hosting_Bucket
4. THE Hosting_Bucket SHALL only be accessible through the Distribution via the OAC policy

### Requirement 2: CloudFront Distribution

**User Story:** As a user, I want to access the Waiver Data Hub via a fast, globally distributed CDN, so that page loads are quick regardless of location.

#### Acceptance Criteria

1. THE Hosting_Stack SHALL create a Distribution with the Hosting_Bucket as its origin using OAC
2. THE Distribution SHALL use the Certificate for HTTPS termination on the `waiverhub.info` domain
3. THE Distribution SHALL set `waiverhub.info` as an alternate domain name (CNAME)
4. THE Distribution SHALL set the default root object to `index.html`
5. WHEN a request results in a 403 or 404 error from S3, THE Distribution SHALL return `/index.html` with HTTP status 200 to support SPA client-side routing
6. THE Distribution SHALL use `CachePolicy.CACHING_OPTIMIZED` for static assets
7. THE Distribution SHALL use `ViewerProtocolPolicy.REDIRECT_HTTPS` to enforce HTTPS for all requests
8. THE Distribution SHALL set `PriceClass.PRICE_CLASS_100` to limit edge locations to North America and Europe

### Requirement 3: ACM TLS Certificate

**User Story:** As a user, I want the application served over HTTPS, so that my data is encrypted in transit.

#### Acceptance Criteria

1. THE Hosting_Stack SHALL provision a Certificate in `us-east-1` for the domain `waiverhub.info` using DNS validation
2. THE Hosting_Stack SHALL output the DNS validation records required to validate the Certificate
3. WHEN the Certificate is validated, THE Distribution SHALL use the Certificate for HTTPS on `waiverhub.info`

### Requirement 4: DNS Configuration

**User Story:** As a developer, I want the `waiverhub.info` domain to point to the CloudFront distribution, so that users can access the app at the custom domain.

#### Acceptance Criteria

1. THE Hosting_Stack SHALL output the Distribution domain name so the developer can create a DNS alias record
2. THE Hosting_Stack SHALL output the Certificate DNS validation CNAME name and value for domain verification
3. THE Hosting_Stack SHALL document the required DNS records (CloudFront alias and ACM validation) as CDK stack outputs

### Requirement 5: Production Environment Configuration

**User Story:** As a developer, I want a production environment configuration file, so that the SPA connects to the correct backend services when deployed.

#### Acceptance Criteria

1. THE Environment_Config SHALL define a `ui/.env.production` file with `VITE_API_URL` set to `https://1xwh2q6cxd.execute-api.eu-west-2.amazonaws.com/prod/`
2. THE Environment_Config SHALL set `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, and `VITE_COGNITO_DOMAIN` to the same values as the existing `ui/.env`
3. THE Environment_Config SHALL set `VITE_REDIRECT_SIGN_IN` to `https://waiverhub.info/`
4. THE Environment_Config SHALL set `VITE_REDIRECT_SIGN_OUT` to `https://waiverhub.info/`
5. WHEN `vite build` runs, THE SPA SHALL use `ui/.env.production` values to replace `import.meta.env.VITE_*` references

### Requirement 6: Cognito Callback URL Update

**User Story:** As a developer, I want the Cognito App Client to accept the production domain as a valid callback URL, so that authentication works on the deployed site.

#### Acceptance Criteria

1. THE Auth_Stack SHALL include `https://waiverhub.info/` in the `callbackUrls` list of the SPA App Client
2. THE Auth_Stack SHALL include `https://waiverhub.info/` in the `logoutUrls` list of the SPA App Client
3. THE Auth_Stack SHALL retain the existing `http://localhost:5173/` callback and logout URLs for local development

### Requirement 7: Build and Deploy Script

**User Story:** As a developer, I want a single command to build and deploy the SPA to production, so that deployments are repeatable and quick.

#### Acceptance Criteria

1. THE Build_Script SHALL run `npm run build` in the `ui/` directory to produce the production build in `ui/dist/`
2. THE Build_Script SHALL sync the `ui/dist/` contents to the Hosting_Bucket using `aws s3 sync` with the `--delete` flag to remove stale files
3. THE Build_Script SHALL create a CloudFront invalidation for `/*` after uploading to ensure users receive the latest version
4. IF the `aws s3 sync` command fails, THEN THE Build_Script SHALL exit with a non-zero status code and print an error message
5. IF the CloudFront invalidation fails, THEN THE Build_Script SHALL print a warning but still exit successfully since the files are already uploaded

### Requirement 8: CDK Stack Integration

**User Story:** As a developer, I want the hosting infrastructure defined as a CDK stack, so that it follows the same infrastructure-as-code pattern as the rest of the project.

#### Acceptance Criteria

1. THE Hosting_Stack SHALL be instantiated in `infra/bin/app.ts` alongside the existing stacks
2. THE Hosting_Stack SHALL accept the domain name as a constructor property with a default of `waiverhub.info`
3. THE Hosting_Stack SHALL export the Hosting_Bucket name, Distribution ID, and Distribution domain name as CloudFormation outputs
4. THE Hosting_Stack SHALL be independently deployable using `cdk deploy WaiverDataHubHosting --exclusively`
