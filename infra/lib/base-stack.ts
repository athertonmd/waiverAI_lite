import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

export class BaseStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly ingestionBucket: s3.Bucket;
  public readonly alertTopic: sns.Topic;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC — 2 AZs, public + private subnets
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
    });

    // S3 ingestion bucket with versioning
    this.ingestionBucket = new s3.Bucket(this, 'IngestionBucket', {
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      cors: [
        {
          allowedOrigins: ['*'],
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.GET],
          allowedHeaders: ['*'],
          maxAge: 3600,
        },
      ],
      lifecycleRules: [
        {
          id: 'TransitionRawToGlacier',
          prefix: 'raw/',
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
          expiration: cdk.Duration.days(365),
        },
        {
          id: 'DeleteNormalizedFiles',
          prefix: 'normalized/',
          expiration: cdk.Duration.days(30),
        },
        {
          id: 'DeleteExtractedFiles',
          prefix: 'extracted/',
          expiration: cdk.Duration.days(90),
        },
      ],
    });

    // SNS alert topic for pipeline failure notifications
    this.alertTopic = new sns.Topic(this, 'AlertTopic', {
      displayName: 'Waiver Data Hub Pipeline Alerts',
    });

    // Stack outputs
    new cdk.CfnOutput(this, 'VpcId', { value: this.vpc.vpcId });
    new cdk.CfnOutput(this, 'IngestionBucketName', { value: this.ingestionBucket.bucketName });
    new cdk.CfnOutput(this, 'IngestionBucketArn', { value: this.ingestionBucket.bucketArn });
    new cdk.CfnOutput(this, 'AlertTopicArn', { value: this.alertTopic.topicArn });
  }
}
