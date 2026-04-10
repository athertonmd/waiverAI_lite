#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { BaseStack } from '../lib/base-stack';
import { DatabaseStack } from '../lib/database-stack';
import { AuthStack } from '../lib/auth-stack';
import { ApiStack } from '../lib/api-stack';
import { EmailIngestionStack } from '../lib/email-ingestion-stack';
import { PipelineStack } from '../lib/pipeline-stack';
import { CertificateStack } from '../lib/certificate-stack';
import { HostingStack } from '../lib/hosting-stack';

const app = new cdk.App();

const base = new BaseStack(app, 'WaiverDataHubBase', {
  description: 'Waiver Data Hub Lite — base infrastructure (VPC, S3, SNS)',
});

const db = new DatabaseStack(app, 'WaiverDataHubDatabase', {
  description: 'Waiver Data Hub Lite — DynamoDB tables',
});

const auth = new AuthStack(app, 'WaiverDataHubAuth', {
  description: 'Waiver Data Hub Lite — Cognito User Pool and App Client',
});

new ApiStack(app, 'WaiverDataHubApi', {
  description: 'Waiver Data Hub Lite — API Gateway',
  userPool: auth.userPool,
  userPoolId: auth.userPool.userPoolId,
  userPoolArn: auth.userPool.userPoolArn,
  ingestionBucket: base.ingestionBucket,
  tableNames: {
    waivers: db.waiversTableName,
    waiverVersions: db.waiverVersionsTableName,
    monitorSchedules: db.monitorSchedulesTableName,
    webContentVersions: db.webContentVersionsTableName,
    settings: db.settingsTableName,
    webhookSubscriptions: db.webhookSubscriptionsTableName,
    corrections: db.correctionsTableName,
  },
});

const recipientDomain = app.node.tryGetContext('recipientDomain') ?? 'waivers.example.com';

new EmailIngestionStack(app, 'WaiverDataHubEmailIngestion', {
  description: 'Waiver Data Hub Lite — SES email ingestion to S3',
  ingestionBucket: base.ingestionBucket,
  ingestionBucketName: base.ingestionBucket.bucketName,
  ingestionBucketArn: base.ingestionBucket.bucketArn,
  recipientDomain,
  alertTopic: base.alertTopic,
  settingsTableName: db.settingsTableName,
  settingsTableArn: db.settingsTable.tableArn,
  settingsTableRegion: 'eu-west-2',
  notificationSender: `notifications@${recipientDomain}`,
});

new PipelineStack(app, 'WaiverDataHubPipeline', {
  description: 'Waiver Data Hub Lite — Step Functions orchestration pipeline',
  ingestionBucketName: base.ingestionBucket.bucketName,
  ingestionBucketArn: base.ingestionBucket.bucketArn,
  alertTopic: base.alertTopic,
  notificationDomain: recipientDomain,
  tableNames: {
    waivers: db.waiversTableName,
    waiverVersions: db.waiverVersionsTableName,
    monitorSchedules: db.monitorSchedulesTableName,
    webContentVersions: db.webContentVersionsTableName,
    settings: db.settingsTableName,
    webhookSubscriptions: db.webhookSubscriptionsTableName,
    corrections: db.correctionsTableName,
  },
});

const cert = new CertificateStack(app, 'WaiverDataHubCertificate', {
  description: 'Waiver Data Hub — ACM certificate for waiverhub.info (us-east-1)',
  env: { region: 'us-east-1', account: process.env.CDK_DEFAULT_ACCOUNT },
  crossRegionReferences: true,
});

new HostingStack(app, 'WaiverDataHubHosting', {
  description: 'Waiver Data Hub — S3 + CloudFront hosting for SPA',
  env: { region: 'eu-west-2', account: process.env.CDK_DEFAULT_ACCOUNT },
  crossRegionReferences: true,
  certificate: cert.certificate,
});

app.synth();
