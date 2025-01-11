#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CodeServerCdkStack } from '../lib/code-server-cdk-stack';

const app = new cdk.App();

// 배포 타입을 context에서 가져옴 (기본값: fargate)
const deploymentType = app.node.tryGetContext('deploymentType') || 'fargate';

// 유효한 배포 타입인지 확인
if (!['ec2', 'fargate'].includes(deploymentType)) {
  throw new Error('deploymentType must be either "ec2" or "fargate"');
}

new CodeServerCdkStack(app, 'CodeServerCdkStack', {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_DEFAULT_REGION 
  },
  deploymentType: deploymentType as 'ec2' | 'fargate',
});
