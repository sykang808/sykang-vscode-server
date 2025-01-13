import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface CodeServerCdkStackProps extends cdk.StackProps {
}

export class CodeServerCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CodeServerCdkStackProps) {
    super(scope, id, props);

    // VPC 생성
    const vpc = new ec2.Vpc(this, 'DevVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
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
    const keyName = `${id}-key`;

    // 키 페어 생성
    const cfnKeyPair = new ec2.CfnKeyPair(this, 'DevKeyPair', {
      keyName: keyName,
    });
    cfnKeyPair.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // IKeyPair 인터페이스를 구현하는 KeyPair 객체 생성
    const keyPair = ec2.KeyPair.fromKeyPairName(this, 'ImportedKeyPair', keyName);

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
        iam.ManagedPolicy.fromAwsManagedPolicyName('AWSCloudFormationFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2FullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('IAMFullAccess'),
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

    // VPC 엔드포인트 생성
    new ec2.InterfaceVpcEndpoint(this, 'SSMEndpoint', {
      vpc,
      service: ec2.InterfaceVpcEndpointAwsService.SSM,
      privateDnsEnabled: true,
    });

    new ec2.InterfaceVpcEndpoint(this, 'SSMMessagesEndpoint', {
      vpc,
      service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
      privateDnsEnabled: true,
    });

    new ec2.InterfaceVpcEndpoint(this, 'EC2MessagesEndpoint', {
      vpc,
      service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
      privateDnsEnabled: true,
    });

    // 보안 그룹 규칙 강화
    securityGroup.addIngressRule(
      ec2.Peer.ipv4('0.0.0.0/0'),
      ec2.Port.tcp(443),
      'Allow HTTPS traffic for SSM'
    );

    // EC2 인스턴스 생성
    const instance = new ec2.Instance(this, 'DevInstance', {
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup: securityGroup,
      keyPair: keyPair,
      role: role,
      requireImdsv2: true, // IMDSv2 강제 적용
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(30, {
            encrypted: true, // EBS 암호화 활성화
            volumeType: ec2.EbsDeviceVolumeType.GP3,
          }),
        },
      ],
    });

    // 태그 추가
    cdk.Tags.of(instance).add('Environment', 'Development');
    cdk.Tags.of(instance).add('SecurityLevel', 'High');

