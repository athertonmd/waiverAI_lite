# Implementation Plan: Production Hosting

## Overview

Deploy the Waiver Data Hub React SPA to production on AWS using S3 + CloudFront with the custom domain `waiverhub.info`. Uses a two-stack CDK approach: CertificateStack in us-east-1 for the ACM certificate, and HostingStack in eu-west-2 for S3/CloudFront. Includes auth callback updates, production env config, and a deploy script.

## Tasks

- [x] 1. Create the CertificateStack in us-east-1
  - [x] 1.1 Create `infra/lib/certificate-stack.ts` with ACM certificate for `waiverhub.info`
    - Provision ACM certificate with DNS validation
    - Accept optional `domainName` prop defaulting to `waiverhub.info`
    - Enable `crossRegionReferences: true` on the stack
    - Expose the certificate as a public readonly property
    - _Requirements: 3.1, 3.2_

  - [ ]* 1.2 Write CDK assertion test for CertificateStack
    - Create `infra/test/certificate-stack.test.ts`
    - Assert ACM certificate resource exists with domain `waiverhub.info` and DNS validation
    - _Requirements: 3.1_

- [x] 2. Create the HostingStack with S3, CloudFront, and OAC
  - [x] 2.1 Create `infra/lib/hosting-stack.ts` with S3 bucket and CloudFront distribution
    - S3 bucket with `BlockPublicAccess.BLOCK_ALL`, `RemovalPolicy.DESTROY`, `autoDeleteObjects: true`
    - CloudFront distribution with OAC, HTTPS redirect, `PRICE_CLASS_100`, default root object `index.html`
    - Custom error responses: 403 → `/index.html` (200), 404 → `/index.html` (200)
    - Accept `certificate` prop from CertificateStack and `domainName` prop (default `waiverhub.info`)
    - Set alternate domain name to `waiverhub.info`
    - Use `CachePolicy.CACHING_OPTIMIZED`
    - CfnOutputs for BucketName, DistributionId, DistributionDomainName
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 4.1, 8.2, 8.3_

  - [ ]* 2.2 Write CDK assertion tests for HostingStack
    - Create `infra/test/hosting-stack.test.ts`
    - Assert S3 bucket has BlockPublicAccess and RemovalPolicy settings
    - Assert CloudFront distribution has correct origin, OAC, HTTPS redirect, price class, default root object, custom error responses
    - Assert stack outputs exist for BucketName, DistributionId, DistributionDomainName
    - _Requirements: 1.1, 1.2, 2.1, 2.4, 2.5, 2.7, 2.8, 4.1, 8.3_

  - [ ]* 2.3 Write property test: SPA routing error responses cover all non-200 S3 errors
    - **Property 2: SPA routing error responses cover all non-200 S3 errors**
    - **Validates: Requirements 2.5**
    - Create `infra/test/hosting-properties.test.ts`
    - Use `fast-check` to generate error codes from {403, 404}
    - Assert CloudFront custom error responses map each code to `/index.html` with status 200

- [x] 3. Wire stacks into CDK app entry point
  - [x] 3.1 Update `infra/bin/app.ts` to instantiate CertificateStack and HostingStack
    - Import and instantiate `CertificateStack` in `us-east-1` with `crossRegionReferences: true`
    - Import and instantiate `HostingStack` in `eu-west-2` with `crossRegionReferences: true`, passing the certificate reference
    - Ensure HostingStack is independently deployable with `cdk deploy WaiverDataHubHosting --exclusively`
    - _Requirements: 8.1, 8.4_

- [x] 4. Update AuthStack with production callback URLs
  - [x] 4.1 Add `https://waiverhub.info/` to Cognito callback and logout URLs in `infra/lib/auth-stack.ts`
    - Add `https://waiverhub.info/` to `callbackUrls` array
    - Add `https://waiverhub.info/` to `logoutUrls` array
    - Retain existing `http://localhost:5173/` and `https://localhost/` entries
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ]* 4.2 Write CDK assertion test for AuthStack callback URLs
    - Create or update `infra/test/auth-stack.test.ts`
    - Assert callbackUrls contains `http://localhost:5173/`, `https://localhost/`, and `https://waiverhub.info/`
    - Assert logoutUrls contains `http://localhost:5173/`, `https://localhost/`, and `https://waiverhub.info/`
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ]* 4.3 Write property test: Auth callback URLs are a superset of required URLs
    - **Property 3: Auth callback URLs are a superset of required URLs**
    - **Validates: Requirements 6.1, 6.2, 6.3**
    - Add to `infra/test/hosting-properties.test.ts`
    - Use `fast-check` to generate random selections from required URL set
    - Assert both callbackUrls and logoutUrls contain each selected URL

- [x] 5. Checkpoint - Ensure all CDK tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Create production environment config and deploy script
  - [x] 6.1 Create `ui/.env.production` with production environment variables
    - Set `VITE_API_URL=https://1xwh2q6cxd.execute-api.eu-west-2.amazonaws.com/prod/`
    - Set `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `VITE_COGNITO_DOMAIN` to same values as `ui/.env`
    - Set `VITE_REDIRECT_SIGN_IN=https://waiverhub.info/`
    - Set `VITE_REDIRECT_SIGN_OUT=https://waiverhub.info/`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 6.2 Write property test: Cognito environment variable consistency
    - **Property 1: Cognito environment variable consistency**
    - **Validates: Requirements 5.2**
    - Add to `infra/test/hosting-properties.test.ts`
    - Use `fast-check` to generate random selections from Cognito VITE_* variable names
    - Assert value in `.env.production` equals value in `.env` for each selected variable

  - [x] 6.3 Create `scripts/deploy-ui.sh` build and deploy script
    - Use `set -e` for error handling
    - Run `npm run build` in `ui/` directory
    - Read BucketName and DistributionId from CloudFormation stack outputs
    - Run `aws s3 sync ui/dist/ s3://$BUCKET --delete`
    - Run `aws cloudfront create-invalidation --distribution-id $DIST_ID --paths "/*"`
    - Exit non-zero on s3 sync failure, warn-only on invalidation failure
    - Make script executable
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The CertificateStack must be deployed first since HostingStack depends on its certificate
- DNS records (CloudFront alias + ACM validation CNAME) must be created manually after deployment
- Deploy uses `--exclusively` flag to avoid Database stack drift issues
- Property tests validate universal correctness properties; CDK assertion tests validate specific configurations
