# SCUTTA

SCUTTA 탁구 동아리의 모바일 경기 기록 서비스입니다. 하나의 GitHub 저장소 안에서 FastAPI 백엔드와 React PWA 프론트엔드를 함께 관리합니다.

```text
scutta/
├─ backend/   FastAPI · SQLAlchemy · Alembic
├─ frontend/  React · TypeScript · Vite · PWA
├─ Dockerfile 단일 운영 이미지
├─ render.yaml
└─ .github/workflows/ci.yml
```

## 주요 기능

- 선수: 로그인 유지, 경기 결과 제출, 최근 경기, 랭킹, 정산 추첨권, 리그전 조회·결과 제출, 비밀번호 변경
- 관리자: 선수 등록·수정·삭제, 비밀번호 초기화, 경기 수정·삭제, 리그전 생성·수정·결과 관리·마감·삭제, 학기 데이터 초기화
- 경기: 서울 날짜 기준으로 같은 두 선수는 하루에 한 경기만 등록 가능
- 랭킹: 선수 계정만 대상으로 경기·승리·패배·상대 수를 누적 집계하며 동점자는 같은 순위로 표시
- 정산: 각 부문 기록 10개당 추첨권 1장과 전체 중 본인의 비율 표시
- 동전 던지기: 한국 날짜 기준 하루 20회 시도. 20회가 남아 시작한 게임에서 아직 앞면·뒷면을 고르지 않았다면, 시작에 사용한 1회를 포함해 총 20회를 소진하고 연속 5회부터 이어갈 수 있음
- 개인 리그: 4~6명이 한 번씩 맞붙는 풀리그. 승수, 동률 선수 간 승수, 전체 세트 득실 순으로 순위를 계산
- 단체전: 4인 팀들이 한 번씩 맞붙는 풀리그. 팀 대결은 4단식으로 진행하고 2:2일 때 각 팀의 단식 패배자 2명이 복식으로 승부 결정

리그전과 단체전의 단식 결과는 일반 경기와 같은 랭킹·정산 기록에 포함됩니다. 복식은 개인 경기 통계에는 포함하지 않습니다. 각 단식도 일반 경기와 동일하게 같은 상대와 하루 한 번만 기록할 수 있습니다.

대회명은 언제든 수정할 수 있습니다. 단체전의 팀 이름도 경기 시작 후 수정할 수 있지만, 참가 선수와 팀 편성은 첫 결과가 등록된 뒤 잠깁니다. 관리자는 마감 후에도 결과를 바로잡을 수 있고, 결과 삭제로 대회가 미완료 상태가 되면 자동으로 진행 상태로 돌아갑니다. 대회를 삭제하면 연결된 단식·복식과 해당 단식이 반영했던 랭킹·정산 기록도 함께 제거되므로 화면에서 정확한 대회명을 다시 입력해야 합니다.

## 코드 구조 원칙

- `backend/app/api`: HTTP 입력, 인증·권한, 상태 코드 처리
- `backend/app/services`: 경기·통계·대회 규칙과 DB 트랜잭션
- `backend/app/schemas`: API 요청·응답 계약
- `frontend/src/pages`: 라우트 단위 화면
- `frontend/src/components`: 여러 화면에서 재사용하는 UI
- `frontend/src/lib`: React와 분리된 변환·검증 로직

현재 규모에서는 이 계층을 더 세분화하지 않습니다. 새 파일은 독립된 도메인이나 여러 화면에서 재사용되는 코드가 생길 때만 추가하고, 한 화면에서만 쓰는 작은 컴포넌트는 해당 페이지 가까이에 둡니다.

## 로컬 실행

백엔드는 Python 3.12, 프론트엔드는 Node.js 24와 pnpm이 필요합니다.

첫 번째 PowerShell:

```powershell
Set-Location backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
Copy-Item .env.example .env
alembic upgrade head
python -m app.cli create-admin --username admin
uvicorn app.main:app --reload
```

두 번째 PowerShell:

```powershell
Set-Location frontend
pnpm install
pnpm dev
```

- 웹: `http://127.0.0.1:5173`
- API 문서: `http://127.0.0.1:8000/docs`
- 상태 확인: `http://127.0.0.1:8000/health`

개발 중 `frontend`의 Vite 서버가 `/api`를 FastAPI로 프록시하므로 `VITE_API_URL`은 비워 둡니다. 별도 API 주소에 직접 연결할 때만 `frontend/.env`에 값을 설정합니다.

