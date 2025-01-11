#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CodeServerCdkStack } from '../lib/code-server-cdk-stack';

const app = new cdk.App();

new CodeServerCdkStack(app, 'CodeServerCdkStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  },
});
