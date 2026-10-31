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

- [x] 입력 어댑터(웹캠·후면·녹화 mp4), `mountPreview` — `track-a/runtime`
- [x] 0단계 판정(EfficientDet-Lite0, 5fps, 1초 유지 확정) — `track-a/runtime`
- [x] 앱 연결: C의 `Preview`가 찾는 `src/input/preview.ts`의 `mountPreview`가 `startRuntime()`도 부른다
- [x] 1단계 포착·2단계 가림·분기(2a~2d)·출구 재검사 — `track-a/capture`
- [x] 중개기 `sendDelivery` 경로와 Counter 기록 — `track-a/capture`. B는 `connectPluginHost(sendDelivery)`로 붙는다(02-SSRD IF-02)
- [x] F24 전송 범위 프레임의 자르기(P0): `track-a/frame-crop`. 포착은 프레임 안만, 프레임 밖이면 hold "프레임 밖"+쿨다운, raw도 프레임 안만
- [ ] F23 Selfie 모양 가림(P1, 1차 통합 뒤 PR): `track-a/selfie-mask`에 구현. 모델 파일 커밋은 사용자 확인 대기. 실제 얼굴 영상으로 V2·V3 확인 필요
- [ ] B 연결 확인: 실제 `plugins/host`의 `sendDelivery`로 M0·1차 통합(지금은 `/dev/` 목 호스트로만 확인)
- [ ] V2·V3: 팀 얼굴 영상(`pizza-face-*.mp4`)으로 분기·손에 든 피자 실측. 사람 앞 피자는 겹침 50% 이상이라 옆얼굴이면 2d가 될 수 있음(설계 §4)

## 트랙 B 격리·플러그인 (`src/plugins/`, `api/`)

- [x] `plugins/host`: srcdoc iframe·CSP nonce·blob Worker·메시지 검증 — 트랙 B PR(plugin-host)
- [x] 전환 공통 절차(게이트·runtimeId·3초 ready) — 같은 PR
- [x] SDK 런타임·hello 플러그인·`/dev/m0.html` M0 페이지 — 같은 PR
- [ ] `main.tsx` 배선: `startPluginHost()`와 `connectPluginHost((_id, msg) => { sendDelivery(msg.deliveryId); })` — 허브가 1차 통합 PR에서(02-SSRD "트랙 연결 기준")
- [ ] 발표 노트북 Chrome 첫 로드에서 칼로리 iframe이 3초 안에 ready인지(부하가 높을 때 headless Chrome에서 iframe 7개가 모두 stopped인 실행이 있었다)
- [x] hello·칼로리·변조 플러그인 — 트랙 B PR(plugin-host, calorie-tamper)
- [x] `/api/calorie`(Vercel 함수, 413/415/429/502, 받은 본문 헤더) — 트랙 B PR(api-calorie). 개발 서버에서도 같은 함수가 `/api/calorie`로 열린다
- [ ] V5 실측(키가 있는 곳에서 `scripts/measure-calorie.ts`)
- [ ] 배포(V6) 뒤 실제 Vercel에서 `/api/calorie` 웹 표준 함수(`export function POST`) 동작 확인

## 트랙 C UI (`src/ui/`, `src/proof/`, `src/App.tsx`)

- [x] 화면 배치(phone/desktop/hud/outward)와 라우팅, 시작·로딩·실패 화면 — `track-c/screens`
- [ ] A: `src/input/preview.ts`의 `mountPreview(container)`와 `setEngine` 호출(C가 기다리는 연결점, 없으면 HUD는 `liveObservation`으로 판정 중을 안다)
- [ ] 배포: `/hud`·`/outward`를 `index.html`로 되돌리는 rewrite(V6, NFR-024)
- [x] HUD 다섯 요소·카운터 M·10초 호·차단 배지·전달 신호(점멸·소리·진동·알림)·보류 줄 — `track-c/hud`
- [x] 증명 로그(휴대폰 시트·데스크톱 탭)·상세(해시)·확인 화면(외 k장)·`/hud` D-pad — `track-c/proof`
- [x] 매니페스트 편집기(검증·적용·되돌리기·멈춤 다시 켜기·플러그인 켜기)·처리량 패널(F16·F19) — `track-c/manifest`
- [ ] B: `stopped`가 된 뒤 `enabled: false` 구독에서 `terminated`로 덮어쓰지 않기(덮으면 "다시 켜기" 카드가 안 보임)
- [x] 전달 신호(테두리 점멸·효과음) — `track-c/hud`
- [x] `/outward`(IF-07 1초 재발행·5초 연결 끊김), 비교 모드·일시 정지·새 세션 발표자 컨트롤 — `track-c/presenter`
- [x] 확인 화면 "요청한 것 / 허용된 것"(FR-030), 두 앱 나란히(F21 UI) — `track-c/request-grant`
- [x] 착용자 제어: 휴대폰 시트의 전달 일시 정지·앱별 끄기·회수 안 함 안내(F22, FR-058) — `track-c/wearer`

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


