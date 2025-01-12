# Dev Environment CDK

이 프로젝트는 AWS CDK를 사용하여 EC2 기반의 개발 환경을 구축합니다. VS Code Remote SSH를 통해 원격 개발 환경에 접속할 수 있습니다.

## 아키텍처

### 주요 구성 요소

1. **VPC**

   - 2개의 가용영역(AZ)에 걸친 고가용성 구성
   - 각 AZ에 Public 서브넷
   - VPC Flow Logs 활성화로 네트워크 트래픽 모니터링

2. **EC2 인스턴스**

   - Public 서브넷에 EC2 인스턴스 배치
   - Amazon Linux 2023 기반
   - T3.medium 인스턴스 타입
   - 개발 도구 사전 설치 (Python, Java, Node.js)
   - SSH를 통한 접근

3. **보안**
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
   cdk deploy
   ```

3. 배포가 완료되면 다음 정보가 출력됩니다:

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

시스템 설정:

- Python 패키지 디렉토리에 대한 적절한 권한 설정
- 모든 사용자가 Python 패키지 사용 가능

사용 예시:

```bash
# Python 버전 확인
python3 --version

# 가상환경 생성
python3 -m venv myenv
source myenv/bin/activate

# 패키지 설치
pip install <package-name>

# 시스템 전역 패키지 설치
sudo pip3 install <package-name>
```

### 2. Java 개발 환경

- Amazon Corretto JDK 17
- Maven
- 개발 도구 및 라이브러리

시스템 설정:

- JAVA_HOME이 /usr/lib/jvm/java-17-amazon-corretto로 설정됨
- Java 실행 파일이 시스템 PATH에 추가됨
- 모든 사용자가 Java 개발 도구 사용 가능

사용 예시:

```bash
# Java 버전 확인
java -version
javac -version

# Maven 버전 및 설정 확인
mvn -version

# Maven 프로젝트 생성
mvn archetype:generate

# Java 환경변수 확인
echo $JAVA_HOME
```

### 3. Node.js 개발 환경

- Node.js 20.x LTS 버전 (NodeSource 저장소)
- npm (패키지 매니저)
- yarn (대체 패키지 매니저)
- 글로벌 개발 도구:
  - TypeScript & ts-node (타입스크립트 실행 환경)
  - nodemon (개발 시 자동 재시작)
  - pm2 (프로세스 매니저)
  - @types/node (타입 정의)

시스템 설정:

- NODE_PATH가 /usr/lib/node_modules로 설정됨
- 글로벌 패키지 실행 파일이 PATH에 추가됨
- 모든 사용자가 Node.js와 글로벌 패키지 사용 가능

사용 예시:

```bash
# Node.js 버전 확인
node --version

# 글로벌 패키지 설치
npm install -g <package-name>
yarn global add <package-name>

# TypeScript 프로젝트 실행
ts-node src/index.ts

# 개발 모드로 실행 (자동 재시작)
nodemon src/index.ts

# PM2로 프로세스 관리
pm2 start app.js --name "my-app"
pm2 list
pm2 monit
```

### 4. 기본 개발 도구

- Git
- curl
- wget
- gcc/g++
- make
- Development Tools
- AWS CLI v2

## VS Code Remote SSH 설정

1. VS Code에서 Remote-SSH 확장을 설치합니다.

2. `~/.ssh/config` 파일에 다음 내용을 추가합니다:

   ```
   Host dev-instance
     HostName <your-instance-public-ip>
     User ec2-user
     IdentityFile ~/.ssh/CodeServerCdkStack-key.pem
   ```

3. VS Code 명령 팔레트(F1)에서 "Remote-SSH: Connect to Host"를 선택하고 "dev-instance"를 선택합니다.

## 모니터링

1. **CloudWatch Agent**

   - 자동 설치 및 구성
   - 60초 간격으로 메트릭 수집
   - 수집되는 메트릭:
     - CPU: idle, user, system 사용률
     - 메모리: 총량, 사용량, 사용률
     - 디스크: 총량, 사용량, 사용률
   - root 사용자로 실행되어 모든 시스템 메트릭 접근 가능

2. **CloudWatch Metrics**

   - EC2 기본 메트릭 모니터링
   - CloudWatch Agent를 통한 상세 시스템 메트릭 수집
   - 실시간 리소스 사용량 모니터링
   - 대시보드를 통한 시각화 가능

3. **VPC Flow Logs**
   - VPC 네트워크 트래픽 모니터링
   - 보안 분석 및 문제 해결에 활용
   - CloudWatch Logs에 자동 저장

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
   # Node.js 완전 재설치
   sudo rm -rf /usr/lib/node_modules/*
   sudo dnf remove -y nodejs npm
   sudo dnf clean all && sudo dnf makecache
   curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
   sudo dnf install -y nodejs

   # 글로벌 패키지 재설치
   sudo npm install -g yarn typescript ts-node nodemon pm2 @types/node

   # 권한 재설정
   sudo find /usr/lib/node_modules -type d -exec chmod 755 {} \;
   sudo find /usr/lib/node_modules -type f -exec chmod 644 {} \;
   sudo chmod 755 /usr/bin/node /usr/bin/npm /usr/bin/npx

   # 환경 변수 확인
   echo $NODE_PATH
   node --version
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
   - 올바른 사용자 이름 사용 (ec2-user)

## 참고 자료

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/latest/guide/home.html)
- [VS Code Remote Development](https://code.visualstudio.com/docs/remote/remote-overview)
- [Amazon Corretto JDK](https://docs.aws.amazon.com/corretto/latest/corretto-17-ug/what-is-corretto-17.html)
- [Node Version Manager](https://github.com/nvm-sh/nvm)
