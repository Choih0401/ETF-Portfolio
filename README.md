# ETF Monthly Dividend/Reinvest Dashboard

월 투자금(원화) 기준으로 ETF를 정수주로 매수하고,

- 이번 달 총 투자 가능 금액
- 실제 투자 금액
- 남은 달러
- 실제 배당 수령액
- 다음 달 이월 재투자 금액(남은 달러 + 배당)

을 한눈에 보는 웹 대시보드입니다.

이번 버전은 **서버 로그인(세션 기반)** 과 **회원가입**이 포함되어 있어,
인증된 사용자만 대시보드에 접근하며 기록도 사용자별로 분리 저장됩니다.

## Features

- 정수주 매수 계산 (`floor`) - 소수점 매수 없음
- 이월금 + 배당 재투자 로직
- 월별 저장 기록(서버 파일 저장: `DATA_DIR/records.json`, 사용자별 분리)
- 누적 보유 주수 추적
- 로그인 상태에서 현재가 조회(서버 API)
- 이번 달 주문표 자동 생성
- 전체 요약 카드 + 월별 추이 차트(USD/KRW 토글)
- 서버 세션 로그인 보호 (`/login`)

## Run locally

1) 의존성 설치

```bash
cd /Users/choih0401/tmp/etf-portfolio-dashboard
npm install
```

2) (선택) 부트스트랩 관리자 계정 설정

```bash
cd /Users/choih0401/tmp/etf-portfolio-dashboard
npm run make:hash -- "your-strong-password"
```

- 설정하면 초기 관리자 계정(`ADMIN_USERNAME`)이 생성됩니다.
- 설정하지 않으면 `/signup`에서 첫 계정을 직접 만들 수 있습니다.

3) 환경변수 설정 후 서버 실행

```bash
cd /Users/choih0401/tmp/etf-portfolio-dashboard
export PORT=8080
export ADMIN_USERNAME=admin
# 선택: 부트스트랩 관리자 계정
# export ADMIN_PASSWORD='your-plain-password'
# 또는 export ADMIN_PASSWORD_HASH='scrypt$...'
export SESSION_SECRET='your-long-random-secret'
npm start
```

Open:

- `http://localhost:8080`

로그인 페이지(`/login`) 또는 회원가입(`/signup`) 후 대시보드에 접근됩니다.

## Test

```bash
cd /Users/choih0401/tmp/etf-portfolio-dashboard
npm test
```

## Docker (NAS 권장)

이 앱은 `Dockerfile` + `compose.nas.yml` 기준으로 바로 컨테이너 실행이 가능합니다.
기록 데이터는 컨테이너 내부가 아니라 Docker named volume `etf-dashboard-data`에 저장됩니다.

브라우저에 기존 LocalStorage 기록이 있으면, 최초 접속 시 서버 저장소로 1회 마이그레이션됩니다.

NAS 권한 이슈(`EACCES` 저장 실패)를 피하기 위해 Compose는 컨테이너를 `user: "0:0"`으로 실행합니다.

### A) Container Manager UI + Compose 파일에 env 직접 입력 (요청 방식)

1) `compose.nas.ui.yml`을 열어서 아래 값을 직접 수정

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD` (원문 비밀번호)
- `SESSION_SECRET`
- `PORT` (기본 8080)

2) Synology Container Manager UI에서 프로젝트 생성

- `Container Manager` -> `Project` -> `Create`
- `Create docker-compose.yml` 선택
- 프로젝트 폴더(예: `/volume1/docker/etf-portfolio-dashboard`) 지정
- `compose.nas.ui.yml` 내용 붙여넣기 또는 파일 업로드
- `Build the image` 체크 후 실행

3) 접속

- `http://NAS_IP:8080`

4) 업데이트

- 같은 프로젝트에서 `Action` -> `Rebuild` (또는 compose 재배포)

5) 데이터 위치

- `/data/records.json` (컨테이너 내부 경로)
- 실제 저장소는 Docker named volume `etf-dashboard-data`

원문 비밀번호를 넣으면 서버가 시작 시 내부적으로 해시로 변환해 로그인 검증에 사용합니다.
(`ADMIN_PASSWORD_HASH`가 같이 있으면 해시값이 우선 적용)

> HTTPS 역프록시 뒤에서만 서비스할 경우 `SESSION_COOKIE_SECURE=true`로 고정하는 것을 권장합니다.

### B) 시크릿 파일 주입 방식 (보안 권장)

### 1) NAS용 환경변수 파일 준비

```bash
cd /Users/choih0401/tmp/etf-portfolio-dashboard
cp .env.nas.example .env.nas
```

### 2) 시크릿 파일 준비

