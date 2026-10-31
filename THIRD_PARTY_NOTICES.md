# 외부 구성요소 고지 (Third-Party Notices)

framelet이 가져다 쓰는 라이브러리, 모델, 폰트, 외부 서비스의 목록입니다. 대회 안내("외부 소스코드는 라이선스를 확인하고, 기존 구현과 직접 개발한 부분을 구분해 발표")에 맞춰 관리합니다.

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
| `efficientdet_lite0.tflite` (13,836,895바이트, SHA-256 `40338edf…bf58`) | 0단계 물체 판정(COCO `pizza`·`person`) | https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float32/1/efficientdet_lite0.tflite | Apache-2.0 (간접 근거) | 이 파일을 직접 다루는 모델 카드·라이선스 문구는 찾지 못함. 찾아본 곳: MediaPipe 물체 검출 문서(페이지 하단의 CC BY 4.0·Apache 2.0은 문서와 코드 예제에 대한 것), `mediapipe-assets` 버킷의 모델 카드 목록, 파일 메타데이터. 근거: 같은 Google 모델 계열인 Kaggle `tensorflow/efficientdet`(https://www.kaggle.com/models/tensorflow/efficientdet)의 TFLite 변형 lite0-detection-default·lite0-detection-metadata·lite0-int8이 Apache 2.0(Kaggle API `licenseName`). 그 파일과 이 파일이 같은 파일인지는 확인하지 못함 | 2026-10-31, 허브 세션(사용자가 이 근거로 넣기로 결정). 트랙 A 작업 폴더 사본과 공식 주소 파일의 MD5가 같음 |
| `blaze_face_short_range.tflite` (229,746바이트, SHA-256 `b4578f35…152f`) | 2단계 얼굴 검출(SRS FR-014)과 출구 재검사(FR-055) | https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite | Apache-2.0 | 모델 카드 "MediaPipe BlazeFace Model Card (Short Range)"(2021-06-09)의 "LICENSED UNDER Apache License, Version 2.0" · https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf | 2026-10-31, 허브 세션(사용자 승인). 트랙 A 작업 폴더 사본과 공식 주소 파일의 MD5가 같음 |
| `selfie_multiclass_256x256.tflite` (16,371,837바이트, SHA-256 `c6748b12…e0e0`) | 2단계 가림 모양(머리카락·얼굴 피부), PRD F23·SRS FR-016a | https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite | Apache-2.0 | 모델 카드 "Model Card Multiclass Segmentation"(2023-05-10)의 "LICENSED UNDER Apache License, Version 2.0" · https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf | 2026-10-31, 허브 세션(사용자 승인). 사용자 독립 데모에서 받은 파일과 같은 해시 |

참고: MediaPipe 공식 모델 중 모델 카드가 있는 것(BlazeFace, Selfie Multiclass 등)은 카드에 Apache-2.0이 적혀 있습니다. EfficientDet-Lite0처럼 카드가 없는 모델도 있으니 파일마다 다시 확인해서 적습니다.

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
