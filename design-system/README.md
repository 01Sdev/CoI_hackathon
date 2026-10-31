# framelet

framelet은 1인칭 카메라와 그 위에서 도는 앱 사이에 들어가는 웹 런타임이다. 앱에는 흰 틀 안 조각만 넘기고, 찍힌 사람의 얼굴은 가려서 보내며, 넘어간 것은 기록으로 보여 준다. 화면은 **실제 시야 위에 떠 있는 유리**처럼 보이고, 색은 의미를 말할 때만 쓴다.

원본은 레포 `01Sdev/CoI_hackathon`의 `src/ui/theme.css`(토큰)와 `docs/designs/design-system.md`(규칙)다. 이 디자인 시스템은 그 사본이며, 값이 다르면 레포가 맞다.

## 원칙

- **유리.** 카메라 화면 위의 모든 패널은 유리다. 진하게 74%(`fm-glass-panel`), 보통 55%(`fm-glass-capsule`), 얇게 32%(`fm-glass-hint`) 세 단계이고, 흐림 `fm-blur` 22px, 외곽선 `fm-line` 1.5px `fm-glass-line`(네 면 모두)을 쓴다.
- **색은 의미에만.** 초록 `fm-safe` = 아무도 앱에 넘어가지 않음, 주황 `fm-exposed` = 비교 모드·노출, 빨강 `fm-blocked` = 차단. 보류는 색 없이 속이 빈 고리다. 의미 없는 색은 `fm-lens` 파랑 하나뿐이고 브랜드 점·데이터 선·로딩 스캔·키보드 포커스에만 쓴다.
- **색과 글자를 함께.** 기록과 시트의 상태는 색 점 + 글자로 보인다("● 보호됨"). 카메라 위 사람 숫자는 평소 흰색이고, 1 이상일 때만 `fm-exposed`로 바뀐다.
- **기본은 다크.** 라이트는 사용자가 고르고 브라우저에 남긴다. 글래스 HUD(`/hud`, 600×600)는 늘 다크이고 유리·흐림·그림자가 없다(Glass HUD 테마).
- **framelet과 앱을 나눈다(2026-11-01 갱신, #43).** framelet이 카메라 위에 그리는 것은 흰 프레임(`fm-r-frame`)과 그 오른쪽 위 가장자리의 사람 아이콘·숫자(앱에 반영된 사람 수, 평소 흰색, 1 이상이면 `fm-exposed`)뿐이다. 앱의 결과는 앱마다 정해진 화면 하나가 그린다. 칼로리는 금빛 상태창(`FoodStatusPanel`)과 금빛 연결선을 쓰는데, 이 금색은 칼로리 앱의 모양이지 framelet 토큰이 아니다. 앱끼리 모양이 달라도 된다. 앱 문자열은 그림 문자·방향 문자·framelet 문구를 걸러서 넣는다.

## 글자 규칙

| 글자 | 놓을 수 있는 곳 |
| --- | --- |
| `fm-text` | 55% 이상 유리(`fm-glass-capsule`, `fm-glass-panel`) |
| `fm-sub` | 74% 유리(`fm-glass-panel`)와 페이지 바탕 |
| 없음 | 32% 유리(`fm-glass-hint`) |

- 본문 글꼴은 Pretendard(`sans`)다. 바이트·비율·점수·시각은 기기 내장 고정폭(`mono`, `readout` 스타일, tabular-nums), 보조 설명만 Noto Serif KR(`serif`, `caption` 스타일, 12px 이상)이다.
- 휴대폰·데스크톱 크기: 카운터 62/36px Light, 장면 22px SemiBold, 결과 16px Medium, 로그·상태 14px SemiBold, 보조 12px.
- `/hud` 크기: 카운터 72/48px, 장면 28px, 나머지는 모두 24px 이상(PRD HUD 규칙).
- 영문 이름(framelet, KB)은 문장형 대소문자로 쓴다. 영문 대문자 머리말(`kicker`)은 한글·이름에 쓰지 않는다.
- 화면 문구는 해요체이고 느낌표를 쓰지 않는다. 숫자는 모두 실제 값이다.

## 모서리와 재질

- 모서리: 캡슐 `fm-r-capsule` 999px, 카드 `fm-r-card` 18px, 흰 틀·대상 프레임 `fm-r-frame` 14px, 패널 `fm-r-panel` 28px.
- 유리 위쪽 안쪽에 1px 하이라이트(`fm-glass-highlight`), 아래로 퍼지는 그림자(`fm-shadow`).
- 성능이 모자라거나 투명도 줄이기를 켠 기기는 `data-glass="solid"`로 흐림을 끄고 유리를 거의 불투명하게 바꾼다.
- 한쪽 면에만 선을 긋지 않는다. 배경 그라디언트는 쓰지 않는다.

## 움직임

토큰 파일에는 움직임 항목이 없어 여기에 적는다(`theme.css`의 `--fm-ease`, `--fm-dur-*`).

- 이징 `cubic-bezier(0.22, 1, 0.36, 1)`.
- 상태 전환 180ms, 전달 테두리 점멸 300ms, 알림이 내려오는 데 420ms, 떠 있는 시간 3000ms.
- 움직임 줄이기 설정이면 점멸·알림·스캔 움직임을 끄고 알림은 3초 뒤 그냥 사라진다.

## 부품(코드에만 있음)

이 시스템에는 컴포넌트 카드가 없다. 부품은 레포의 React 코드와 CSS 클래스로만 있다.

| 부품 | 클래스·파일 | 쓰는 토큰 |
| --- | --- | --- |
| 유리 패널·캡슐 | `fm-glass`, `fm-glass--panel`, `fm-glass--hint`, `fm-capsule` | `fm-glass-*`, `fm-line`, `fm-r-capsule` |
| 상태 점 | `fm-dot` (`data-tone` safe·exposed·blocked·hold) | 의미색, 22% 후광 |
| 흰 틀 | `src/ui/CaptureFrame.tsx` | `fm-r-frame`, 흰 2px 테두리와 꼭짓점 손잡이. 조절은 위쪽 줄 "전송 범위" 버튼에서 |
| 사람 아이콘·숫자 | `src/ui/Hud.tsx` `PersonCount` | 선 SVG 아이콘 14px + 숫자 16px(`/hud` 48px), `fm-text` / `fm-exposed` |
| 플러그인 화면 | `src/ui/PluginViews.tsx` | 앱 종류마다 화면 하나: 칼로리 = `FoodStatusPanel`(금빛, `src/ui/food-status-panel.css`), 장면 기록 = 작은 글자 카드, 변조 = 없음 |
| 규약 보기 | `src/proof/ProtocolView.tsx` | 보장 카드 `fm-r-card`, 요청/허용 표 |

카운터 오브(`src/ui/OrbStack.tsx`), 장면 캡슐, 대상 프레임 브래킷, 전달 알림 토스트, 앱 카드는 #43에서 카메라 위 화면에서 빠졌다.

부품 미리보기는 레포에서 `npm run dev` 뒤 `/dev/design.html`(부품)과 `/dev/screens.html`(화면별 배치)로 본다.

## 아이콘과 로고

- 로고 파일은 없다. 브랜드는 `fm-lens` 점 + "framelet" 글자를 유리 캡슐에 담은 모양이다. 이름은 코드 상수 `APP_NAME` 하나에서 가져온다.
- 아이콘은 선 SVG를 직접 그린다(선 두께 2, 둥근 끝). 그림 문자는 쓰지 않는다.
- 사람에게는 박스나 표시를 그리지 않는다(사용자 결정). 화면 속 사람 수만 판독값으로 보인다.

## 쓰지 않는 것

2026-11-01 앱 화면 설계 1판에서 다른 디자인 스킬(ai-design-skills Part B)을 보고 적었던 것들은 쓰지 않는다: `#131209` 바탕, 16/12px 모서리 체계, Geist 글꼴, Phosphor 아이콘, IBM Plex Sans KR.

## 사본에 대해

- 이 디자인 시스템 아티팩트와 레포의 `design-system/` 폴더는 같은 파일이다. 원본은 `src/ui/theme.css`다.
- 레포 사본에는 글꼴 파일을 넣지 않는다. `fonts/`의 네 파일은 npm `pretendard@1.3.9`(SIL OFL 1.1)의 `dist/web/static/woff2/Pretendard-{Light,Regular,Medium,SemiBold}.woff2`를 그대로 복사한 것이다. 앱은 같은 패키지의 가변 동적 서브셋을 번들한다.

## 옮기지 못한 것

- 컴포넌트: 만들지 않았다(위 "부품" 표). 경로: `src/ui/`, `src/proof/`.
- 토큰 밖 값: `--fm-glow`(빛번짐 세기, 다크 0.38·라이트 0.18), 움직임 변수, `data-glass="solid"`의 `color-mix()` 값.
- 간격: `theme.css`에 간격 토큰이 없어 넣지 않았다.
- 라이트 테마 그림자 값은 `fm-shadow`의 설명에만 적었다.