운영 이미지는 React를 먼저 빌드한 뒤 FastAPI가 결과물을 같은 origin에서 제공합니다. 로컬에서 운영 이미지 자체를 확인하려면 저장소 루트에서 실행합니다.

```powershell
docker build -t scutta .
$bootstrapSecret = Read-Host "최초 관리자 비밀번호 (8~128자)" -AsSecureString
$env:BOOTSTRAP_ADMIN_PASSWORD = [System.Net.NetworkCredential]::new("", $bootstrapSecret).Password
try {
    docker run --rm -p 10000:10000 --env BOOTSTRAP_ADMIN_PASSWORD scutta
} finally {
    Remove-Item Env:BOOTSTRAP_ADMIN_PASSWORD
}
```

- 통합 웹: `http://127.0.0.1:10000`
- 통합 API: `http://127.0.0.1:10000/api/v1`

## 검사

```powershell
Set-Location backend
ruff check .
ruff format --check .
pytest
alembic check

Set-Location ..\frontend
pnpm lint
pnpm test
pnpm build
pnpm verify:build

Set-Location ..
docker build -t scutta:test .
```

GitHub Actions는 백엔드, 프론트엔드, 최종 Docker 이미지를 각각 검사합니다.

## 모바일·PWA 유지보수

홈 하단과 로그인 화면의 기존 설치 버튼에서 기기별 순서와 메뉴가 보이지 않을 때의 대안을 안내합니다. 안내 문구는 [Apple의 홈 화면 추가 안내](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios)와 [Chrome의 웹 앱 설치 안내](https://support.google.com/chrome/answer/9658361?hl=ko)를 기준으로 확인합니다. 카카오톡 메뉴는 버전에 따라 다를 수 있어 주소를 복사해 외부 브라우저로 여는 방법을 함께 제공합니다.

- 설치 아이콘은 `frontend/public/scutta-logo.png`에서 생성됩니다. 기존 앱의 이름·아이콘·manifest id·scope·start_url은 호환성 변경 없이 유지합니다.
- `coin-mascot-mark.png`는 동전 게임의 CSS 알파 마스크 전용입니다. 파일 최적화 시 표시되지 않는 RGB만 단색화했으며 1254×1254 크기와 모든 알파 값을 보존했습니다. 직접 표시할 컬러 이미지로 전용하지 않습니다. 44·72·88 CSS px, DPR 1·2·3에서 기존 마스크와 렌더링 픽셀 일치를 확인했습니다.
- 업데이트 알림을 닫아도 홈 하단의 **새 버전 업데이트 안내**에서 다시 열 수 있습니다. 대기 중인 업데이트가 있으면 앱을 다시 실행하거나 백그라운드에서 돌아올 때도 알림이 다시 나타납니다. 업데이트는 사용자가 적용 버튼을 눌렀을 때 진행하며, 캐시 정책·로그인 유지 기간은 기존과 같습니다.
- 카카오톡 브라우저로 접속하면 한국 날짜 기준 하루 한 번 설치 추천 알림을 표시합니다. 현재 PWA로 실행 중이면 표시하지 않으며, 업데이트 알림이 우선합니다. 표시 날짜는 해당 브라우저의 localStorage에 저장하고, 저장소를 사용할 수 없으면 자동 추천을 생략합니다. ‘설치 방법’을 누르면 기존 카카오톡용 설치 안내를 엽니다.
- 저장 큐는 앱이 열린 동안만 유지합니다. OS가 앱을 종료하거나 오프라인일 때의 영구 보관·자동 재전송은 제공하지 않습니다.

배포 전 아이폰과 안드로이드의 브라우저·설치 앱에서 로그인, 키보드가 열린 입력/선택, 저장, 게임 종료·복귀, 업데이트를 확인합니다. Chromium의 화면 크기/기기 식별자 모의 검사는 실제 Safari·카카오톡·OS 키보드 검증을 대신하지 않습니다.

## 데이터베이스와 관리자

로컬 기본 DB는 SQLite이고 운영은 PostgreSQL입니다. 모델을 바꾼 뒤에는 새 Alembic revision을 만들고 반드시 검토합니다.

```powershell
Set-Location backend
alembic revision --autogenerate -m "변경 설명"
alembic upgrade head
```

최초 관리자는 마이그레이션 후 한 번 생성합니다. `--password`를 생략하면 안전하게 프롬프트로 입력합니다.

```powershell
python -m app.cli create-admin --username admin
```

상품과 추첨 시점은 `backend/.env` 또는 Render 환경변수의 `SETTLEMENT_PRIZES`, `SETTLEMENT_DRAWS`에서 설정합니다. 학기 초기화는 경기·대회·모든 선수 및 선수 세션을 제거하지만 관리자와 상품 설정은 유지합니다.

## Render 배포

루트의 `render.yaml`을 Blueprint로 연결하면 같은 저장소에서 다음 두 자원을 배포합니다.

- `scutta-app`: React PWA와 FastAPI를 함께 실행하는 무료 Docker Web Service
- `scutta-db`: 1GB 저장공간을 사용하는 유료 PostgreSQL 17

Docker 이미지는 Node 단계에서 React를 빌드하고, Python 단계에서 FastAPI와 빌드 결과만 실행합니다. 브라우저는 화면과 API를 하나의 HTTPS origin에서 사용하므로 별도 `VITE_API_URL`이나 운영 CORS origin 입력이 필요하지 않습니다.

- API Web Service: 무료
- 프론트: 같은 Web Service에 포함되어 추가 비용 없음
- PostgreSQL: `basic-256mb` 컴퓨팅과 1GB 저장공간, 약 `$6.30/월`

무료 Web Service에는 Shell과 pre-deploy 명령이 없으므로, 컨테이너 시작 명령이 다음 순서로 자동 실행됩니다.

1. `alembic upgrade head`로 DB 스키마 반영
2. 관리자가 없을 때만 `BOOTSTRAP_ADMIN_PASSWORD`로 최초 관리자 `admin` 생성
3. FastAPI 서버 시작

**새 DB에 처음 배포할 때는** Blueprint가 요청하는 `BOOTSTRAP_ADMIN_PASSWORD`에 비공개 8~128자 비밀번호를 입력합니다. 공백만으로 된 값은 사용할 수 없습니다. YAML에 실제 값을 적거나 Git에 커밋하지 않습니다. 값이 없거나 유효하지 않으면 관리자를 만들지 않고 서버 시작을 중단합니다. 기존 서비스에 빈 DB를 새로 연결하는 경우에도 Render 환경변수에 직접 설정해야 합니다.

**이미 관리자가 있는 DB는 이 환경변수 없이 재배포할 수 있습니다.** 기존 계정의 비밀번호·인증 버전·로그인 세션을 바꾸지 않습니다. 환경변수를 새로 넣거나 변경해도 기존 관리자 비밀번호는 초기화되지 않습니다. 기존 비밀번호 변경은 로그인 후 **홈 최하단 → 비밀번호 변경**을 사용합니다.

최초 배포 후 다음 순서로 확인합니다.

1. 프론트에서 `admin`과 직접 설정한 비밀번호로 로그인
2. 로그인 확인 후 Render에서 `BOOTSTRAP_ADMIN_PASSWORD`를 제거하고 비밀번호는 안전한 저장소에 보관
3. 선수 관리 화면에서 이번 학기 선수 등록
4. `/health`, 경기 제출, 랭킹 화면 확인
5. 필요하면 **리그전 → 생성**에서 개인 리그 또는 단체전을 편성

관리자는 상대 선택 목록, 랭킹, 정산 집계에 포함되지 않습니다. 학기 초기화를 실행해도 관리자 계정과 변경한 비밀번호는 유지됩니다.

React와 API가 같은 주소를 사용하며 세션 쿠키는 `Secure`, `HttpOnly`, `SameSite=Lax`로 설정됩니다. 따라서 기본 `onrender.com` 주소에서도 iPhone과 Android PWA 로그인이 제3자 쿠키로 취급되지 않습니다. 커스텀 도메인은 선택 사항입니다.

서버는 Render의 전달 헤더를 신뢰하도록 실행되어 로그인 횟수 제한을 실제 접속 IP별로 적용합니다. 이 프록시 신뢰 설정을 Render 외의 공개 서버에서 그대로 사용할 때는 앞단 프록시가 `X-Forwarded-For`를 덮어쓰는지 먼저 확인해야 합니다.

무료 Web Service는 유휴 상태에서 잠들기 때문에 첫 접속이 늦을 수 있습니다. 첫 화면과 API가 같은 프로세스에서 함께 깨어난 뒤에는 정상적으로 동작합니다.

운영 데이터에는 유료 PostgreSQL과 백업 정책을 사용하세요. Render 무료 PostgreSQL은 장기 학기 기록 저장소에 적합하지 않습니다.

초기화 전 백업 확인과 별도 DB 복원 검증 절차는 [운영 점검 절차](backend/OPERATIONS.md)를 참고하세요. 문서는 절차 안내이며 실제 운영 백업이나 복원이 검증됐다는 의미는 아닙니다.
