import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolDomain: cognito.UserPoolDomain;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Cognito User Pool — email sign-in
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Groups: admin, user
    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'admin',
      description: 'Full access to all resources',
    });

    new cognito.CfnUserPoolGroup(this, 'UserGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'user',
      description: 'Read-only access to Dashboard, Waivers, and Reports',
    });

    // Hosted UI domain (uses Cognito prefix domain)
    this.userPoolDomain = this.userPool.addDomain('Domain', {
      cognitoDomain: {
        domainPrefix: cdk.Fn.sub('waiverhub-${AWS::AccountId}'),
      },
    });

    // App client — PKCE authorization code flow for React SPA
    this.userPoolClient = this.userPool.addClient('SpaClient', {
      authFlows: { custom: true, userSrp: true, userPassword: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: ['http://localhost:5173/', 'https://localhost/', 'https://waiverhub.info/'],
        logoutUrls: ['http://localhost:5173/', 'https://localhost/', 'https://waiverhub.info/'],
      },
      generateSecret: false, // PKCE — no client secret for public SPA clients
      accessTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      idTokenValidity: cdk.Duration.hours(1),
    });

    // Stack outputs
    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'UserPoolDomain', {
      value: this.userPoolDomain.domainName,
    });

    // ─── Admin User Provisioning ───────────────────────────────────────
    // After deploying, use the following AWS CLI commands to create the
    // initial admin user. Replace <UserPoolId> with the UserPoolId output
    // from this stack.
    //
    // 1. Create a user:
    //    aws cognito-idp admin-create-user \
    //      --user-pool-id <UserPoolId> \
    //      --username admin@example.com \
    //      --user-attributes Name=email,Value=admin@example.com Name=email_verified,Value=true \
    //      --temporary-password 'TempPass1!'
    //
    // 2. Set a permanent password:
    //    aws cognito-idp admin-set-user-password \
    //      --user-pool-id <UserPoolId> \
    //      --username admin@example.com \
    //      --password 'YourSecurePassword1!' \
    //      --permanent
    //
    // 3. Add the user to the "admin" group:
    //    aws cognito-idp admin-add-user-to-group \
    //      --user-pool-id <UserPoolId> \
    //      --username admin@example.com \
    //      --group-name admin
    // ────────────────────────────────────────────────────────────────────
  }
}