```bash
cd /Users/choih0401/tmp/etf-portfolio-dashboard
mkdir -p secrets
cp secrets/admin_password_hash.example secrets/admin_password_hash
cp secrets/session_secret.example secrets/session_secret
```

`secrets/admin_password_hash`는 아래처럼 실제 해시로 교체합니다.

```bash
cd /Users/choih0401/tmp/etf-portfolio-dashboard
npm run make:hash -- "your-strong-password"
```

출력된 한 줄 전체를 `secrets/admin_password_hash` 파일에 넣고,
`secrets/session_secret`도 충분히 긴 랜덤 문자열로 변경하세요.

### 3) 실행 (Compose)

```bash
cd /Users/choih0401/tmp/etf-portfolio-dashboard
docker compose -f compose.nas.yml up -d --build
```

데이터는 volume 내부 `/data/records.json`에 저장됩니다.

접속: `http://NAS_IP:8080`

### 4) 업데이트

```bash
cd /Users/choih0401/tmp/etf-portfolio-dashboard
docker compose -f compose.nas.yml up -d --build
```

### 5) 로그/상태 확인

```bash
docker compose -f compose.nas.yml logs -f
docker compose -f compose.nas.yml ps
```

## Synology NAS 배포 팁

- **아키텍처 확인**
  - NAS SSH에서: `uname -m`
  - 일반적으로 `x86_64`면 `linux/amd64`, `aarch64`면 `linux/arm64`
- **포트/리버스프록시**
  - 외부 공개 시 Synology Reverse Proxy 또는 Nginx 앞단 사용 권장
- **보안**
  - `SESSION_SECRET`는 `secrets/session_secret` 파일로 주입
  - `ADMIN_PASSWORD_HASH`는 `secrets/admin_password_hash` 파일로 주입
  - `SESSION_COOKIE_SECURE=auto` 유지 권장 (HTTPS 역프록시면 secure 쿠키 자동 적용)

### NAS가 레지스트리 접근 어려울 때 (오프라인 전송)

1. 로컬에서 이미지 빌드

```bash
cd /Users/choih0401/tmp/etf-portfolio-dashboard
docker build -t etf-dashboard:latest .
```

2. 이미지 파일로 저장

```bash
docker save etf-dashboard:latest -o etf-dashboard-latest.tar
```

3. NAS로 파일 전송 (`scp` 또는 파일스테이션)
4. NAS에서 로드

```bash
docker load -i etf-dashboard-latest.tar
```

5. NAS에서 실행

```bash
cd /path/to/etf-portfolio-dashboard
cp .env.nas.example .env.nas
mkdir -p secrets
cp secrets/admin_password_hash.example secrets/admin_password_hash
cp secrets/session_secret.example secrets/session_secret
docker compose -f compose.nas.yml up -d
```

## Deploy to your server

Node 프로세스(`npm start`)를 서비스로 띄우고, Nginx를 리버스 프록시로 연결하는 방식이 안전합니다.

예시 (Nginx + Node):

```nginx
server {
  listen 80;
  server_name your-domain.com;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

> HTTPS 환경에서는 `SESSION_SECRET`를 반드시 강한 값으로 설정하세요.

## Usage flow

1. 월 투자금(KRW), 환율, 이월금(USD), 실제 배당(USD) 입력
2. 종목별 비중/현재가 입력
   - 또는 `현재가 조회` 버튼으로 시세 업데이트(서버에서 Stooq 종가 기준 조회)
3. `이번 달 계산/저장`
   - 같은 월이 이미 있으면 자동으로 덮어쓰기(업데이트)
4. 다음 달에는 이월금 칸에 자동 반영된 금액으로 재투자
5. 배당이 늦게 입금되면 `월별 기록`의 배당 수정 칸에서 해당 월 배당을 추가/수정
6. 삭제 버튼 안내
   - `선택 월 기록 삭제`: 입력한 월 1개만 삭제
   - `전체 기록 삭제(모두)`: 저장된 모든 월 삭제

> 배당은 주당 배당 계산 대신, 월별 실제 세후 입금액을 그대로 입력하는 방식입니다.

## Total return (배당 포함) 계산 방식

대시보드의 `총수익률`은 아래 기준으로 계산됩니다.

- `현재 총자산(USD) = 현재 주식 평가금액 + 현재 이월금`
- `누적 원금(USD) = 누적 월 투자금(USD 환산 합계) + 시작 이월금(첫 월 initialCarryInUsd)`
- `총수익(USD, 배당 포함) = 현재 총자산 - 누적 원금`
- `총수익률(%) = 총수익 / 누적 원금 * 100`

배당은 월별 세후 입금액을 기록하고 이월금/재투자로 연결되므로, 위 총자산에 반영되어 수익률에 포함됩니다.
