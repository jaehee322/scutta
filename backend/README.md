# SCUTTA API

FastAPI와 PostgreSQL로 구현한 SCUTTA 탁구 동아리 백엔드입니다. 전체 실행·배포 방법은 저장소 루트의 `README.md`를 참고하세요.

검증된 버전으로 개발 환경을 설치할 때는 `python -m pip install --constraint constraints.txt -e ".[dev]"`를 사용하고 `python -m pip check`로 의존성을 확인합니다. Docker와 CI도 같은 버전 제약을 사용합니다. 운영자가 코드 수정 없이 수행할 관리와 장애 대응은 [운영 안내](OPERATIONS.md)에 정리되어 있습니다.

같은 상대와 하루 한 번 제한은 `competition_id IS NULL`인 일반 경기(`casual`, `daily`)에만 적용합니다. 개인 리그·단체전 단식의 생성과 관리자 정정은 이 제한에서 제외하며, 같은 대진 중복 제출·단체전 출전자 중복은 각 대회 규칙으로 방지합니다. `20260913_0014` 마이그레이션은 기존 전체 경기 고유 제약을 일반 경기만 대상으로 하는 부분 고유 인덱스로 교체합니다.

대회 API의 현재 상태 계약은 요청 헤더 `X-Competition-Lifecycle: 3`으로 선택합니다. `status`는 `active`(진행 중), `completed`(당일 완료), `closed`(종료)이며, 상태 필터도 같은 값을 사용합니다. 헤더 없는 요청은 업데이트 전 설치 앱을 위해 기존 두 상태로 응답합니다. 이때 실제 완료는 `active`, 실제 종료는 `completed`로 보이며 데이터와 입력 권한은 서버의 실제 상태를 따릅니다.

복식 결과 요청에는 입력창을 열 때의 `expected_doubles`(`id`, `team1_player_ids`, `team2_player_ids`)를 포함합니다. 일반 선수와 관리자 모두 현재 출전자와 다르면 409가 반환되므로 대진을 다시 조회한 후 입력해야 합니다. 이 필드는 기존 앱 호환을 위해 생략 가능하며 현재 프런트엔드는 항상 전송합니다.

개인·단체 순위의 세 번째 기준은 `standings[].sets_won`입니다. 개인은 해당 리그의 모든 기록, 단체는 해당 대회의 모든 단식·복식 점수를 합산하며 패한 경기에서 얻은 세트와 진행 중 팀 대결의 기록도 포함합니다. 단체의 기존 `games_won`, `games_lost`, `game_difference` 필드는 완료된 팀 대결의 경기 수 통계로 유지되며 순위 결정에는 사용하지 않습니다.
