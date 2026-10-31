# 휴대폰 앱 화면 시안(P1~P6)

`docs/designs/app-structure.md`의 화면 여섯 장을 그린 디자인 캔버스 "framelet 앱 화면 설계"의 사본이다. 원본 캔버스는 https://claude.ai/artifact/U47BvhrRCTHkraU7Aq5M9S 이다(비공개, 소유자 공유 필요). 값이 다르면 캔버스가 최신이다.

| 파일 | 화면 |
| --- | --- |
| `Main.dc.html` | P1 보기: 카메라, 흰 틀, 전달 신호 "framelet → 칼로리", 보호 카운터, 앱 결과 칸 |
| `Apps.dc.html` | P2 앱 목록: 시드 앱 세 개와 요청 조건 칩 |
| `AppDetail.dc.html` | P3 앱 상세: 이 앱이 받은 것, 허용한 조건(요청/허용), 마지막 결과 |
| `Consent.dc.html` | P4 연결 요청(안 A 시안). 실제 앱은 안 B라 버튼 없는 "규약 보기"다 |
| `Activity.dc.html` | P5 전체 기록 |
| `ActivityDetail.dc.html` | P6 기록 상세 |
| `canvas.json` | 캔버스 배치, 메모, 연결한 디자인 시스템 |

- 시각 규칙은 framelet 기존 디자인 시스템(`docs/designs/design-system.md`, `src/ui/theme.css`, 사본 `design-system/`)을 따른다.
- `.dc.html`은 디자인 캔버스 형식이라 첫 줄의 `support.js`가 있어야 그려진다. 이 레포에는 그 런타임이 없어 브라우저로 바로 열면 모양이 깨진다. 보려면 위 캔버스 링크를 연다.
- 캔버스 자산 주소(`/_blob/…`)는 레포 안 경로로 바꿔 두었다. 사진은 `assets/`, Pretendard는 `node_modules/pretendard`의 가변 글꼴이다.

## 목데이터 사진

- `assets/camera.jpg`: 사용자가 준 카페 사진(2026-11-01)을 피자 가운데로 세로 자른 카메라 화면(716×880). 배경에 사람이 있다. 레포에 넣는 것은 사용자가 정했고(2026-11-01), 시연 앱 입력(`public/demo/`)에는 넣지 않는다.
- `assets/piece1~3.jpg`: 같은 사진에서 피자 상자를 사방 10% 넓혀 자르고 긴 변 256px로 줄인 조각. 사람은 들어 있지 않다.
- 시안의 숫자(11.2KB, 원본의 7.9%, 틀 432×768)는 같은 장면을 로컬 앱 파이프라인에 돌려 잰 값이다. 시각(11:42:25 등)은 예시다.
