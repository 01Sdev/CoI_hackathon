# 진행 체크리스트

마감 2026-11-01 12:00 KST. 끝난 항목은 체크하고, 새로 발견한 항목은 해당 절에 추가한다. 관문 정의는 `docs/specs/02-SSRD.md` §5.

## 공통

- [x] 명세와 에이전트 규칙(`docs/specs/`, `AGENTS.md`) — PR #1
- [ ] 스캐폴드: Vite·TS strict·`src/core/` 타입·`validateManifest`·스토어 — PR #2
- [ ] 배포 확인(V6). 배포 방식은 사용자 결정 대기
- [ ] Supabase 쓰임 결정(조직만 있음, DB 없음). 결정 전에는 코드에 넣지 않음
- [x] 플랫폼 이름 famelet 확정(2026-10-31). 코드 `APP_NAME`(PR #2), 명세 문서(PR #1)
- [ ] 결정판 페이지·유저플로우 아티팩트의 이름(레포 밖, 아직 가칭)

## 관문

- [ ] M0: hello 플러그인에 고정 JPEG `delivery` → `ackStatus: match`, 변조 시 `mismatch`, 응답 억제 시 `timeout`
- [ ] 1차 통합(4~5h): 바나나 → Delivery 1건 → 칼로리 결과 → 로그 1줄 + 테두리 점멸
- [ ] 격리 재현: 배포 URL에서 iPhone Safari·Android Chrome으로 §3 표 6줄
- [ ] 비교 모드·전환: 켜진 동안 외부 요청 0건, 끄면 10초 안에 M 0

## 트랙 A 런타임 (`src/input/`, `src/vision/`, `src/broker/`)

- [ ] 입력 어댑터(웹캠·후면·녹화 mp4), `mountPreview`
- [ ] 0단계 판정(EfficientDet-Lite0, 5fps, 1초 유지 확정)
- [ ] 1단계 포착·2단계 가림·분기(2a~2d)·출구 재검사
- [ ] 중개기 `sendDelivery` 경로와 Counter 기록

## 트랙 B 격리·플러그인 (`src/plugins/`, `api/`)

- [ ] `plugins/host`: srcdoc iframe·CSP nonce·blob Worker·메시지 검증
- [ ] 전환 공통 절차(게이트·runtimeId·3초 ready)
- [ ] hello·칼로리·변조 플러그인
- [ ] `/api/calorie`(Vercel 함수, 413/415/429/502, 받은 본문 헤더)

## 트랙 C UI (`src/ui/`, `src/proof/`, `src/App.tsx`)

- [ ] 화면 배치(phone/desktop/hud/outward)와 라우팅
- [ ] HUD 카운터·증명 로그·확인 화면·매니페스트 편집기
- [ ] 전달 신호(테두리 점멸·효과음), `/outward`, 비교 모드·발표자 컨트롤

## 외부 봇 작업 (그록봇, 허브가 관리)

| ID | 받는 쪽 | 내용 | 보낸 시각 | 상태 |
| --- | --- | --- | --- | --- |
| FAM-R-1 | [엔지니어] | core 스토어·SDK·칼로리 서버 계약 독립 리뷰(블로커·메이저 8건 이내) | 10/31 20:5x | 엔지니어 수신 확인, 회신 대기 |
| FAM-I-1 | [엔지니어] | 트랙 연결 설계(core 연결 포트, 시작 배선) 검토 | 10/31 20:5x | 엔지니어 수신 확인, 회신 대기 |
| FAM-O-1 | [엔지니어] | Vercel 배포 체크리스트·`vercel.json` 초안 | 10/31 20:5x | 엔지니어 수신 확인, 회신 대기 |
| FAM-V-1 | [엔지니어] | PR 11개 통합 시험 결과·머지 가이드 교차 확인, A↔B 연결 모양 불일치 해법 검토 | 10/31 21:xx | 회신 대기 |
| FAM-M-1 | [엔지니어] | 사용자가 GitHub에서 PR을 머지할 때 단계별 안내(`outbox/merge-guide.md` 기준) | 10/31 21:xx | 사용자 요청 시 |
| FAM-D-1 | [디자이너] | 3분 발표 대본·슬라이드 골격(8장 이내) | 10/31 20:5x | 보류(지금은 엔지니어 봇과만 소통) |
| FAM-D-2 | [디자이너] | 화면 배치도 개선점 5개, 촬영 스토리보드 6개 | 10/31 20:5x | 보류(지금은 엔지니어 봇과만 소통) |

리듬: ① 킥오프(지금) ② 트랙 첫 PR diff 리뷰 ③ 1차 통합 뒤 통합·발표 흐름 점검 ④ 제출 전 README·대본 최종 점검.

## 모델 파일 (사용자가 직접 고른다)

**2026-10-31 사용자 실측:** MediaPipe Selfie Multiclass Segmenter(`selfie_multiclass_256x256.tflite`, 16.4MB)와 BlazeFace short-range(`blaze_face_short_range.tflite`, 0.23MB)를 독립 데모(`/Users/Kimdonggyun/Downloads/selfie-multiclass-demo`)에서 iPhone 16 Pro Safari로 돌렸다.
- 결과: GPU 약 11~28fps, 첫 결과 19.9초, 한 번 최대 추론 11.6초.
- 같은 데모에서 MediaPipe 로그 요청을 발견했다(→ V15).
- 미확인: 거리, 옆얼굴, 두 사람, 피자 장면, Android.
- 상세: `/Users/Kimdonggyun/Documents/Codex/2026-10-31/x20/outputs/Selfie-Multiclass-demo.ko.md`
- **결정(2026-10-31):** Selfie는 2단계 가림의 모양만 정한다(PRD F23, SRS FR-016a, P1, 1차 통합 뒤). 범위·분기·카운터·출구 재검사는 BlazeFace와 사람 검출 그대로. 트랙 A가 BlazeFace 경로를 끝낸 뒤 맡는다.


- [ ] 물체 판정 모델: MediaPipe Tasks `ObjectDetector`가 읽는 `.tflite`(메타데이터 포함). COCO `pizza` 클래스가 있어야 한다. 지금 명세 기준은 EfficientDet-Lite0
  - 2026-10-31: 공식 주소 파일(`object_detector/efficientdet_lite0/float32/1/`)과 해시는 같다. 이 파일의 라이선스 문구를 찾지 못해 넣지 않았다(PR #5 `THIRD_PARTY_NOTICES.md` 4절에 찾아본 곳). 사용자 결정 대기
- [x] 얼굴 모델: MediaPipe `FaceDetector`용 `.tflite`. 명세 기준은 BlazeFace short-range(약 2m 안의 얼굴용, V2 참고)
  - 2026-10-31: `blaze_face_short_range.tflite`를 PR #5에 넣었다. 모델 카드 Apache-2.0
- [x] Selfie 모델: `selfie_multiclass_256x256.tflite`를 `track-a/selfie-mask`에 넣었다(e465282). 모델 카드 Apache-2.0
- [ ] 놓을 곳: `public/models/`. WASM은 `node_modules/@mediapipe/tasks-vision/wasm/`을 `public/wasm/`으로 복사한다(CDN 금지, AGENTS.md)
- 모델을 바꾸면 V1(속도)과 V2(얼굴 분기)를 다시 잰다

## 실측 일정 (그때그때 하는 것)

원칙: 아래 "언제"에 해당하는 PR을 올리는 에이전트가 그 실측을 같이 하고, 결과를 PR 본문과 `docs/specs/05-코드-전-결정사항.md`의 V 표 상태 칸에 적는다. 못 했으면 못 한 이유를 적는다.

| V | 볼 것 | 언제 | 누가 | 상태 |
| --- | --- | --- | --- | --- |
| V6 | Vercel 최소 배포(정적 + `/api/calorie` + `/hud`·`/outward` 경로 + 모델·WASM) | 배포 방식이 정해지는 즉시. V1·V9·V10·V11의 Android·배포 시험이 이것을 기다린다 | 사용자 결정 → B | 대기(배포 미정) |
| V10 | M0: `dev/fixtures/m0-test.jpg`로 match·mismatch·timeout | 트랙 B 첫 PR(`plugins/host` + hello) | B | 대기. iPhone 계약 재현은 통과 |
| V9 | Android Chrome 격리 S1~S6 | 트랙 B 첫 PR 뒤, 배포 주소에서 | B | 대기 |
| V1 | MediaPipe 속도·GPU→CPU 대체(Android) | 트랙 A 첫 PR(0단계) 뒤, 모델 파일이 정해지고 배포 주소가 생기면 | A | iPhone 통과(첫 추론 11~14초), Android 대기 |
| V4 | 큰 해상도 요청 시 실제 해상도·포착 시간(Android) | V1과 같이 | A | iPhone 통과, Android 대기 |
| V8 | 녹화 mp4 재생 후 판정 | 트랙 A 입력 PR + `08-데모-소재.md`의 `pizza-alone.mp4` | A | iPhone 합성 영상 통과, 실제 영상 대기 |
| V2 | 먼·옆·잘린 얼굴의 분기. F23 뒤에는 Selfie 가림이 박스·사각형보다 덜 가린 사례가 있는지(SRS FR-016a) | 트랙 A 둘째 PR(포착·가림) + 얼굴 영상 3개 | A | 대기 |
| V3 | 2c가 손에 든 피자를 가리는지. F23 뒤에는 Selfie가 피자를 머리카락·피부로 보는지 | V2와 같이 | A | 대기 |
| V5 | 칼로리 응답 시간·비용(피자 256px 10회, p50·p95, 토큰) | 트랙 B `/api/calorie` PR. 키가 있는 로컬에서 | B | 대기 |
| V11 | 통합 상태 격리 6줄·전환·옛 iframe 메시지(iPhone·Android) | 1차 통합 뒤, 배포 주소에서 | B | 대기 |
| V12 | 노트북 Chrome에서 데모 5단계 네트워크 탭 | 2차 통합 뒤 리허설 | C·발표자 | 대기 |
| V13 | Ray-Ban Display 시뮬레이터에서 `/hud` D-pad | 트랙 C `/hud` PR | C | 대기 |
| V14 | 메인 창과 `/outward` 동기화(외부 화면) | 트랙 C `/outward` PR 뒤 리허설 | C | 대기 |
| V15 | 호스트 외부 요청 차단: MediaPipe 로그 요청(`odml.pa.googleapis.com`)이 네트워크 탭에 0건인지. 호스트 `connect-src 'self'`가 srcdoc iframe Worker의 `$ORIGIN` 요청을 막는지(Chrome·iPhone) | 트랙 B 첫 PR(호스트 가드) + 배포 주소에서 | B(iPhone은 x20-codex 도움 가능) | 대기. 독립 데모에서 `connect-src 'self'`로 로그 요청 차단 확인(교집합 문제는 미시험) |
| V7 | iPhone 효과음·무음 모드 | — | — | 통과 |
