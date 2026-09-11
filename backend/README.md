# SCUTTA API

FastAPI와 PostgreSQL로 구현한 SCUTTA 탁구 동아리 백엔드입니다. 전체 실행·배포 방법은 저장소 루트의 `README.md`를 참고하세요.

대회 API의 현재 상태 계약은 요청 헤더 `X-Competition-Lifecycle: 3`으로 선택합니다. `status`는 `active`(진행 중), `completed`(당일 완료), `closed`(종료)이며, 상태 필터도 같은 값을 사용합니다. 헤더 없는 요청은 업데이트 전 설치 앱을 위해 기존 두 상태로 응답합니다. 이때 실제 완료는 `active`, 실제 종료는 `completed`로 보이며 데이터와 입력 권한은 서버의 실제 상태를 따릅니다.

복식 결과 요청에는 입력창을 열 때의 `expected_doubles`(`id`, `team1_player_ids`, `team2_player_ids`)를 포함합니다. 일반 선수와 관리자 모두 현재 출전자와 다르면 409가 반환되므로 대진을 다시 조회한 후 입력해야 합니다. 이 필드는 기존 앱 호환을 위해 생략 가능하며 현재 프런트엔드는 항상 전송합니다.

개인·단체 순위의 세 번째 기준은 `standings[].sets_won`입니다. 개인은 해당 리그의 모든 기록, 단체는 해당 대회의 모든 단식·복식 점수를 합산하며 패한 경기에서 얻은 세트와 진행 중 팀 대결의 기록도 포함합니다. 단체의 기존 `games_won`, `games_lost`, `game_difference` 필드는 완료된 팀 대결의 경기 수 통계로 유지되며 순위 결정에는 사용하지 않습니다.
