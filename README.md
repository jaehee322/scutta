# Scutta API

탁구 동아리의 선수, 경기, 랭킹과 정산 정보를 관리하는 FastAPI 백엔드입니다. 기본 데이터베이스는 로컬 개발에서 SQLite, 운영에서 PostgreSQL을 사용합니다.

## 로컬 실행

Python 3.12가 필요합니다.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
Copy-Item .env.example .env
alembic upgrade head
uvicorn app.main:app --reload
```

- API 문서: `http://127.0.0.1:8000/docs`
- 상태 확인: `http://127.0.0.1:8000/health`
- 테스트: `pytest`
- 정적 검사: `ruff check .`

운영과 같은 PostgreSQL을 로컬에서 쓸 때는 `.env`의 `DATABASE_URL`만 `postgresql://...`로 바꾸면 됩니다. 애플리케이션이 psycopg 3용 URL로 정규화합니다.

## 데이터베이스 변경

모델을 수정한 뒤 revision을 검토해 커밋합니다.

```powershell
alembic revision --autogenerate -m "변경 설명"
alembic upgrade head
```

운영에서는 애플리케이션 시작 시 테이블을 만들지 않습니다. Render의 pre-deploy 단계가 배포마다 `alembic upgrade head`를 한 번 실행하며, 실패하면 새 버전 배포도 중단됩니다.

## 최초 관리자

마이그레이션 후 최초 한 번 실행합니다. 비밀번호를 명령 기록에 남기고 싶지 않으면 `--password`를 생략하고 프롬프트에서 입력합니다.

```powershell
python -m app.cli create-admin --username admin --password <비밀번호>
```

Render에서는 유료 Web Service의 Shell에서 같은 명령을 실행합니다. 관리자를 만든 뒤에는 관리 API에서 선수 계정을 등록합니다.

## 정산 상품 설정

상품과 추첨 시점은 DB 데이터가 아니라 환경변수입니다.

- `SETTLEMENT_PRIZES`: `matches`, `wins`, `losses`, `opponents` 네 부문의 표시 문구를 담은 JSON 객체
- `SETTLEMENT_DRAWS`: 추첨 시점 이름을 담은 JSON 배열. 기본값은 중간고사 이후와 종강총회

각 부문의 수치 10개당 추첨권 1개로 계산하며 실제 추첨은 외부 도구에서 진행합니다. 상품을 바꾸려면 Render 환경변수를 수정하고 재배포합니다. 학기 데이터 초기화는 이 설정에 영향을 주지 않습니다.

예시:

```dotenv
SETTLEMENT_PRIZES={"matches":"경기 수 상품","wins":"승리 수 상품","losses":"패배 수 상품","opponents":"상대 수 상품"}
```

## 학기 데이터 초기화

초기화 전 `GET /api/v1/admin/database/reset-preview`로 삭제 대상을 확인한 뒤, `POST /api/v1/admin/database/reset`에 확인 문구와 현재 관리자 비밀번호를 보냅니다.

```json
{
  "confirmation": "모든 경기와 선수 데이터를 삭제합니다",
  "admin_password": "현재 관리자 비밀번호"
}
```

초기화하면 다음 데이터가 삭제됩니다.

- 모든 경기
- 모든 대회와 대회 참가 정보
- 모든 선수 계정과 해당 로그인 세션

관리자 계정과 관리자 로그인 세션은 유지됩니다. 상품·추첨 시점은 환경 설정이므로 유지됩니다. 이 작업은 복구 API가 없는 파괴적 작업이므로 운영 DB 백업을 확인한 뒤 실행해야 합니다.

## Render 배포

루트의 `render.yaml`을 Blueprint로 연결하면 Singapore 리전에 다음 자원이 생성됩니다.

- Starter Web Service: Python 3.12.13, `pip install .`, Uvicorn, `/health`
- Basic 256 MB PostgreSQL 17: 외부 접속 차단, 내부 `DATABASE_URL` 자동 연결

Blueprint 생성 화면에서 `CORS_ORIGINS`를 실제 프론트엔드 origin의 JSON 배열로 입력합니다. 경로는 넣지 않습니다.

```json
["https://app.example.com"]
```

운영 기본값은 cross-site 프론트엔드도 쿠키를 보낼 수 있도록 `SameSite=None; Secure`입니다. 프론트엔드는 요청에 credentials를 포함해야 합니다. 프론트와 API를 `app.example.com`, `api.example.com`처럼 같은 사이트로 배치한다면 `SESSION_COOKIE_SAMESITE=lax`로 좁히는 것을 권장합니다.

iPhone/iPad Safari를 포함한 모바일 PWA의 안정적인 로그인 유지를 위해 프론트와 API는 반드시 같은 사이트로 배치하세요. 예를 들어 `app.example.com`과 `api.example.com`처럼 하나의 커스텀 도메인 아래에 두거나, 프론트 도메인에서 `/api`를 API 서비스로 프록시합니다. 서로 다른 `*.onrender.com` 주소끼리는 브라우저가 제3자 쿠키로 취급할 수 있으므로 운영 PWA 구성으로 사용하지 않습니다.

운영의 `CORS_ORIGINS`는 빈 값, `*`, `null`, HTTP 주소를 허용하지 않습니다. 상태 변경 요청은 이 목록과 일치하는 `Origin`만 받아서 쿠키 기반 CSRF도 차단합니다. 로그인은 IP와 사용자 이름 조합별로 기본 5분 동안 5회 실패까지만 허용하며, 사용자당 활성 세션은 최근 5개로 제한됩니다.

> **배포 전 필수:** `render.yaml`은 유료 Web Service와 유료 PostgreSQL을 기본으로 합니다. Render의 무료 PostgreSQL은 생성 후 30일에 만료되고 백업을 제공하지 않으므로 학기 경기 기록 저장소로 사용하지 마세요. `CORS_ORIGINS` 입력, 최초 관리자 생성, DB 백업 정책 설정까지 끝내야 운영 준비가 완료됩니다.

배포가 끝난 뒤 Render Shell에서 최초 관리자를 만들고 `/health`, 로그인 순서로 확인합니다. `/docs`는 개발 환경에서만 노출됩니다. Web Service의 pre-deploy 기능과 Shell은 유료 인스턴스를 전제로 합니다.
