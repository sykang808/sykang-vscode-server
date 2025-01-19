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
          iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'),
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

      // 사용자 데이터 스크립트 생성
      const userData = ec2.UserData.forLinux();
      userData.addCommands(
        '#!/bin/bash',
        'set -e',
        'exec > >(tee /var/log/user-data.log) 2>&1',
        'echo "[INFO] Starting user data script execution at $(date)"',
        
        'echo "[INFO] === Setting up cloud-init scripts ==="',
        'mkdir -p /var/lib/cloud/scripts/per-boot',
        'cat << \'EOFBOOT\' > /var/lib/cloud/scripts/per-boot/setup.sh',
        '#!/bin/bash',
        'echo "[INFO] Running per-boot script at $(date)" >> /var/log/user-data.log',
        'EOFBOOT',
        'chmod +x /var/lib/cloud/scripts/per-boot/setup.sh',
        
        'echo "[INFO] === System Update ==="',
        'yum update -y',
        'yum groupinstall -y "Development Tools"',
        
        'echo "[INFO] === Installing Python ==="',
        'yum install -y python3 python3-pip python3-devel',
        
        'echo "[INFO] === Installing Java ==="',
        'yum install -y java-17-amazon-corretto java-17-amazon-corretto-devel maven',
        
        'echo "[INFO] === Installing Git and other utilities ==="',
        'yum install -y git tar',
        
        'echo "[INFO] === Setting up environment for ec2-user ==="',
        'su - ec2-user -c "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"',
        
        'cat << \'EOF\' >> /home/ec2-user/.bashrc',
        '# Python settings',
        'export PATH=$PATH:$HOME/.local/bin',
        '',
        '# NVM settings',
        'export NVM_DIR="$HOME/.nvm"',
        '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"',
        '[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"',
        '',
        '# Java settings',
        'export JAVA_HOME=/usr/lib/jvm/java-17-amazon-corretto',
        'export PATH=$PATH:$JAVA_HOME/bin',
        'EOF',
        
        'chown ec2-user:ec2-user /home/ec2-user/.bashrc',
        
        'echo "[INFO] === Installing Node.js ==="',
        'su - ec2-user -c "source ~/.nvm/nvm.sh && nvm install --lts"',
        
        'echo "[INFO] === Installation Complete ==="',
        'echo "[INFO] User data script completed successfully at $(date)"',
        '/var/lib/cloud/scripts/per-boot/setup.sh'
      );

      // EC2 인스턴스 생성
      const instance = new ec2.Instance(this, 'DevInstance', {
        vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PUBLIC,
        },
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.LARGE),
        machineImage: ec2.MachineImage.latestAmazonLinux2023(),
        securityGroup: securityGroup,
        keyPair: keyPair,
        role: role,
        requireImdsv2: true, // IMDSv2 강제 적용
        userData: userData, // userdata를 인스턴스 생성 시 직접 전달
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
