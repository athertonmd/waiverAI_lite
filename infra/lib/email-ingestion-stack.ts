import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaDestinations from 'aws-cdk-lib/aws-lambda-destinations';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as sesActions from 'aws-cdk-lib/aws-ses-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as path from 'node:path';

export interface EmailIngestionStackProps extends cdk.StackProps {
  /** Bucket name (string) to avoid cross-stack resource mutation */
  ingestionBucketName: string;
  /** Bucket ARN (string) to avoid cross-stack resource mutation */
  ingestionBucketArn: string;
  /** The actual bucket reference — only used for SES action (read-only ref) */
  ingestionBucket: s3.IBucket;
  recipientDomain: string;
  alertTopic: sns.ITopic;
  /** Settings table name for notification recipients lookup */
  settingsTableName?: string;
  /** Settings table ARN for IAM permissions */
  settingsTableArn?: string;
  /** Region where the settings table is deployed (for cross-region access) */
  settingsTableRegion?: string;
  /** SES sender address for notifications (e.g., notifications@waiverhub.info) */
  notificationSender?: string;
}

export class EmailIngestionStack extends cdk.Stack {
  public readonly receiptRuleSet: ses.ReceiptRuleSet;
  public readonly emailProcessorFn: lambdaNodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: EmailIngestionStackProps) {
    super(scope, id, props);

    // SES Receipt Rule Set
    this.receiptRuleSet = new ses.ReceiptRuleSet(this, 'WaiverReceiptRuleSet', {
      receiptRuleSetName: 'waiver-email-ingestion',
    });

    // SES Receipt Rule — store raw email to S3
    this.receiptRuleSet.addRule('StoreRawEmail', {
      recipients: [props.recipientDomain],
      actions: [
        new sesActions.S3({
          bucket: props.ingestionBucket,
          objectKeyPrefix: 'raw/email/',
        }),
      ],
      scanEnabled: true,
    });

    // Email Processor Lambda
    this.emailProcessorFn = new lambdaNodejs.NodejsFunction(this, 'EmailProcessorFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambdas/src/email-processor/handler.ts'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      maxEventAge: cdk.Duration.hours(1),
      retryAttempts: 2,
      onFailure: new lambdaDestinations.SnsDestination(props.alertTopic),
      environment: {
        INGESTION_BUCKET: props.ingestionBucketName,
        ...(props.settingsTableName ? { SETTINGS_TABLE: props.settingsTableName } : {}),
        ...(props.settingsTableRegion ? { SETTINGS_TABLE_REGION: props.settingsTableRegion } : {}),
        ...(props.notificationSender ? { NOTIFICATION_SENDER: props.notificationSender } : {}),
      },
      bundling: {
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant S3 access via explicit IAM policy (avoids mutating the cross-stack bucket)
    this.emailProcessorFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:PutObject', 's3:PutObjectTagging'],
      resources: [`${props.ingestionBucketArn}/*`],
    }));
    this.emailProcessorFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:ListBucket'],
      resources: [props.ingestionBucketArn],
    }));

    // SES send permission for arrival notifications
    this.emailProcessorFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: [`arn:aws:ses:${this.region}:${this.account}:identity/*`],
    }));

    // DynamoDB read for notification recipients (cross-region: table is in settingsTableRegion)
    if (props.settingsTableName) {
      const tableRegion = props.settingsTableRegion ?? this.region;
      this.emailProcessorFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['dynamodb:GetItem'],
        resources: [`arn:aws:dynamodb:${tableRegion}:${this.account}:table/${props.settingsTableName}`],
      }));
    }

    // S3 notification: trigger Lambda on raw/email/ prefix
    // Using CfnCustomResource pattern to avoid cross-stack bucket mutation.
    // The Lambda needs invoke permission from S3.
    this.emailProcessorFn.addPermission('S3InvokePermission', {
      principal: new iam.ServicePrincipal('s3.amazonaws.com'),
      sourceArn: props.ingestionBucketArn,
      sourceAccount: this.account,
    });

    // Stack outputs
    new cdk.CfnOutput(this, 'ReceiptRuleSetName', {
      value: this.receiptRuleSet.receiptRuleSetName,
    });
    new cdk.CfnOutput(this, 'EmailProcessorFnArn', {
      value: this.emailProcessorFn.functionArn,
    });
  }
}
