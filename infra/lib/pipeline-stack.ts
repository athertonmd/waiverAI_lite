import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as events_targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import * as path from 'node:path';

export interface PipelineStackProps extends cdk.StackProps {
  ingestionBucketName: string;
  ingestionBucketArn: string;
  alertTopic: sns.ITopic;
  notificationDomain?: string;
  tableNames: {
    waivers: string;
    waiverVersions: string;
    monitorSchedules: string;
    webContentVersions: string;
    settings: string;
    webhookSubscriptions: string;
    corrections: string;
  };
}

export class PipelineStack extends cdk.Stack {
  public readonly stateMachine: sfn.StateMachine;
  public readonly triggerFnArn: string;

  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    const dynamoEnv = {
      WAIVERS_TABLE: props.tableNames.waivers,
      WAIVER_VERSIONS_TABLE: props.tableNames.waiverVersions,
      MONITOR_SCHEDULES_TABLE: props.tableNames.monitorSchedules,
      WEB_CONTENT_VERSIONS_TABLE: props.tableNames.webContentVersions,
      SETTINGS_TABLE: props.tableNames.settings,
      WEBHOOK_SUBSCRIPTIONS_TABLE: props.tableNames.webhookSubscriptions,
      CORRECTIONS_TABLE: props.tableNames.corrections,
    };

    // --- Lambda Functions ---
    const normaliseFn = new lambdaNodejs.NodejsFunction(this, 'NormaliseFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambdas/src/normalisation/handler.ts'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      environment: { INGESTION_BUCKET: props.ingestionBucketName, DLQ_URL: '', AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1' },
      bundling: { externalModules: ['@aws-sdk/*'] },
    });

    const extractFn = new lambdaNodejs.NodejsFunction(this, 'ExtractFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambdas/src/extraction/handler.ts'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: { INGESTION_BUCKET: props.ingestionBucketName, CORRECTIONS_TABLE: props.tableNames.corrections, SETTINGS_TABLE: props.tableNames.settings, AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1' },
      bundling: { externalModules: ['@aws-sdk/*'] },
    });

