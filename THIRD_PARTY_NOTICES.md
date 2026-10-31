# 외부 구성요소 고지 (Third-Party Notices)

famelet이 가져다 쓰는 라이브러리, 모델, 폰트, 외부 서비스의 목록입니다. 대회 안내("외부 소스코드는 라이선스를 확인하고, 기존 구현과 직접 개발한 부분을 구분해 발표")에 맞춰 관리합니다.

- 확인일: 2026-10-31
- 라이선스는 설치된 패키지의 `package.json` `license` 필드에서 읽었습니다.
- 소스 공개 의무가 있는 라이선스(GPL·AGPL)는 쓰지 않습니다. 새로 추가할 때도 지킵니다(예: Ultralytics YOLO는 AGPL이라 제외).

## 1. 라이브러리 (배포물에 포함)

| 이름 | 버전 | 라이선스 | 출처 | 쓰는 곳 |
| --- | --- | --- | --- | --- |
| React, React DOM | 18.3.1 | MIT | https://github.com/facebook/react | 화면 |
| zustand | 5.0.16 | MIT | https://github.com/pmndrs/zustand | 공용 상태 스토어(`src/core/store.ts`) |
| @mediapipe/tasks-vision | 1.2.0 | Apache-2.0 | https://github.com/google-ai-edge/mediapipe | 물체·얼굴·사람 검출 런타임과 WASM |

## 2. 폰트 (배포물에 포함, PR #3부터)

| 이름 | 버전 | 라이선스 | 출처 |
| --- | --- | --- | --- |
| Pretendard | 1.3.9 | SIL OFL 1.1 | https://github.com/orioncactus/pretendard |
| Noto Serif KR (@fontsource) | 5.3.1 | SIL OFL 1.1 | https://github.com/fontsource/font-files · 원본 Google Fonts |

OFL 1.1은 폰트를 프로그램에 넣어 배포하는 것을 허용합니다. 폰트 파일만 따로 판매하는 것은 금지합니다.

## 3. 개발 도구 (배포물에 거의 남지 않음)

| 이름 | 버전 | 라이선스 |
| --- | --- | --- |
| Vite | 7.3.7 | MIT |
| @vitejs/plugin-react | 5.2.0 | MIT |
| TypeScript | 5.9.3 | Apache-2.0 |
| tsx | 4.23.15 | MIT |

## 4. 모델 파일 (`public/models/`)

모델 파일을 `public/models/`에 넣는 사람은 **같은 PR에서 이 표에 한 줄을 추가합니다.** 출처 URL은 실제로 받은 주소를 그대로 적고, 라이선스는 그 모델 카드나 저장소에서 확인한 값을 적습니다. 확인하지 못했으면 "미확인"이라고 적고 넣지 않습니다.

| 파일 | 역할 | 출처 URL | 라이선스 | 확인한 곳 | 넣은 날·사람 |
| --- | --- | --- | --- | --- | --- |
| (아직 없음) | 0단계 물체 판정 (명세 기준 EfficientDet-Lite0) | | | | |
| (아직 없음) | 얼굴 검출 (명세 기준 BlazeFace short-range) | | | | |
| (아직 없음) | 사람 분리 후보 (Selfie Multiclass 256×256) | | | | |

참고: MediaPipe 공식 모델은 Google이 Apache-2.0으로 배포한다고 모델 카드에 적혀 있습니다. 파일마다 다시 확인해서 적습니다.

WASM 파일(`public/wasm/`)은 `@mediapipe/tasks-vision` 패키지의 `wasm/` 폴더를 복사한 것이며, 1절의 Apache-2.0을 따릅니다.

## 5. 외부 서비스 (오픈소스 아님)

| 서비스 | 쓰는 곳 | 비고 |
| --- | --- | --- |
| Anthropic Claude API (`claude-haiku-5-5`) | `/api/calorie` 서버 함수의 칼로리 추정 | 유료 API. 이미 가린 조각만 보낸다. 키는 서버 환경 변수에만 둔다 |
| Vercel (예정) | 배포 | 배포 방식 확정 전 |

## 6. 발표용 구분

| 가져다 쓴 것 | 우리가 만든 것 |
| --- | --- |
| 물체·얼굴·사람 검출 모델과 런타임(MediaPipe) | 0~2단계 판정 흐름, 2a~2d 분기 규칙, 출구 재검사 |
| 화면 라이브러리(React), 상태 관리(zustand) | 플러그인 격리(sandbox iframe + Worker + CSP)와 메시지 계약 |
| 폰트(Pretendard, Noto Serif KR) | 매니페스트 검증, 전환 절차, 증명 로그, 카운터 |
| 칼로리 추정 AI(Claude API) | HUD, `/outward`, 디자인 시스템, `/api/calorie` 서버 |

## 라이선스 원문

- MIT: https://opensource.org/license/mit
- Apache-2.0: https://www.apache.org/licenses/LICENSE-2.0
- SIL OFL 1.1: https://openfontlicense.org

각 패키지의 원문 라이선스 파일은 `node_modules/<패키지>/LICENSE`에 함께 들어 있습니다.
