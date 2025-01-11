# Dev Environment CDK

이 프로젝트는 AWS CDK를 사용하여 개발 환경을 구축합니다. ECS Fargate 또는 EC2를 선택하여 배포할 수 있으며, VS Code Remote SSH를 통해 원격 개발 환경에 접속할 수 있습니다.

## 아키텍처

### 주요 구성 요소

1. **VPC**

   - 2개의 가용영역(AZ)에 걸친 고가용성 구성
   - VPC Flow Logs 활성화로 네트워크 트래픽 모니터링

   Fargate 배포의 경우:

   - 각 AZ에 Public 및 Private 서브넷
   - NAT Gateway를 통한 Private 서브넷의 외부 통신

   EC2 배포의 경우:

   - 각 AZ에 Public 서브넷

2. **컴퓨팅 (Fargate 또는 EC2)**

   Fargate 배포의 경우:

   - Private 서브넷에 컨테이너 배치
   - Container Insights 활성화로 모니터링 강화
   - CloudWatch Logs 통합
   - Amazon Linux 2 기반 컨테이너 (AWS CLI 기본 설치)
   - SSH 서버 실행

   EC2 배포의 경우:

   - Public 서브넷에 EC2 인스턴스 배치
   - Amazon Linux 2 기반 (AWS CLI 기본 설치)
   - T3.medium 인스턴스 타입
   - SSH 서버 설정

3. **네트워크 접근**

   Fargate 배포의 경우:

   - Network Load Balancer 사용
   - Public 서브넷에 위치
   - SSH 트래픽 처리 (포트 22)
   - TCP 기반 상태 확인

   EC2 배포의 경우:

   - 퍼블릭 IP 직접 할당
   - SSH 포트(22) 직접 접근

4. **보안**
   - SSH 키 기반 인증
   - 세분화된 보안 그룹 규칙
   - IAM 역할 및 정책 최소 권한 원칙 적용
   - VPC Flow Logs를 통한 네트워크 트래픽 모니터링

## 사전 요구 사항

- Node.js 14.x 이상
- AWS CLI 구성 및 인증 완료
- AWS CDK CLI 설치
  ```bash
  npm install -g aws-cdk
  ```
- Visual Studio Code 설치
- VS Code Remote - SSH 확장 설치

## 설치 및 배포

1. 프로젝트 클론 및 의존성 설치

   ```bash
   git clone <repository-url>
   cd code-server-cdk
   npm install
   ```

2. CDK 배포

   ```bash
   # Fargate로 배포 (기본값)
   cdk deploy

   # EC2로 배포
   cdk deploy -c deploymentType=ec2
   ```

3. 배포가 완료되면 다음 정보가 출력됩니다:

   Fargate 배포의 경우:

   - Network Load Balancer의 DNS 이름
   - SSH 키 페어 이름
   - SSH 키 다운로드 명령어

   EC2 배포의 경우:

   - EC2 인스턴스의 퍼블릭 IP 주소
   - SSH 키 페어 이름
   - SSH 키 다운로드 명령어
   - SSH 접속 명령어

4. SSH 키를 다운로드하고 설정합니다:

   ```bash
   # CloudFormation 출력의 SSHKeyCommand 값을 실행하여 키 다운로드
   aws ec2 describe-key-pairs --key-names <SSHKeyName> --query 'KeyPairs[0].KeyPairId' --output text | \
   xargs -I {} aws ssm get-parameter --name /ec2/keypair/{} --with-decryption --query 'Parameter.Value' --output text > <SSHKeyName>.pem

   # 키 파일 권한 설정
   chmod 400 <SSHKeyName>.pem
   ```

5. SSH로 접속:

   Fargate 배포의 경우:

   ```bash
   ssh -i <SSHKeyName>.pem ec2-user@<LoadBalancerDNS>
   ```

   EC2 배포의 경우:

   ```bash
   ssh -i <SSHKeyName>.pem ec2-user@<InstancePublicIP>
   ```

   > 참고: CloudFormation 출력에서 SSHCommand 값을 확인하여 정확한 접속 명령어를 사용할 수 있습니다.