    // Chromium renderer — re-fetches pages that returned error/access-denied content
    // Uses headless Chromium to render JS-heavy SPAs and capture screenshots
    const chromiumFn = new lambdaNodejs.NodejsFunction(this, 'ChromiumRenderFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambdas/src/chromium-renderer/handler.ts'),
      memorySize: 1024,
      timeout: cdk.Duration.seconds(60),
      environment: { INGESTION_BUCKET: props.ingestionBucketName, AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1' },
      bundling: {
        externalModules: ['@aws-sdk/*'],
        // Install chromium + puppeteer as native node_modules so the binary is preserved
        nodeModules: ['@sparticuz/chromium', 'puppeteer-core'],
      },
    });

    const storeFn = new lambdaNodejs.NodejsFunction(this, 'StoreFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambdas/src/storage/handler.ts'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      environment: { INGESTION_BUCKET: props.ingestionBucketName, ...dynamoEnv, AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1' },
      bundling: { externalModules: ['@aws-sdk/*'] },
    });

    // IAM policies for S3 access
    const s3RW = new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:PutObject', 's3:PutObjectTagging', 's3:DeleteObject'],
      resources: [`${props.ingestionBucketArn}/*`],
    });
    const s3List = new iam.PolicyStatement({
      actions: ['s3:ListBucket'],
      resources: [props.ingestionBucketArn],
    });
    const s3Read = new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [`${props.ingestionBucketArn}/*`],
    });

    normaliseFn.addToRolePolicy(s3RW);
    normaliseFn.addToRolePolicy(s3List);
    chromiumFn.addToRolePolicy(s3RW);
    chromiumFn.addToRolePolicy(s3List);
    extractFn.addToRolePolicy(s3RW);
    extractFn.addToRolePolicy(s3List);
    extractFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        'arn:aws:bedrock:*::foundation-model/anthropic.claude-3-haiku-20240307-v1:0',
        'arn:aws:bedrock:*::foundation-model/anthropic.claude-3-7-sonnet-20250219-v1:0',
      ],
    }));
    extractFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['aws-marketplace:ViewSubscriptions', 'aws-marketplace:Subscribe'],
      resources: ['*'],
    }));
    extractFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query', 'dynamodb:Scan'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.tableNames.corrections}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.tableNames.corrections}/index/*`,
      ],
    }));
    extractFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.tableNames.settings}`,
      ],
    }));
    storeFn.addToRolePolicy(s3Read);
    storeFn.addToRolePolicy(s3List);

    // Grant DynamoDB read/write to store Lambda
    const dynamoPolicy = new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem',
        'dynamodb:DeleteItem', 'dynamodb:Query', 'dynamodb:Scan',
      ],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.tableNames.waivers}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.tableNames.waivers}/index/*`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.tableNames.waiverVersions}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.tableNames.waiverVersions}/index/*`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.tableNames.webhookSubscriptions}`,
      ],
    });
    storeFn.addToRolePolicy(dynamoPolicy);

    // --- Step Functions Definition ---


    // Failed state
    const publishFailure = new tasks.SnsPublish(this, 'PublishFailure', {
      topic: props.alertTopic,
      message: sfn.TaskInput.fromJsonPathAt("States.Format('Pipeline failed: {}', $.error)"),
      subject: 'Waiver Pipeline Failure',
      resultPath: sfn.JsonPath.DISCARD,
    });
    const failedState = publishFailure.next(
      new sfn.Fail(this, 'Failed', { cause: 'Pipeline stage failed after retries', error: 'PipelineError' }),
    );

    const successState = new sfn.Succeed(this, 'Success');

    // Store task
    const storeTask = new tasks.LambdaInvoke(this, 'Store', {
      lambdaFunction: storeFn, outputPath: '$.Payload', retryOnServiceExceptions: true,
    });
    storeTask.addRetry({ maxAttempts: 2, backoffRate: 2, interval: cdk.Duration.seconds(2), errors: ['States.ALL'] });
    storeTask.addCatch(
      new sfn.Pass(this, 'StoreFailed', {
        parameters: { 'error.$': '$.Error', 'cause.$': '$.Cause' }, resultPath: '$',
      }).next(failedState),
      { resultPath: '$' },
    );
    storeTask.next(successState);

    // Extract task with stage tracking
    const addExtractStage = new sfn.Pass(this, 'AddExtractStage', {
      parameters: {
        'normalizedS3Key.$': '$.normalizedS3Key',
        'sourceS3Key.$': '$.sourceS3Key',
        'sourceUrl.$': '$.sourceUrl',
        'sourceType.$': '$.sourceType',
        'recordId.$': '$.recordId',
        'currentStage': 'extraction',
        'stageTimestamp.$': '$$.State.EnteredTime',
      },
    });

    const extractTask = new tasks.LambdaInvoke(this, 'Extract', {
      lambdaFunction: extractFn, outputPath: '$.Payload', retryOnServiceExceptions: true,
    });
    extractTask.addRetry({ maxAttempts: 2, backoffRate: 2, interval: cdk.Duration.seconds(2), errors: ['States.ALL'] });
    extractTask.addCatch(
      new sfn.Pass(this, 'ExtractFailed', {
        parameters: { 'error.$': '$.Error', 'cause.$': '$.Cause' }, resultPath: '$',
      }).next(failedState),
      { resultPath: '$' },
    );
    extractTask.next(storeTask);
    addExtractStage.next(extractTask);

    // Normalise task with stage tracking
    const addNormaliseStage = new sfn.Pass(this, 'AddNormaliseStage', {
      parameters: {
        's3Key.$': '$.s3Key',
        'sourceType.$': '$.sourceType',
        'recordId.$': '$.recordId',
        'currentStage': 'normalisation',
        'stageTimestamp.$': '$$.State.EnteredTime',
      },
    });

    const normaliseTask = new tasks.LambdaInvoke(this, 'Normalise', {
      lambdaFunction: normaliseFn, outputPath: '$.Payload', retryOnServiceExceptions: true,
    });
    normaliseTask.addRetry({ maxAttempts: 2, backoffRate: 2, interval: cdk.Duration.seconds(2), errors: ['States.ALL'] });
    normaliseTask.addCatch(
      new sfn.Pass(this, 'NormaliseFailed', {
        parameters: { 'error.$': '$.Error', 'cause.$': '$.Cause' }, resultPath: '$',
      }).next(failedState),
      { resultPath: '$' },
    );
    // Chromium rendering step — re-fetches error pages with headless browser
    const addChromiumStage = new sfn.Pass(this, 'AddChromiumStage', {
      parameters: {
        'normalizedS3Key.$': '$.normalizedS3Key',
        'sourceS3Key.$': '$.sourceS3Key',
        'sourceUrl.$': '$.sourceUrl',
        'sourceType.$': '$.sourceType',
        'recordId.$': '$.recordId',
        'currentStage': 'chromium_render',
      },
    });

    const chromiumTask = new tasks.LambdaInvoke(this, 'ChromiumRender', {
      lambdaFunction: chromiumFn, outputPath: '$.Payload', retryOnServiceExceptions: true,
    });
    chromiumTask.addRetry({ maxAttempts: 1, backoffRate: 2, interval: cdk.Duration.seconds(5), errors: ['States.ALL'] });
    // If Chromium fails, continue with original content (don't fail the pipeline)
    chromiumTask.addCatch(addExtractStage, { resultPath: '$.chromiumError' });
    chromiumTask.next(addExtractStage);
    addChromiumStage.next(chromiumTask);

    normaliseTask.next(addChromiumStage);
    addNormaliseStage.next(normaliseTask);

    // Lumo bypass — skips normalise/chromium for Lumo sources
    const lumoBypass = new sfn.Pass(this, 'LumoBypass', {
      parameters: {
        'normalizedS3Key.$': '$.s3Key',
        'sourceS3Key.$': '$.s3Key',
        'sourceType.$': '$.sourceType',
        'recordId.$': '$.recordId',
        'sourceUrl': '',
      },
    });
    lumoBypass.next(addExtractStage);

    // Source type routing — entry point for the state machine
    const sourceTypeCheck = new sfn.Choice(this, 'SourceTypeCheck')
      .when(sfn.Condition.stringEquals('$.sourceType', 'lumo'), lumoBypass)
      .otherwise(addNormaliseStage);

    // State Machine
    this.stateMachine = new sfn.StateMachine(this, 'WaiverPipeline', {
      definitionBody: sfn.DefinitionBody.fromChainable(sourceTypeCheck),
      timeout: cdk.Duration.minutes(30),
      tracingEnabled: true,
    });

    // --- Lumo Poller ---

    // Secrets Manager secret for Lumo API key
    const lumoSecretName = this.node.tryGetContext('lumoApiSecretName') ?? 'waiverhub/lumo-api-key';
    const lumoApiSecret = new secretsmanager.Secret(this, 'LumoApiSecret', {
      secretName: lumoSecretName,
      description: 'API key for the Lumo waivers/search endpoint',
      secretStringValue: cdk.SecretValue.unsafePlainText(JSON.stringify({ apiKey: 'REPLACE_ME' })),
    });

    // Lumo Poller Lambda
    const lumoPollerFn = new lambdaNodejs.NodejsFunction(this, 'LumoPollerFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambdas/src/lumo-poller/handler.ts'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(120),
      environment: {
        LUMO_API_SECRET_ARN: lumoApiSecret.secretArn,
        LUMO_API_BASE_URL: this.node.tryGetContext('lumoApiBaseUrl') ?? 'https://flifo-qa.flightstats.com/flex',
        INGESTION_BUCKET: props.ingestionBucketName,
        STATE_MACHINE_ARN: this.stateMachine.stateMachineArn,
        SETTINGS_TABLE: props.tableNames.settings,
      },
      bundling: { externalModules: ['@aws-sdk/*'] },
    });

    // Grant Lumo Poller permissions
    lumoApiSecret.grantRead(lumoPollerFn);
    lumoPollerFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
      resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/${props.tableNames.settings}`],
    }));
    lumoPollerFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject'],
      resources: [`${props.ingestionBucketArn}/raw/lumo/*`],
    }));
    this.stateMachine.grantStartExecution(lumoPollerFn);

    // EventBridge schedule for Lumo Poller (every 30 minutes)
    new events.Rule(this, 'LumoPollerSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(30)),
      targets: [new events_targets.LambdaFunction(lumoPollerFn)],
    });

    // --- Expiry Checker ---

    const expiryCheckerFn = new lambdaNodejs.NodejsFunction(this, 'ExpiryCheckerFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambdas/src/expiry-checker/handler.ts'),
      memorySize: 256,
      timeout: cdk.Duration.seconds(60),
      environment: {
        WAIVERS_TABLE: props.tableNames.waivers,
        SETTINGS_TABLE: props.tableNames.settings,
      },
      bundling: { externalModules: ['@aws-sdk/*'] },
    });

    // Grant DynamoDB read/write access to waivers table
    expiryCheckerFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem',
        'dynamodb:Query', 'dynamodb:Scan',
      ],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.tableNames.waivers}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.tableNames.waivers}/index/*`,
      ],
    }));

    // Grant DynamoDB GetItem on settings table (for reading rule config)
    expiryCheckerFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.tableNames.settings}`,
      ],
    }));

    // EventBridge schedule for Expiry Checker (daily)
    new events.Rule(this, 'ExpiryCheckerSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.days(1)),
      targets: [new events_targets.LambdaFunction(expiryCheckerFn)],
    });

    // S3 trigger Lambda
    const triggerFn = new lambdaNodejs.NodejsFunction(this, 'S3TriggerFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambdas/src/pipeline-trigger/handler.ts'),
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: {
        STATE_MACHINE_ARN: this.stateMachine.stateMachineArn,
        SETTINGS_TABLE: props.tableNames.settings,
        NOTIFICATION_SENDER: `notifications@${props.notificationDomain ?? 'waiverhub.info'}`,
      },
      bundling: { externalModules: ['@aws-sdk/*'] },
    });

    this.stateMachine.grantStartExecution(triggerFn);
    this.triggerFnArn = triggerFn.functionArn;

    // S3 read for email metadata
    triggerFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:HeadObject'],
      resources: [`${props.ingestionBucketArn}/*`],
    }));

    // SES send for arrival notifications
    triggerFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: [`arn:aws:ses:${this.region}:${this.account}:identity/*`],
    }));

    // DynamoDB read for notification recipients
    triggerFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem'],
      resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/${props.tableNames.settings}`],
    }));

    triggerFn.addPermission('S3InvokePermission', {
      principal: new iam.ServicePrincipal('s3.amazonaws.com'),
      sourceArn: props.ingestionBucketArn,
      sourceAccount: this.account,
    });

    // Wire S3 bucket notification → trigger Lambda using a custom resource
    // This avoids cross-stack mutation of the Base stack's bucket
    const s3NotificationCr = new cdk.custom_resources.AwsCustomResource(this, 'S3BucketNotification', {
      onCreate: {
        service: 'S3',
        action: 'putBucketNotificationConfiguration',
        parameters: {
          Bucket: props.ingestionBucketName,
          NotificationConfiguration: {
            LambdaFunctionConfigurations: [
              {
                LambdaFunctionArn: triggerFn.functionArn,
                Events: ['s3:ObjectCreated:*'],
                Filter: {
                  Key: {
                    FilterRules: [{ Name: 'prefix', Value: 'raw/' }],
                  },
                },
              },
            ],
          },
        },
        physicalResourceId: cdk.custom_resources.PhysicalResourceId.of('S3NotificationConfig'),
      },
      onUpdate: {
        service: 'S3',
        action: 'putBucketNotificationConfiguration',
        parameters: {
          Bucket: props.ingestionBucketName,
          NotificationConfiguration: {
            LambdaFunctionConfigurations: [
              {
                LambdaFunctionArn: triggerFn.functionArn,
                Events: ['s3:ObjectCreated:*'],
                Filter: {
                  Key: {
                    FilterRules: [{ Name: 'prefix', Value: 'raw/' }],
                  },
                },
              },
            ],
          },
        },
        physicalResourceId: cdk.custom_resources.PhysicalResourceId.of('S3NotificationConfig'),
      },
      onDelete: {
        service: 'S3',
        action: 'putBucketNotificationConfiguration',
        parameters: {
          Bucket: props.ingestionBucketName,
          NotificationConfiguration: {},
        },
      },
      policy: cdk.custom_resources.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['s3:PutBucketNotification', 's3:PutBucketNotificationConfiguration', 's3:GetBucketNotification', 's3:GetBucketNotificationConfiguration'],
          resources: [props.ingestionBucketArn],
        }),
      ]),
    });

    // Ensure the Lambda permission is created before the notification
    s3NotificationCr.node.addDependency(triggerFn);

    // Outputs
    new cdk.CfnOutput(this, 'StateMachineArn', { value: this.stateMachine.stateMachineArn });
    new cdk.CfnOutput(this, 'TriggerFnArn', { value: triggerFn.functionArn });
  }
}