- [x] 물체 판정 모델: MediaPipe Tasks `ObjectDetector`가 읽는 `.tflite`(메타데이터 포함). COCO `pizza` 클래스가 있어야 한다. 지금 명세 기준은 EfficientDet-Lite0
  - 2026-10-31: `efficientdet_lite0.tflite`(float32)를 PR #5에 넣었다. 이 파일을 다루는 라이선스 문구는 없다. Kaggle `tensorflow/efficientdet`의 TFLite lite0 변형이 Apache 2.0인 것을 간접 근거로 삼기로 사용자가 정했다(`THIRD_PARTY_NOTICES.md` 4절)
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
| V10 | M0: `dev/fixtures/m0-test.jpg`로 match·mismatch·timeout | 트랙 B 첫 PR(`plugins/host` + hello) | B | 통과(Chrome, 제품 SDK 통합 `/dev/m0.html` 15줄). iPhone·Android 제품 SDK 시험 남음 |
| V9 | Android Chrome 격리 S1~S6 | 트랙 B 첫 PR 뒤, 배포 주소에서 | B | 대기 |
| V1 | MediaPipe 속도·GPU→CPU 대체(Android) | 트랙 A 첫 PR(0단계) 뒤, 모델 파일이 정해지고 배포 주소가 생기면 | A | iPhone 통과(첫 추론 11~14초). 노트북 Chrome(M3 Pro, 제품 코드 `/dev/`): GPU, 0단계 5.0fps, 추론 평균 28ms·p95 36ms, 페이지 시작→첫 판정 803ms(로컬 서버, 캐시 있음). Android 대기(배포 주소 없음) |
| V4 | 큰 해상도 요청 시 실제 해상도·포착 시간(Android) | V1과 같이 | A | iPhone 통과. 노트북: 내장 브라우저 창이 카메라를 막아 못 잼(녹화 자동 전환은 확인). Android 대기 |
| V8 | 녹화 mp4 재생 후 판정 | 트랙 A 입력 PR + `08-데모-소재.md`의 `pizza-alone.mp4` | A | iPhone 합성 영상 통과. 노트북 Chrome: 직접 만든 피자 그림 mp4(720×1280)로 `food·pizza` 확정(제품 코드). `pizza-alone.mp4` 없음, 실제 영상 대기 |
| V2 | 먼·옆·잘린 얼굴의 분기. F23 뒤에는 Selfie 가림이 박스·사각형보다 덜 가린 사례가 있는지(SRS FR-016a) | 트랙 A 둘째 PR(포착·가림) + 얼굴 영상 3개 | A | 대기(얼굴 영상 없음). 대신 그림 얼굴(이모지)+그린 피자로 2b 가림·출구 재검사 경로만 확인 |
| V3 | 2c가 손에 든 피자를 가리는지. F23 뒤에는 Selfie가 피자를 머리카락·피부로 보는지 | V2와 같이 | A | 대기(영상 없음). 사람 앞 피자는 P(50%)로 2d가 될 위험을 설계에 적음 |
| V5 | 칼로리 응답 시간·비용(피자 256px 10회, p50·p95, 토큰) | 트랙 B `/api/calorie` PR. 키가 있는 로컬에서 | B | 대기(키 없음). 함수·502 경로·요청 모양은 가짜 상류로 확인 |
| V11 | 통합 상태 격리 6줄·전환·옛 iframe 메시지(iPhone·Android) | 1차 통합 뒤, 배포 주소에서 | B | 대기 |
| V12 | 노트북 Chrome에서 데모 5단계 네트워크 탭 | 2차 통합 뒤 리허설 | C·발표자 | 대기 |
| V13 | Ray-Ban Display 시뮬레이터에서 `/hud` D-pad | 트랙 C `/hud` PR | C | 대기. 키 처리(화살표·Enter keydown, 뒤로 = history)는 앱 안 브라우저 600×600에서 확인, 시뮬레이터 확장은 못 씀(`track-c/proof`) |
| V14 | 메인 창과 `/outward` 동기화(외부 화면) | 트랙 C `/outward` PR 뒤 리허설 | C | 대기. 같은 브라우저 두 탭 동기화는 확인(`track-c/presenter`), 외부 화면·실제 통합은 리허설 |
| V15 | 호스트 외부 요청 차단: MediaPipe 로그 요청(`odml.pa.googleapis.com`)이 네트워크 탭에 0건인지. 호스트 `connect-src 'self'`가 srcdoc iframe Worker의 `$ORIGIN` 요청을 막는지(Chrome·iPhone) | 트랙 B 첫 PR(호스트 가드) + 배포 주소에서 | B(iPhone은 x20-codex 도움 가능) | Chrome: 로그 요청 차단·`$ORIGIN` Worker 요청 통과·M0 그대로(05 V15). iframe 시작 멈춤이 CSP 쪽에서 더 잦았다(6/18 대 1/18, 원인 미확정). iPhone 대기. **우리 앱 재현(트랙 A, 10/31 21:50, 노트북 Chrome `/dev/`, 가드 없음):** 모델 생성 60초 뒤 `POST https://odml.pa.googleapis.com/v1/log` 2건(ObjectDetector·FaceDetector 하나씩), 응답 200(밖으로 나감). 이후 60초마다 반복. 본문은 약 100B `application/x-protobuf`(로그 소스 ID, 버전 "1.2.0", 작업 종류, 호출 수·시간). 이미지 바이트 없음. 헤더에 라이브러리 내장 API 키. `fetch`를 거부하면 그 작업의 로거가 스스로 멈춰 다음 주기에 다시 시도하지 않았다(180초까지 0건). MediaPipe는 `fetch`를 보낼 때 찾으므로 import 뒤에 건 가드도 잡힌다 |
| V7 | iPhone 효과음·무음 모드 | — | — | 통과 |
