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
docker run --rm -p 10000:10000 scutta
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
2. 관리자가 없을 때만 최초 관리자 `admin / 1234` 생성
3. FastAPI 서버 시작

재시작과 재배포 때 관리자가 이미 있으면 계정이나 비밀번호를 변경하지 않습니다. 최초 배포 후 다음 순서로 설정합니다.

1. 프론트에서 `admin / 1234`로 로그인
2. **홈 최하단 → 비밀번호 변경**에서 8자 이상의 새 비밀번호로 즉시 변경
3. 선수 관리 화면에서 이번 학기 선수 등록
4. `/health`, 경기 제출, 랭킹 화면 확인
5. 필요하면 **리그전 → 생성**에서 개인 리그 또는 단체전을 편성

관리자는 상대 선택 목록, 랭킹, 정산 집계에 포함되지 않습니다. 학기 초기화를 실행해도 관리자 계정과 변경한 비밀번호는 유지됩니다.

React와 API가 같은 주소를 사용하며 세션 쿠키는 `Secure`, `HttpOnly`, `SameSite=Lax`로 설정됩니다. 따라서 기본 `onrender.com` 주소에서도 iPhone과 Android PWA 로그인이 제3자 쿠키로 취급되지 않습니다. 커스텀 도메인은 선택 사항입니다.

서버는 Render의 전달 헤더를 신뢰하도록 실행되어 로그인 횟수 제한을 실제 접속 IP별로 적용합니다. 이 프록시 신뢰 설정을 Render 외의 공개 서버에서 그대로 사용할 때는 앞단 프록시가 `X-Forwarded-For`를 덮어쓰는지 먼저 확인해야 합니다.

무료 Web Service는 유휴 상태에서 잠들기 때문에 첫 접속이 늦을 수 있습니다. 첫 화면과 API가 같은 프로세스에서 함께 깨어난 뒤에는 정상적으로 동작합니다.

운영 데이터에는 유료 PostgreSQL과 백업 정책을 사용하세요. Render 무료 PostgreSQL은 장기 학기 기록 저장소에 적합하지 않습니다.
