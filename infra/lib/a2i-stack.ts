import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export interface A2iStackProps extends cdk.StackProps {
  ingestionBucket: s3.IBucket;
  userPool: cognito.IUserPool;
}

export class A2iStack extends cdk.Stack {
  public readonly flowDefinitionArn: string;
  public readonly a2iExecutionRole: iam.Role;

  constructor(scope: Construct, id: string, props: A2iStackProps) {
    super(scope, id, props);

    // --- Private Workforce (Cognito-backed) ---
    const workteam = new cdk.aws_sagemaker.CfnWorkteam(this, 'ReviewWorkteam', {
      workteamName: 'waiver-review-team',
      description: 'Private team for waiver human review',
      memberDefinitions: [
        {
          cognitoMemberDefinition: {
            cognitoClientId: '', // Populated at deploy time via context or parameter
            cognitoUserGroup: 'reviewer',
            cognitoUserPool: props.userPool.userPoolId,
          },
        },
      ],
    });

    // Construct the workteam ARN from the workteam name
    const workteamArn = cdk.Fn.sub(
      'arn:aws:sagemaker:${AWS::Region}:${AWS::AccountId}:workteam/private-crowd/${WorkteamName}',
      { WorkteamName: workteam.attrWorkteamName },
    );

    // --- Human Task UI (Liquid template) ---
    // CfnHumanTaskUi is not available as an L1 construct, so we use CfnResource
    const taskUi = new cdk.CfnResource(this, 'WaiverReviewUi', {
      type: 'AWS::SageMaker::HumanTaskUi',
      properties: {
        HumanTaskUiName: 'waiver-review-ui',
        UiTemplate: {
          Content: buildLiquidTemplate(),
        },
      },
    });
    const taskUiArn = taskUi.getAtt('HumanTaskUiArn').toString();

    // --- IAM Role for A2I execution ---
    this.a2iExecutionRole = new iam.Role(this, 'A2iExecutionRole', {
      assumedBy: new iam.ServicePrincipal('sagemaker.amazonaws.com'),
      description: 'Execution role for A2I human review flow',
    });

    props.ingestionBucket.grantRead(this.a2iExecutionRole);
    props.ingestionBucket.grantWrite(this.a2iExecutionRole);

    this.a2iExecutionRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'sagemaker:DescribeFlowDefinition',
        'sagemaker:DescribeHumanLoop',
        'sagemaker:StartHumanLoop',
        'sagemaker:StopHumanLoop',
      ],
      resources: ['*'],
    }));

    // --- A2I Flow Definition ---
    // CfnFlowDefinition is not available as an L1 construct, so we use CfnResource
    const outputPath = `s3://${props.ingestionBucket.bucketName}/a2i-output/`;

    const flowDefinition = new cdk.CfnResource(this, 'WaiverReviewFlow', {
      type: 'AWS::SageMaker::FlowDefinition',
      properties: {
        FlowDefinitionName: 'waiver-review-flow',
        HumanLoopConfig: {
          HumanTaskUiArn: taskUiArn,
          TaskTitle: 'Review Waiver Extraction',
          TaskDescription: 'Review and correct AI-extracted waiver fields',
          TaskCount: 1,
          TaskTimeLimitInSeconds: 3600,
          WorkteamArn: workteamArn,
        },
        OutputConfig: {
          S3OutputPath: outputPath,
        },
        RoleArn: this.a2iExecutionRole.roleArn,
      },
    });

    this.flowDefinitionArn = flowDefinition.getAtt('FlowDefinitionArn').toString();

    // --- Outputs ---
    new cdk.CfnOutput(this, 'FlowDefinitionArn', {
      value: this.flowDefinitionArn,
    });
    new cdk.CfnOutput(this, 'WorkteamArn', {
      value: workteamArn,
    });
  }
}

/**
 * Builds a Liquid HTML template for the A2I human review task UI.
 * Reviewers see the extracted waiver fields and can correct them.
 */
function buildLiquidTemplate(): string {
  return `<script src="https://assets.crowd.aws/crowd-html-elements.js"></script>
<crowd-form>
  <h2>Waiver Review — {{ task.input.recordId }}</h2>
  <p>Overall Confidence: <strong>{{ task.input.overallConfidence }}</strong></p>

  <crowd-input name="airline_code" label="Airline Code"
    value="{{ task.input.airline_code }}" required></crowd-input>

  <crowd-input name="waiver_title" label="Waiver Title"
    value="{{ task.input.waiver_title }}" required></crowd-input>

  <crowd-input name="waiver_code" label="Waiver Code"
    value="{{ task.input.waiver_code }}" required></crowd-input>

  <crowd-input name="effective_date" label="Effective Date"
    value="{{ task.input.effective_date }}" required></crowd-input>

  <crowd-input name="expiration_date" label="Expiration Date"
    value="{{ task.input.expiration_date }}" required></crowd-input>

  <crowd-input name="applicable_routes" label="Applicable Routes (comma-separated)"
    value="{{ task.input.applicable_routes }}"></crowd-input>

  <crowd-input name="fare_classes" label="Fare Classes (comma-separated)"
    value="{{ task.input.fare_classes }}"></crowd-input>

  <crowd-text-area name="rebooking_rules" label="Rebooking Rules"
    value="{{ task.input.rebooking_rules }}"></crowd-text-area>

  <crowd-text-area name="refund_rules" label="Refund Rules"
    value="{{ task.input.refund_rules }}"></crowd-text-area>

  <div style="margin-top:16px">
    <label>Decision:</label>
    <crowd-radio-group name="decision">
      <crowd-radio-button value="approved">Approve</crowd-radio-button>
      <crowd-radio-button value="rejected">Reject</crowd-radio-button>
    </crowd-radio-group>
  </div>

  <crowd-text-area name="rejection_reason" label="Rejection Reason (if rejecting)"
    value=""></crowd-text-area>
</crowd-form>`;
}
