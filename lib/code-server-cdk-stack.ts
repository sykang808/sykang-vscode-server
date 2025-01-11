import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';

export interface CodeServerCdkStackProps extends cdk.StackProps {
  readonly deploymentType: 'ec2' | 'fargate';
}

export class CodeServerCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CodeServerCdkStackProps) {
    super(scope, id, props);

    // VPC 생성
    const vpc = new ec2.Vpc(this, 'DevVpc', {
      maxAzs: 2,
      natGateways: props.deploymentType === 'fargate' ? 1 : 0,
      subnetConfiguration: props.deploymentType === 'fargate'
        ? [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
          },
          {
            name: 'Private',
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            cidrMask: 24,
          },
        ]
        : [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
          },
        ],
      flowLogs: {
        'flow-logs': {
          destination: ec2.FlowLogDestination.toCloudWatchLogs(),
          trafficType: ec2.FlowLogTrafficType.ALL,
        },
      },
    });

    // 고정된 키 이름 사용
    const keyName = `${id}-${props.deploymentType}-key`;

    // 기존 키 페어가 있으면 사용하고, 없으면 새로 생성
    const keyPair = new ec2.CfnKeyPair(this, 'DevKeyPair', {
      keyName: keyName,
    });
    keyPair.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    if (props.deploymentType === 'fargate') {
      // ECS Fargate 설정
      const cluster = new ecs.Cluster(this, 'DevContainerCluster', {
        vpc,
        containerInsights: true,
      });

      // ECS 태스크 보안 그룹
      const taskSecurityGroup = new ec2.SecurityGroup(this, 'TaskSecurityGroup', {
        vpc,
        description: 'Security group for Fargate tasks',
        allowAllOutbound: true,
      });

      // SSH 접속 허용
      taskSecurityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(22),
        'Allow SSH traffic'
      );

      // 태스크 실행 역할
      const executionRole = new iam.Role(this, 'TaskExecutionRole', {
        assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
          iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
        ],
        inlinePolicies: {
          'task-permissions': new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                  'ssm:GetParameters',
                  'ssm:GetParameter',
                  'kms:Decrypt',
                ],
                resources: ['*'],
              }),
            ],
          }),
        },
      });

      // 태스크 역할
      const taskRole = new iam.Role(this, 'TaskRole', {
        assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
        ],
        inlinePolicies: {
          'task-permissions': new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                  'ssm:GetParameters',
                  'ssm:GetParameter',
                  'kms:Decrypt',
                  'ecr:GetAuthorizationToken',
                  'ecr:BatchCheckLayerAvailability',
                  'ecr:GetDownloadUrlForLayer',
                  'ecr:BatchGetImage',
                  'ec2:DescribeKeyPairs',
                  'ec2:GetKeyPair',
                ],
                resources: ['*'],
              }),
            ],
          }),
        },
      });

      // 태스크 정의
      const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
        memoryLimitMiB: 2048,
        cpu: 1024,
        executionRole,
        taskRole,
      });

      // 컨테이너 정의
      taskDefinition.addContainer('dev-container', {
        image: ecs.ContainerImage.fromRegistry('public.ecr.aws/amazonlinux/amazonlinux:2'),
        portMappings: [{ containerPort: 22 }],
        logging: ecs.LogDrivers.awsLogs({
          streamPrefix: 'dev-container',
          logRetention: logs.RetentionDays.ONE_MONTH,
        }),
        environment: {
          'AWS_DEFAULT_REGION': this.region,
          'KEY_NAME': keyName,
        },
        command: [
          '/bin/bash',
          '-c',
          [
            'yum update -y',
            'yum install -y openssh-server git curl wget gcc gcc-c++ make openssl-devel unzip tar procps',
            // Python 설치
            'yum install -y python3 python3-pip python3-devel',
            'pip3 install --upgrade pip setuptools wheel virtualenv',
            // Java 설치
            'yum install -y java-17-amazon-corretto java-17-amazon-corretto-devel maven',
            // Node.js 설치
            'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash',
            'export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm install --lts && nvm use --lts',
            // AWS CLI 설치
            'curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" -s',
            'unzip -q awscliv2.zip',
            './aws/install',
            'rm -rf aws awscliv2.zip',
            'pip3 install setuptools',
            'mkdir -p /run/sshd /root/.ssh',
            'chmod 700 /root/.ssh',
            'ssh-keygen -A',
            'cp /etc/ssh/sshd_config /etc/ssh/sshd_config.original',
            'cat > /etc/ssh/sshd_config << EOL\n' +
            'Port 22\n' +
            'Protocol 2\n' +
            'HostKey /etc/ssh/ssh_host_rsa_key\n' +
            'HostKey /etc/ssh/ssh_host_ecdsa_key\n' +
            'HostKey /etc/ssh/ssh_host_ed25519_key\n' +
            'SyslogFacility AUTHPRIV\n' +
            'PermitRootLogin prohibit-password\n' +
            'PubkeyAuthentication yes\n' +
            'PasswordAuthentication no\n' +
            'ChallengeResponseAuthentication no\n' +
            'GSSAPIAuthentication no\n' +
            'UseDNS no\n' +
            'X11Forwarding no\n' +
            'PrintMotd no\n' +
            'AcceptEnv LANG LC_*\n' +
            'Subsystem sftp /usr/libexec/openssh/sftp-server\n' +
            'EOL',
            'test -f /etc/ssh/sshd_config && chmod 600 /etc/ssh/sshd_config',
            'aws ec2 describe-key-pairs --region $AWS_DEFAULT_REGION --key-names $KEY_NAME --query "KeyPairs[0].KeyPairId" --output text --no-cli-pager | xargs -I {} aws ssm get-parameter --region $AWS_DEFAULT_REGION --name /ec2/keypair/{} --with-decryption --query "Parameter.Value" --output text --no-cli-pager > /root/.ssh/key.pem',
            'chmod 600 /root/.ssh/key.pem',
            'ssh-keygen -y -f /root/.ssh/key.pem > /root/.ssh/authorized_keys',
            'rm -f /root/.ssh/key.pem',
            '/usr/sbin/sshd -D'
          ].join(' && ')
        ],
        essential: true,
      });

      // Network Load Balancer 생성 (public subnet에 위치)
      const nlb = new elbv2.NetworkLoadBalancer(this, 'ServiceNLB', {
        vpc,
        internetFacing: true,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
        crossZoneEnabled: true,
      });

      // 리스너 추가
      const listener = nlb.addListener('SSHListener', {
        port: 22,
      });

      // ECS 서비스
      const service = new ecs.FargateService(this, 'DevContainerService', {
        cluster,
        taskDefinition,
        securityGroups: [taskSecurityGroup],
        desiredCount: 1,
        assignPublicIp: false,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      });

      // 타겟 그룹에 서비스 추가
      listener.addTargets('SSHTargetGroup', {
        port: 22,
        targets: [service],
        healthCheck: {
          enabled: true,
          port: '22',
          protocol: elbv2.Protocol.TCP,
        },
      });

      // Fargate 관련 Output
      new cdk.CfnOutput(this, 'LoadBalancerDNS', {
        value: nlb.loadBalancerDnsName,
        description: 'Network Load Balancer DNS name for SSH connection',
      });

    } else {
      // EC2 설정
      const securityGroup = new ec2.SecurityGroup(this, 'DevInstanceSG', {
        vpc,
        description: 'Security group for development instance',
        allowAllOutbound: true,
      });

      // SSH 접속 허용
      securityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(22),
        'Allow SSH traffic from anywhere'
      );

      // EC2 인스턴스 역할
      const role = new iam.Role(this, 'DevInstanceRole', {
        assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
          iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
        ],
        inlinePolicies: {
          'ec2-permissions': new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                  'ec2:DescribeInstances',
                  'ec2:StartInstances',
                  'ec2:StopInstances',
                  'ec2:ModifyInstanceAttribute',
                  'ssm:GetParameters',
                  'ssm:GetParameter',
                  'kms:Decrypt',
                ],
                resources: ['*'],
              }),
            ],
          }),
        },
      });

      // EC2 인스턴스 생성
      const instance = new ec2.Instance(this, 'DevInstance', {
        vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PUBLIC,
        },
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
        machineImage: ec2.MachineImage.latestAmazonLinux2023(),
        securityGroup: securityGroup,
        keyName: keyPair.keyName,
        role: role,
      });

      // 사용자 데이터 스크립트 추가
      instance.addUserData(
        'dnf update -y',
        // 기본 개발 도구 설치
        'dnf groupinstall -y "Development Tools"',
        'dnf install -y git curl wget gcc gcc-c++ make openssl-devel unzip tar',
        // Python 설치
        'dnf install -y python3 python3-pip python3-devel',
        'pip3 install --upgrade pip setuptools wheel virtualenv',
        // Java 설치
        'dnf install -y java-17-amazon-corretto java-17-amazon-corretto-devel maven',
        // Node.js 설치
        'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash',
        'echo "source /root/.nvm/nvm.sh" >> /etc/profile',
        'export NVM_DIR="$HOME/.nvm"',
        '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"',
        'nvm install --lts',
        'nvm use --lts',
        // AWS CLI 설치
        'curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" -s',
        'unzip -q awscliv2.zip',
        './aws/install',
        'rm -rf aws awscliv2.zip',
        // SSH 보안 설정
        'echo "PermitRootLogin no" >> /etc/ssh/sshd_config',
        'echo "PasswordAuthentication no" >> /etc/ssh/sshd_config',
        'echo "PubkeyAuthentication yes" >> /etc/ssh/sshd_config',
        'systemctl restart sshd'
      );

      // EC2 관련 Output
      new cdk.CfnOutput(this, 'InstancePublicIP', {
        value: instance.instancePublicIp,
        description: 'Public IP address for SSH connection',
      });

      new cdk.CfnOutput(this, 'SSHCommand', {
        value: `ssh -i ${keyPair.keyName}.pem ec2-user@\${InstancePublicIP}`,
        description: 'SSH command to connect to the instance',
      });
    }

    // 공통 Output
    new cdk.CfnOutput(this, 'SSHKeyName', {
      value: keyPair.keyName,
      description: 'Name of SSH key pair',
    });

    new cdk.CfnOutput(this, 'SSHKeyCommand', {
      value: `aws ec2 describe-key-pairs --key-names ${keyPair.keyName} --query 'KeyPairs[0].KeyPairId' --output text | xargs -I {} aws ssm get-parameter --name /ec2/keypair/{} --with-decryption --query 'Parameter.Value' --output text > ${keyPair.keyName}.pem && chmod 400 ${keyPair.keyName}.pem`,
      description: 'Command to retrieve private key',
    });
  }
}