    // 사용자 데이터 스크립트 추가
    instance.addUserData(
      '#!/bin/bash',
      'exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1',
      'set -e',
      'echo "=== Starting user data script ==="',

      'echo "=== Updating system packages ==="',
      'dnf update -y',

      'echo "=== Installing development tools ==="',
      'dnf groupinstall -y "Development Tools"',
      'dnf install -y git curl wget gcc gcc-c++ make openssl-devel unzip tar',

      'echo "=== Setting up Python environment ==="',
      'dnf install -y python3 python3-pip python3-devel',
      'python3 -m pip install --upgrade pip setuptools wheel virtualenv',
      'find /usr/local/lib/python3.* -type d -exec chmod 755 {} \\;',

      'echo "=== Setting up Java environment ==="',
      'dnf install -y java-17-amazon-corretto java-17-amazon-corretto-devel maven',
      'cat > /etc/profile.d/java.sh << \'EOF\'',
      'export JAVA_HOME=/usr/lib/jvm/java-17-amazon-corretto',
      'export PATH=$PATH:$JAVA_HOME/bin',
      'EOF',
      'chmod +x /etc/profile.d/java.sh',
      'source /etc/profile.d/java.sh',

      'echo "=== Setting up Node.js environment ==="',
      'rm -rf /usr/lib/node_modules/*',
      'dnf remove -y nodejs npm',
      'dnf clean all && dnf makecache',
      'curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -',
      'dnf install -y nodejs',
      'npm config set unsafe-perm true',
      'npm install -g yarn typescript ts-node nodemon pm2 @types/node',
      'find /usr/lib/node_modules -type d -exec chmod 755 {} \\;',
      'find /usr/lib/node_modules -type f -exec chmod 644 {} \\;',
      'chmod 755 /usr/bin/node /usr/bin/npm /usr/bin/npx',
      'cat > /etc/profile.d/nodejs.sh << \'EOF\'',
      'export NODE_PATH=/usr/lib/node_modules',
      'export PATH=$PATH:/usr/lib/node_modules/.bin',
      'EOF',
      'chmod +x /etc/profile.d/nodejs.sh',
      'source /etc/profile.d/nodejs.sh',
      'echo "=== Setting up CloudWatch Agent ==="',
      'dnf install -y amazon-cloudwatch-agent',
      'cat > /opt/aws/amazon-cloudwatch-agent/bin/config.json << \'EOF\'',
      '{',
      '  "agent": {',
      '    "metrics_collection_interval": 60,',
      '    "run_as_user": "root",',
      '    "logfile": "/opt/aws/amazon-cloudwatch-agent/logs/amazon-cloudwatch-agent.log"',
      '  },',
      '  "metrics": {',
      '    "metrics_collected": {',
      '      "cpu": {',
      '        "measurement": [',
      '          "cpu_usage_idle",',
      '          "cpu_usage_user",',
      '          "cpu_usage_system"',
      '        ],',
      '        "metrics_collection_interval": 60,',
      '        "totalcpu": true',
      '      },',
      '      "disk": {',
      '        "measurement": [',
      '          "used_percent",',
      '          "used",',
      '          "total"',
      '        ],',
      '        "metrics_collection_interval": 60,',
      '        "resources": ["*"]',
      '      },',
      '      "mem": {',
      '        "measurement": [',
      '          "mem_used_percent",',
      '          "mem_total",',
      '          "mem_used"',
      '        ],',
      '        "metrics_collection_interval": 60',
      '      }',
      '    }',
      '  },',
      '  "logs": {',
      '    "logs_collected": {',
      '      "files": {',
      '        "collect_list": [',
      '          {',
      '            "file_path": "/var/log/messages",',
      '            "log_group_name": "/ec2/system/messages",',
      '            "log_stream_name": "{instance_id}",',
      '            "retention_in_days": 7',
      '          },',
      '          {',
      '            "file_path": "/var/log/secure",',
      '            "log_group_name": "/ec2/system/secure",',
      '            "log_stream_name": "{instance_id}",',
      '            "retention_in_days": 7',
      '          },',
      '          {',
      '            "file_path": "/var/log/user-data.log",',
      '            "log_group_name": "/ec2/user-data",',
      '            "log_stream_name": "{instance_id}",',
      '            "retention_in_days": 7',
      '          }',
      '        ]',
      '      }',
      '    }',
      '  }',
      '}',
      'EOF',
      '/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/bin/config.json',
      'systemctl enable amazon-cloudwatch-agent',
      'systemctl start amazon-cloudwatch-agent',

      'echo "=== Installing AWS CLI ==="',
      'curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" -s',
      'unzip -q awscliv2.zip',
      './aws/install',
      'rm -rf aws awscliv2.zip',

      'echo "=== Configuring SSH security ==="',
      'echo "PermitRootLogin no" >> /etc/ssh/sshd_config',
      'echo "PasswordAuthentication no" >> /etc/ssh/sshd_config',
      'echo "PubkeyAuthentication yes" >> /etc/ssh/sshd_config',
      'echo "ChallengeResponseAuthentication no" >> /etc/ssh/sshd_config',
      'systemctl restart sshd',

      'echo "=== User data script completed ==="'
    );

    // EC2 관련 Output
    new cdk.CfnOutput(this, 'InstancePublicIP', {
      value: instance.instancePublicIp,
      description: 'Public IP address for SSH connection',
    });

    new cdk.CfnOutput(this, 'SSHCommand', {
      value: `ssh -i ${keyName}.pem ec2-user@\${InstancePublicIP}`,
      description: 'SSH command to connect to the instance',
    });
    // Output
    new cdk.CfnOutput(this, 'SSHKeyName', {
      value: keyName,
      description: 'Name of SSH key pair',
    });

    new cdk.CfnOutput(this, 'SSHKeyCommand', {
      value: `aws ec2 describe-key-pairs --key-names ${keyName} --query 'KeyPairs[0].KeyPairId' --output text | xargs -I {} aws ssm get-parameter --name /ec2/keypair/{} --with-decryption --query 'Parameter.Value' --output text > ${keyName}.pem && chmod 400 ${keyName}.pem`,
      description: 'Command to retrieve private key',
    });
  }
}
