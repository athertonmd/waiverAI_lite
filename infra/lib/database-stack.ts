import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class DatabaseStack extends cdk.Stack {
  public readonly waiversTable: dynamodb.Table;
  public readonly waiverVersionsTable: dynamodb.Table;
  public readonly monitorSchedulesTable: dynamodb.Table;
  public readonly webContentVersionsTable: dynamodb.Table;
  public readonly settingsTable: dynamodb.Table;
  public readonly webhookSubscriptionsTable: dynamodb.Table;
  public readonly correctionsTable: dynamodb.Table;

  public readonly waiversTableName: string;
  public readonly waiverVersionsTableName: string;
  public readonly monitorSchedulesTableName: string;
  public readonly webContentVersionsTableName: string;
  public readonly settingsTableName: string;
  public readonly webhookSubscriptionsTableName: string;
  public readonly correctionsTableName: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // --- Waivers table ---
    this.waiversTable = new dynamodb.Table(this, 'WaiversTable', {
      tableName: `${this.stackName}-Waivers`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    this.waiversTable.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.waiversTable.addGlobalSecondaryIndex({
      indexName: 'airline_code-index',
      partitionKey: { name: 'airline_code', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.waiversTable.addGlobalSecondaryIndex({
      indexName: 'airline_code-waiver_code-index',
      partitionKey: { name: 'airline_code', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'waiver_code', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- WaiverVersions table ---
    this.waiverVersionsTable = new dynamodb.Table(this, 'WaiverVersionsTable', {
      tableName: `${this.stackName}-WaiverVersions`,
      partitionKey: { name: 'waiver_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'version_number', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // --- MonitorSchedules table ---
    this.monitorSchedulesTable = new dynamodb.Table(this, 'MonitorSchedulesTable', {
      tableName: `${this.stackName}-MonitorSchedules`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.monitorSchedulesTable.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- WebContentVersions table ---
    this.webContentVersionsTable = new dynamodb.Table(this, 'WebContentVersionsTable', {
      tableName: `${this.stackName}-WebContentVersions`,
      partitionKey: { name: 'schedule_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'fetched_at', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // --- Settings table ---
    this.settingsTable = new dynamodb.Table(this, 'SettingsTable', {
      tableName: `${this.stackName}-Settings`,
      partitionKey: { name: 'key', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // --- WebhookSubscriptions table ---
    this.webhookSubscriptionsTable = new dynamodb.Table(this, 'WebhookSubscriptionsTable', {
      tableName: `${this.stackName}-WebhookSubscriptions`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // --- Corrections table (few-shot learning from human corrections) ---
    this.correctionsTable = new dynamodb.Table(this, 'CorrectionsTable', {
      tableName: `${this.stackName}-Corrections`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.correctionsTable.addGlobalSecondaryIndex({
      indexName: 'created_at-index',
      partitionKey: { name: 'source_type', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Export table names
    this.waiversTableName = this.waiversTable.tableName;
    this.waiverVersionsTableName = this.waiverVersionsTable.tableName;
    this.monitorSchedulesTableName = this.monitorSchedulesTable.tableName;
    this.webContentVersionsTableName = this.webContentVersionsTable.tableName;
    this.settingsTableName = this.settingsTable.tableName;
    this.webhookSubscriptionsTableName = this.webhookSubscriptionsTable.tableName;
    this.correctionsTableName = this.correctionsTable.tableName;

    new cdk.CfnOutput(this, 'WaiversTableName', { value: this.waiversTableName });
    new cdk.CfnOutput(this, 'WaiverVersionsTableName', { value: this.waiverVersionsTableName });
    new cdk.CfnOutput(this, 'MonitorSchedulesTableName', { value: this.monitorSchedulesTableName });
    new cdk.CfnOutput(this, 'WebContentVersionsTableName', { value: this.webContentVersionsTableName });
    new cdk.CfnOutput(this, 'SettingsTableName', { value: this.settingsTableName });
    new cdk.CfnOutput(this, 'WebhookSubscriptionsTableName', { value: this.webhookSubscriptionsTableName });
    new cdk.CfnOutput(this, 'CorrectionsTableName', { value: this.correctionsTableName });
  }
}
