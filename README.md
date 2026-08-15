# SCUTTA

SCUTTA 탁구 동아리의 모바일 경기 기록 서비스입니다. 하나의 GitHub 저장소 안에서 FastAPI 백엔드와 React PWA 프론트엔드를 함께 관리합니다.

```text
scutta/
├─ backend/   FastAPI · SQLAlchemy · Alembic
├─ frontend/  React · TypeScript · Vite · PWA
├─ render.yaml
└─ .github/workflows/ci.yml
```

## 주요 기능

- 선수: 로그인 유지, 경기 결과 제출, 최근 경기, 랭킹, 정산 추첨권, 비밀번호 변경
- 관리자: 선수 등록·수정, 비밀번호 초기화, 경기 수정·삭제, 학기 데이터 초기화
- 경기: 서울 날짜 기준으로 같은 두 선수는 하루에 한 경기만 등록 가능
- 랭킹: 선수 계정만 대상으로 경기·승리·패배·상대 수를 누적 집계하며 동점자는 같은 순위로 표시
- 정산: 각 부문 기록 10개당 추첨권 1장과 전체 중 본인의 비율 표시

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
```

GitHub Actions도 두 디렉터리를 별도 작업으로 검사합니다.

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

루트의 `render.yaml`을 Blueprint로 연결하면 같은 저장소에서 다음 세 자원을 배포합니다.

- `scutta-web`: `frontend/`를 빌드하는 정적 사이트
- `scutta-api`: `backend/`를 실행하는 FastAPI Web Service
- `scutta-db`: PostgreSQL 17

Blueprint 생성 시 아래 값을 설정합니다.

- `VITE_API_URL`: 배포된 API의 HTTPS 주소
- `CORS_ORIGINS`: 프론트 origin을 담은 JSON 배열, 예: `["https://app.example.com"]`
- 정산 상품·추첨 이름이 기본값과 다르면 해당 환경변수 수정

API는 무료 Web Service, PostgreSQL은 유료 `basic-256mb` 인스턴스로 구성됩니다. 무료 Web Service에는 Shell과 pre-deploy 명령이 없으므로, 시작 명령이 다음 순서로 자동 실행됩니다.

1. `alembic upgrade head`로 DB 스키마 반영
2. 관리자가 없을 때만 최초 관리자 `admin / 1234` 생성
3. FastAPI 서버 시작

재시작과 재배포 때 관리자가 이미 있으면 계정이나 비밀번호를 변경하지 않습니다. 최초 배포 후 다음 순서로 설정합니다.

1. 프론트에서 `admin / 1234`로 로그인
2. **내 정보 → 비밀번호 변경**에서 8자 이상의 새 비밀번호로 즉시 변경
3. 선수 관리 화면에서 이번 학기 선수 등록
4. `/health`, 경기 제출, 랭킹 화면 확인

관리자는 상대 선택 목록, 랭킹, 정산 집계에 포함되지 않습니다. 학기 초기화를 실행해도 관리자 계정과 변경한 비밀번호는 유지됩니다.

> **모바일 출시 전 필수:** 프론트와 API를 `app.example.com`, `api.example.com`처럼 같은 커스텀 도메인 아래에 두거나 동일 origin 프록시를 구성하세요. 서로 다른 `*.onrender.com` 주소는 iOS Safari/PWA에서 API 세션 쿠키가 제3자 쿠키로 차단되어 로그인이 동작하지 않을 수 있습니다. 같은 사이트로 배치한 뒤에는 `SESSION_COOKIE_SAMESITE=lax`로 좁힐 수 있습니다.

운영 데이터에는 유료 PostgreSQL과 백업 정책을 사용하세요. Render 무료 PostgreSQL은 장기 학기 기록 저장소에 적합하지 않습니다.
