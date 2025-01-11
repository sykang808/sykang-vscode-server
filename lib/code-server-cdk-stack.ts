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
      keyPair: keyPair,
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
      'echo "ChallengeResponseAuthentication no" >> /etc/ssh/sshd_config',
      'systemctl restart sshd'
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
