# 20인 대회 샘플: 적용 완료

사용 선수: test1 ~ test20 (기존 계정 유지)
관리자: local-admin
백업: C:\Users\jaehe\scutta\backend\.backups\before-competition-demo-20260910-231407-842060.db

| 대회 | 상태 | 진행 | 확인 내용 |
|---|---|---|---|
| [단체01 · 미시작](http://127.0.0.1:8000/competitions/22) | active | 0/10 | 5팀 편성, 전체 대진, 결과 입력 전 상태 |
| [단체02 · 단식 진행](http://127.0.0.1:8000/competitions/23) | active | 0/10 | 서로 다른 대결의 단식 1·2·3개 진행 |
| [단체03 · 3대1 승부](http://127.0.0.1:8000/competitions/24) | active | 1/10 | 4단식 완료, 복식 없이 승부 결정 |
| [단체04 · 4대0 완승](http://127.0.0.1:8000/competitions/25) | active | 1/10 | 4단식 전승, 상대 팀 방향의 승리 표시 |
| [단체05 · 복식 대기](http://127.0.0.1:8000/competitions/26) | active | 0/10 | 10대결 모두 2:2, 패배자 복식 자동 선정 |
| [단체06 · 혼합 진행](http://127.0.0.1:8000/competitions/27) | active | 3/10 | 3:1·4:0·복식 완료·복식 대기·부분 단식 혼합 |
| [단체07 · 마감 직전](http://127.0.0.1:8000/competitions/28) | active | 9/10 | 마지막 복식 대기, 미완료 마감 요청 거절 |
| [단체08 · 전원 동률·마감 대기](http://127.0.0.1:8000/competitions/29) | active | 10/10 | 5팀 모두 2승2패, 동일 득실, 공동 1위 |
| [단체09 · 마감 완료](http://127.0.0.1:8000/competitions/30) | completed | 10/10 | 다양한 점수와 복식 승부 후 마감 |
| [단체10 · 정정 후 재개](http://127.0.0.1:8000/competitions/31) | active | 9/10 | 마감 후 단식 승패 정정으로 복식 생성·재개 |
| [개인 5인조 · A조 · 미시작](http://127.0.0.1:8000/competitions/32) | active | 0/10 | 미시작 |
| [개인 5인조 · B조 · 초반 진행](http://127.0.0.1:8000/competitions/33) | active | 3/10 | 초반 진행 |
| [개인 5인조 · C조 · 마감 직전](http://127.0.0.1:8000/competitions/34) | active | 9/10 | 마감 직전 |
| [개인 5인조 · D조 · 전원 동률·마감 대기](http://127.0.0.1:8000/competitions/35) | active | 10/10 | 전원 동률·마감 대기 |
| [개인 4인조 · A조 · 미시작](http://127.0.0.1:8000/competitions/36) | active | 0/6 | 미시작 |
| [개인 4인조 · B조 · 초반 진행](http://127.0.0.1:8000/competitions/37) | active | 2/6 | 초반 진행 |
| [개인 4인조 · C조 · 마감 완료](http://127.0.0.1:8000/competitions/38) | completed | 6/6 | 마감 완료 |
| [개인 4인조 · D조 · 삭제 후 재개](http://127.0.0.1:8000/competitions/39) | active | 5/6 | 삭제 후 재개 |
| [개인 4인조 · E조 · 마감 후 승패 정정](http://127.0.0.1:8000/competitions/40) | completed | 6/6 | 마감 후 승패 정정 |
| [개인 6·6·4·4인조 · A조 · 첫 라운드](http://127.0.0.1:8000/competitions/41) | active | 3/15 | 첫 라운드 |
| [개인 6·6·4·4인조 · B조 · 마감 대기](http://127.0.0.1:8000/competitions/42) | active | 15/15 | 마감 대기 |
| [개인 6·6·4·4인조 · C조 · 미시작](http://127.0.0.1:8000/competitions/43) | active | 0/6 | 미시작 |
| [개인 6·6·4·4인조 · D조 · 마감 후 날짜 정정](http://127.0.0.1:8000/competitions/44) | completed | 6/6 | 마감 후 날짜 정정 |

기존 계정·세션·일반 경기·미니게임·설정 행 fingerprint 일치.
SQLite integrity_check=ok, foreign_key_check 이상 없음.
개인리그 3세트는 각각 20명 전원 중복 없이 배정. 선수별 참가·제출 가능 상태 확인.
미완료 마감 거절 확인: 2건.
