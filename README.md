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
   - Amazon Linux 2 기반 컨테이너
   - 개발 도구 사전 설치 (Python, Java, Node.js)

   EC2 배포의 경우:

   - Public 서브넷에 EC2 인스턴스 배치
   - Amazon Linux 2023 기반
   - T3.medium 인스턴스 타입
   - 개발 도구 사전 설치 (Python, Java, Node.js)

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
   ssh -i <SSHKeyName>.pem root@<LoadBalancerDNS>
   ```

   EC2 배포의 경우:

   ```bash
   ssh -i <SSHKeyName>.pem ec2-user@<InstancePublicIP>
   ```

## 개발 환경

인스턴스에는 다음과 같은 개발 도구들이 사전 설치되어 있습니다:

### 1. Python 개발 환경

- Python 3 최신 버전
- pip3 (최신 버전)
- virtualenv
- python3-devel (개발 헤더 및 라이브러리)
- setuptools, wheel

사용 예시:

```bash
# 가상환경 생성
python3 -m venv myenv
source myenv/bin/activate

# 패키지 설치
pip install <package-name>
```

### 2. Java 개발 환경

- Amazon Corretto JDK 17
- Maven

사용 예시:

```bash
# Java 버전 확인
java -version

# Maven 프로젝트 생성
mvn archetype:generate
```

### 3. Node.js 개발 환경

- nvm (Node Version Manager)
- Node.js LTS 버전
- npm

사용 예시:

```bash
# EC2의 경우
source /etc/profile  # nvm 활성화

# Node.js 버전 확인
node --version

# 다른 Node.js 버전 설치
nvm install <version>
```

### 4. 기본 개발 도구

- Git
- curl
- wget
- gcc/g++
- make
- Development Tools (EC2의 경우)
- AWS CLI v2

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

2. **VPC Flow Logs**
   - VPC 네트워크 트래픽 모니터링
   - 보안 분석 및 문제 해결에 활용

## 보안 설정

1. SSH 접속 보안

   - 패스워드 인증 비활성화
   - SSH 키 기반 인증만 허용
   - 루트 로그인 비활성화

2. 네트워크 보안

   - 보안 그룹을 통한 SSH 접근 제어
   - VPC Flow Logs를 통한 네트워크 트래픽 모니터링

3. SSH 키 관리
   - SSH 키는 AWS SSM Parameter Store에 안전하게 저장
   - 자동 생성된 키 페어 사용

## 문제 해결

1. **Node.js 관련 문제**

   ```bash
   # nvm 활성화 (EC2의 경우)
   source /etc/profile

   # Node.js 재설치
   nvm install --lts
   ```

2. **Python 가상환경 문제**

   ```bash
   # 가상환경 생성 실패 시
   python3 -m pip install --upgrade virtualenv
   ```

3. **Java 관련 문제**

   ```bash
   # Java 버전 확인
   java -version

   # Maven 설정 확인
   mvn -version
   ```

4. **SSH 접속 문제**
   - 키 파일 권한이 400인지 확인
   - 보안 그룹 인바운드 규칙 확인
   - 올바른 사용자 이름 사용 (EC2: ec2-user, Fargate: root)

## 참고 자료

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/latest/guide/home.html)
- [VS Code Remote Development](https://code.visualstudio.com/docs/remote/remote-overview)
- [Amazon Corretto JDK](https://docs.aws.amazon.com/corretto/latest/corretto-17-ug/what-is-corretto-17.html)
- [Node Version Manager](https://github.com/nvm-sh/nvm)
