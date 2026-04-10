#!/usr/bin/env bash
set -e

echo "Building UI for production..."
npm run build --prefix ui

STACK_NAME="WaiverDataHubHosting"

BUCKET=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" \
  --output text)

DIST_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
  --output text)

if [ -z "$BUCKET" ] || [ -z "$DIST_ID" ]; then
  echo "ERROR: Could not read stack outputs from $STACK_NAME. Is the stack deployed?"
  exit 1
fi

echo "Syncing ui/dist/ to s3://$BUCKET ..."
aws s3 sync ui/dist/ "s3://$BUCKET" --delete

echo "Creating CloudFront invalidation..."
if aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" > /dev/null 2>&1; then
  echo "Invalidation created."
else
  echo "WARNING: CloudFront invalidation failed. Files are already uploaded."
fi

echo "Deploy complete."