## VS Code Remote SSH 설정

1. VS Code에서 Remote-SSH 확장을 설치합니다.

2. `~/.ssh/config` 파일에 다음 내용을 추가합니다:

   Fargate 배포의 경우:

   ```
   Host dev-container
     HostName <your-nlb-dns-name>
     User root
     IdentityFile /pathto/<SSHKeyName>.pem
   ```

   EC2 배포의 경우:

   ```
   Host dev-instance
     HostName <your-instance-public-ip>
     User ec2-user
     IdentityFile /pathto/<SSHKeyName>.pem
   ```

3. VS Code 명령 팔레트(F1)에서 "Remote-SSH: Connect to Host"를 선택하고 배포 타입에 따라 "dev-container" 또는 "dev-instance"를 선택합니다.

## 환경 설정

개발 환경에는 다음 도구들이 기본적으로 설치되어 있습니다:

- Git
- curl
- wget
- gcc/gcc-c++
- make
- AWS CLI (기본 설치)

추가 도구가 필요한 경우 SSH 접속 후 `yum install`을 통해 설치할 수 있습니다.

## 모니터링

Fargate 배포의 경우:

1. **Container Insights**

   - ECS 콘솔에서 Container Insights를 통해 컨테이너 메트릭 확인
   - CPU, 메모리, 네트워크 사용량 등 모니터링

2. **CloudWatch Logs**

   - 컨테이너 로그는 CloudWatch Logs에서 확인 가능
   - 로그 그룹: `/aws/ecs/dev-container`

EC2 배포의 경우:

1. **CloudWatch Metrics**

   - EC2 메트릭을 통해 인스턴스 상태 확인
   - CPU, 메모리, 네트워크 사용량 등 모니터링

2. **CloudWatch Logs**

   - 시스템 로그 및 애플리케이션 로그 확인 가능
   - EC2 인스턴스에서 CloudWatch Logs 에이전트 설정 필요

공통:

1. **VPC Flow Logs**
   - VPC 네트워크 트래픽 모니터링
   - 보안 분석 및 문제 해결에 활용

## 비용 최적화

Fargate 배포의 경우:

1. Fargate Spot 사용 고려
2. 사용하지 않는 시간대에 서비스 중지

EC2 배포의 경우:

1. Spot 인스턴스 사용 고려
2. 자동 중지/시작 스케줄링 설정

## 문제 해결

Fargate 배포의 경우:

1. **SSH 접속 불가**

   - 보안 그룹 인바운드 규칙 확인
   - NLB 대상 그룹 상태 확인
   - ECS 서비스 상태 확인
   - 컨테이너 로그 확인
   - SSH 키 파일 권한이 400인지 확인

2. **성능 이슈**
   - Container Insights에서 리소스 사용량 확인
   - ECS 서비스 이벤트 확인
   - CloudWatch 로그에서 오류 확인

EC2 배포의 경우:

1. **SSH 접속 불가**

   - 보안 그룹 인바운드 규칙 확인
   - 인스턴스 상태 확인
   - 시스템 로그 확인
   - SSH 키 파일 권한이 400인지 확인
   - 인스턴스 네트워크 설정 확인

2. **성능 이슈**
   - CloudWatch 메트릭에서 리소스 사용량 확인
   - 시스템 로그에서 오류 확인
   - 인스턴스 상태 점검 결과 확인

## 보안 설정

1. SSH 접속 보안

   - 패스워드 인증이 비활성화되어 있음
   - SSH 키 기반 인증만 허용
   - PermitRootLogin이 prohibit-password로 설정되어 있음

2. 접속 제한

   - 특정 IP 대역에서만 접속을 허용하려면 보안 그룹 규칙 수정
   - 기본적으로 모든 IP에서 SSH 접속 가능

3. SSH 키 관리
   - SSH 키는 AWS SSM Parameter Store에 안전하게 저장됨
   - 필요한 경우 새로운 키 페어 생성 가능

## 참고 자료

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/latest/guide/home.html)
- [VS Code Remote Development](https://code.visualstudio.com/docs/remote/remote-overview)
- [ECS Best Practices](https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/intro.html)
