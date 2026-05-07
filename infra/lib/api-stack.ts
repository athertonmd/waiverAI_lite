import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as path from 'node:path';

export interface ApiStackProps extends cdk.StackProps {
  userPool: cognito.IUserPool;
  userPoolId: string;
  userPoolArn: string;
  ingestionBucket: s3.IBucket;
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

export class ApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const accessLogGroup = new logs.LogGroup(this, 'ApiAccessLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.api = new apigateway.RestApi(this, 'WaiverApi', {
      restApiName: 'Waiver Data Hub API',
      description: 'REST API for Waiver Data Hub Lite',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
      },
      deployOptions: {
        stageName: 'prod',
        accessLogDestination: new apigateway.LogGroupLogDestination(accessLogGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
      },
    });

    // Cognito authorizer — use CfnAuthorizer (L1) to avoid automatic Lambda::Permission
    // resources that the L2 CognitoUserPoolsAuthorizer creates. Those permissions are
    // unnecessary (Cognito validates tokens directly) and push past the 20KB policy limit.
    const cfnAuthorizer = new apigateway.CfnAuthorizer(this, 'CognitoAuth', {
      restApiId: this.api.restApiId,
      name: 'CognitoAuthorizer',
      type: 'COGNITO_USER_POOLS',
      identitySource: 'method.request.header.Authorization',
      providerArns: [props.userPoolArn],
    });
    const authOpts: apigateway.MethodOptions = {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer: { authorizerId: cfnAuthorizer.ref } as any,
    };

    // --- Main API Lambda (handles waivers, dashboard, settings, versions) ---
    // Note: Logical ID is 'ApiFnV2' to force a fresh Lambda and reset the resource
    // policy. The previous 'ApiFn' accumulated Lambda::Permission entries that exceeded
    // the 20KB limit. All routes use AwsIntegration with credentialsRole so the
    // resource policy permissions from the Cognito authorizer are the only ones needed.
    const apiFn = new lambdaNodejs.NodejsFunction(this, 'ApiFnV2', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambdas/src/api/handler.ts'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        WAIVERS_TABLE: props.tableNames.waivers,
        WAIVER_VERSIONS_TABLE: props.tableNames.waiverVersions,
        MONITOR_SCHEDULES_TABLE: props.tableNames.monitorSchedules,
        WEB_CONTENT_VERSIONS_TABLE: props.tableNames.webContentVersions,
        SETTINGS_TABLE: props.tableNames.settings,
        WEBHOOK_SUBSCRIPTIONS_TABLE: props.tableNames.webhookSubscriptions,
        CORRECTIONS_TABLE: props.tableNames.corrections,
        INGESTION_BUCKET: props.ingestionBucket.bucketName,
        USER_POOL_ID: props.userPoolId,
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      },
      bundling: { externalModules: ['@aws-sdk/*'] },
    });

    // Grant DynamoDB access to all tables
    const tableArns = Object.values(props.tableNames).flatMap((name) => [
      `arn:aws:dynamodb:${this.region}:${this.account}:table/${name}`,
      `arn:aws:dynamodb:${this.region}:${this.account}:table/${name}/index/*`,
    ]);
    apiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:Query', 'dynamodb:Scan'],
      resources: tableArns,
    }));

    // S3 read for source content viewer
    apiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [`${props.ingestionBucket.bucketArn}/*`],
    }));

    // Cognito admin operations for user management
    apiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminSetUserPassword',
        'cognito-idp:AdminAddUserToGroup',
        'cognito-idp:AdminRemoveUserFromGroup',
        'cognito-idp:AdminDisableUser',
        'cognito-idp:AdminEnableUser',
        'cognito-idp:AdminDeleteUser',
        'cognito-idp:ListUsers',
        'cognito-idp:AdminListGroupsForUser',
      ],
      resources: [props.userPoolArn],
    }));

    // Use an IAM role for API Gateway → Lambda invocation instead of per-route Lambda::Permission
    // resources. LambdaIntegration always creates Lambda::Permission even with credentialsRole,
    // so we use AwsIntegration directly to avoid the 20KB resource policy limit.
    const apiGatewayRole = new iam.Role(this, 'ApiGatewayLambdaRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
    });
    apiFn.grantInvoke(apiGatewayRole);

    const apiIntegration = new apigateway.AwsIntegration({
      proxy: true,
      service: 'lambda',
      path: `2015-03-31/functions/${apiFn.functionArn}/invocations`,
      options: {
        credentialsRole: apiGatewayRole,
      },
    });

    // Helper to wire a route to the API Lambda
    const addRoute = (resource: apigateway.Resource, method: string) => {
      resource.addMethod(method, apiIntegration, authOpts);
    };

    const v1 = this.api.root.addResource('v1');

    // --- /v1/waivers ---
    const waivers = v1.addResource('waivers');
    addRoute(waivers, 'GET');

    const waiversActive = waivers.addResource('active');
    addRoute(waiversActive, 'GET');

    const waiversSearch = waivers.addResource('search');
    addRoute(waiversSearch, 'GET');

    const waiverId = waivers.addResource('{id}');
    addRoute(waiverId, 'GET');

    const waiverApprove = waiverId.addResource('approve');
    addRoute(waiverApprove, 'POST');

    const waiverReject = waiverId.addResource('reject');
    addRoute(waiverReject, 'POST');

    const waiverDraft = waiverId.addResource('draft');
    addRoute(waiverDraft, 'PUT');

    const waiverArchive = waiverId.addResource('archive');
    addRoute(waiverArchive, 'POST');

    const waiverReinstate = waiverId.addResource('reinstate');
    addRoute(waiverReinstate, 'POST');

    const waiverVersions = waiverId.addResource('versions');
    addRoute(waiverVersions, 'GET');

    const waiverSource = waiverId.addResource('source');
    addRoute(waiverSource, 'GET');

    // --- /v1/ingestion ---
    const ingestion = v1.addResource('ingestion');

    const uploadFn = new lambdaNodejs.NodejsFunction(this, 'UploadGeneratorFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambdas/src/upload-generator/handler.ts'),
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: { INGESTION_BUCKET: props.ingestionBucket.bucketName },
      bundling: { externalModules: ['@aws-sdk/*'] },
    });
    props.ingestionBucket.grantReadWrite(uploadFn);
    uploadFn.grantInvoke(apiGatewayRole);

    const ingestionUpload = ingestion.addResource('upload');
    ingestionUpload.addMethod('POST', new apigateway.AwsIntegration({
      proxy: true,
      service: 'lambda',
      path: `2015-03-31/functions/${uploadFn.functionArn}/invocations`,
      options: { credentialsRole: apiGatewayRole },
    }), authOpts);

    const webFetcherFn = new lambdaNodejs.NodejsFunction(this, 'WebFetcherApiFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambdas/src/web-fetcher/api-handler.ts'),
      memorySize: 768,
      timeout: cdk.Duration.seconds(45),
      environment: { INGESTION_BUCKET: props.ingestionBucket.bucketName },
      bundling: {
        externalModules: ['@aws-sdk/*'],
        nodeModules: ['@sparticuz/chromium', 'puppeteer-core'],
      },
    });
    props.ingestionBucket.grantWrite(webFetcherFn);
    webFetcherFn.grantInvoke(apiGatewayRole);

    const ingestionWebUrl = ingestion.addResource('web-url');
    ingestionWebUrl.addMethod('POST', new apigateway.AwsIntegration({
      proxy: true,
      service: 'lambda',
      path: `2015-03-31/functions/${webFetcherFn.functionArn}/invocations`,
      options: { credentialsRole: apiGatewayRole },
    }), authOpts);

    // --- Browser Capture Lambda ---
    const browserCaptureFn = new lambdaNodejs.NodejsFunction(this, 'BrowserCaptureFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambdas/src/browser-capture/handler.ts'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: { INGESTION_BUCKET: props.ingestionBucket.bucketName },
      bundling: { externalModules: ['@aws-sdk/*'] },
    });
    props.ingestionBucket.grantWrite(browserCaptureFn);
    browserCaptureFn.grantInvoke(apiGatewayRole);

    const ingestionBrowserCapture = ingestion.addResource('browser-capture');
    ingestionBrowserCapture.addMethod('POST', new apigateway.AwsIntegration({
      proxy: true,
      service: 'lambda',
      path: `2015-03-31/functions/${browserCaptureFn.functionArn}/invocations`,
      options: { credentialsRole: apiGatewayRole },
    }), authOpts);

    // --- /v1/monitoring ---
    const monitoring = v1.addResource('monitoring');
    const monSchedules = monitoring.addResource('schedules');
    addRoute(monSchedules, 'GET');

    const monScheduleId = monSchedules.addResource('{id}');
    addRoute(monScheduleId, 'PUT');
    addRoute(monScheduleId, 'DELETE');

    // --- /v1/dashboard ---
    const dashboard = v1.addResource('dashboard');
    const dashboardMetrics = dashboard.addResource('metrics');
    addRoute(dashboardMetrics, 'GET');

    // --- /v1/settings ---
    const settings = v1.addResource('settings');
    const settingsThreshold = settings.addResource('threshold');
    addRoute(settingsThreshold, 'GET');
    addRoute(settingsThreshold, 'PUT');

    const settingsExtractionFields = settings.addResource('extraction-fields');
    addRoute(settingsExtractionFields, 'GET');
    addRoute(settingsExtractionFields, 'PUT');

    const settingsNotificationRecipients = settings.addResource('notification-recipients');
    addRoute(settingsNotificationRecipients, 'GET');
    addRoute(settingsNotificationRecipients, 'PUT');

    // --- /v1/settings/api-keys ---
    const settingsApiKeys = settings.addResource('api-keys');
    addRoute(settingsApiKeys, 'POST');
    addRoute(settingsApiKeys, 'GET');

    const settingsApiKeyId = settingsApiKeys.addResource('{keyId}');
    addRoute(settingsApiKeyId, 'DELETE');

    // --- /v1/webhooks ---
    const webhooks = v1.addResource('webhooks');
    addRoute(webhooks, 'POST');
    addRoute(webhooks, 'GET');

    const webhookId = webhooks.addResource('{id}');
    addRoute(webhookId, 'DELETE');

    // --- /v1/rules ---
    const rules = v1.addResource('rules');
    addRoute(rules, 'GET');

    const ruleId = rules.addResource('{ruleId}');
    addRoute(ruleId, 'PUT');

    // --- /v1/users ---
    // Reuse the main ApiFnV2 Lambda and apiIntegration (same as all other routes)
    const users = v1.addResource('users');
    addRoute(users, 'GET');
    addRoute(users, 'POST');

    const userName = users.addResource('{username}');
    addRoute(userName, 'DELETE');

    const userRole = userName.addResource('role');
    addRoute(userRole, 'PUT');

    const userDisable = userName.addResource('disable');
    addRoute(userDisable, 'POST');

    const userEnable = userName.addResource('enable');
    addRoute(userEnable, 'POST');

    // --- Public API Lambda ---
    const publicApiFn = new lambdaNodejs.NodejsFunction(this, 'PublicApiFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../lambdas/src/public-api/handler.ts'),
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      environment: {
        WAIVERS_TABLE: props.tableNames.waivers,
        SETTINGS_TABLE: props.tableNames.settings,
        WAIVER_VERSIONS_TABLE: props.tableNames.waiverVersions,
        MONITOR_SCHEDULES_TABLE: props.tableNames.monitorSchedules,
        WEB_CONTENT_VERSIONS_TABLE: props.tableNames.webContentVersions,
        WEBHOOK_SUBSCRIPTIONS_TABLE: props.tableNames.webhookSubscriptions,
        CORRECTIONS_TABLE: props.tableNames.corrections,
        NOTIFICATION_SENDER: `notifications@${this.node.tryGetContext('recipientDomain') ?? 'waivers.example.com'}`,
        INGESTION_BUCKET: props.ingestionBucket.bucketName,
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      },
      bundling: { externalModules: ['@aws-sdk/*'] },
    });

    // Read-only DynamoDB access for public handler
    publicApiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.tableNames.waivers}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.tableNames.waivers}/index/*`,
      ],
    }));

    // Registration endpoint needs PutItem, Scan, and GetItem on Settings table
    publicApiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:PutItem', 'dynamodb:Scan', 'dynamodb:GetItem'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.tableNames.settings}`,
      ],
    }));

    // SES permission for access request notifications
    publicApiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: ['*'],
    }));

    // S3 read for source content viewer
    publicApiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [`${props.ingestionBucket.bucketArn}/*`],
    }));

    const publicApiGatewayRole = new iam.Role(this, 'PublicApiGatewayLambdaRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
    });
    publicApiFn.grantInvoke(publicApiGatewayRole);

    const publicApiIntegration = new apigateway.AwsIntegration({
      proxy: true,
      service: 'lambda',
      path: `2015-03-31/functions/${publicApiFn.functionArn}/invocations`,
      options: {
        credentialsRole: publicApiGatewayRole,
      },
    });
    const apiKeyMethodOpts: apigateway.MethodOptions = { apiKeyRequired: true };

    // --- /v1/public/ ---
    const publicResource = v1.addResource('public');

    const publicWaivers = publicResource.addResource('waivers');
    publicWaivers.addMethod('GET', publicApiIntegration, apiKeyMethodOpts);

    const publicWaiversSearch = publicWaivers.addResource('search');
    publicWaiversSearch.addMethod('GET', publicApiIntegration, apiKeyMethodOpts);

    const publicWaiverId = publicWaivers.addResource('{id}');
    publicWaiverId.addMethod('GET', publicApiIntegration, apiKeyMethodOpts);

    const publicWaiverSource = publicWaiverId.addResource('source');
    publicWaiverSource.addMethod('GET', publicApiIntegration, apiKeyMethodOpts);

    const publicDocs = publicResource.addResource('docs');
    publicDocs.addMethod('GET', publicApiIntegration); // No API key required

    // --- POST /v1/register (public, no auth) ---
    const register = v1.addResource('register');
    register.addMethod('POST', publicApiIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE,
    });

    // --- /v1/registration-requests (admin, Cognito auth) ---
    const registrationRequests = v1.addResource('registration-requests');
    addRoute(registrationRequests, 'GET');

    const registrationRequestId = registrationRequests.addResource('{id}');

    const registrationRequestApprove = registrationRequestId.addResource('approve');
    addRoute(registrationRequestApprove, 'POST');

    const registrationRequestReject = registrationRequestId.addResource('reject');
    addRoute(registrationRequestReject, 'POST');

    // --- Usage Plan ---
    const usagePlan = this.api.addUsagePlan('PublicApiUsagePlan', {
      name: 'PublicApiUsagePlan',
      description: 'Usage plan for public API consumers',
      throttle: {
        rateLimit: 10,
        burstLimit: 20,
      },
      quota: {
        limit: 10000,
        period: apigateway.Period.DAY,
      },
    });
    // Associate usage plan with the stage via CfnUsagePlan to avoid circular dependency
    const cfnUsagePlan = usagePlan.node.defaultChild as cdk.CfnResource;
    cfnUsagePlan.addPropertyOverride('ApiStages', [{
      ApiId: this.api.restApiId,
      Stage: 'prod',
    }]);

    // Grant API Gateway key management permissions to the main API Lambda
    apiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'apigateway:POST',
        'apigateway:DELETE',
        'apigateway:GET',
      ],
      resources: [
        `arn:aws:apigateway:${this.region}::/apikeys`,
        `arn:aws:apigateway:${this.region}::/apikeys/*`,
        `arn:aws:apigateway:${this.region}::/usageplans/${usagePlan.usagePlanId}/*`,
        `arn:aws:apigateway:${this.region}::/usageplans/*/usage`,
      ],
    }));

    // Pass usage plan and API IDs to the main API Lambda
    apiFn.addEnvironment('USAGE_PLAN_ID', usagePlan.usagePlanId);
    apiFn.addEnvironment('REST_API_ID', this.api.restApiId);

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', { value: this.api.url });
    new cdk.CfnOutput(this, 'ApiId', { value: this.api.restApiId });
    new cdk.CfnOutput(this, 'UsagePlanId', { value: usagePlan.usagePlanId });
    new cdk.CfnOutput(this, 'PublicApiBaseUrl', {
      value: `${this.api.url}v1/public/`,
    });
  }
}
