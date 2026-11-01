# 설계: 트랙 A 런타임(입력·0단계·포착·가림·중개기)

상태: EGM 설계 리뷰(egm-design 1명) 반영, 사용자 승인 대기(PR 머지 = 승인) · 2026-10-31 · 근거: `docs/specs/02-SSRD.md` §1·§2·IF-02·§4, `docs/specs/03-SRS.md` FR-001~018·FR-051·FR-055, §4.1·§4.2, `docs/specs/05-코드-전-결정사항.md` 결정 17·30, `docs/designs/core-store.md` · 코드: `src/input/`, `src/vision/`, `src/broker/`

## 1. 풀려는 문제

명세는 해야 할 일을 정했다. 입력 3종, 5fps 판정, 1초 확정, +10% 포착, 2a~2d 분기, 출구 재검사다. 다음은 정하지 않았다.

- 스토어의 어떤 값을 언제 쓰는가. 예를 들어 `liveObservation.label`은 확정 장면인가, 이번 틱 장면인가?
- 한 프레임에서 플러그인 여럿이 포착할 때 프레임과 검출 결과를 나눠 쓰는가?
- 포착하는 사이에 입력, 세션, iframe이 바뀌면 어디서 버리는가?
- B 코드가 아직 없는데 중개기는 `sendDelivery`를 어떻게 부르는가?
- 모델 파일이 아직 없을 때는 어떻게 도는가?

## 2. 결정

### 2.1 모듈과 원본 픽셀의 경계

| 파일 | 하는 일 | 원본 픽셀 |
| --- | --- | --- |
| `input/adapter.ts` | `<video playsInline muted autoplay>` 하나로 웹캠·후면·mp4를 연다. `startInput()`이 `session.inputRequest`를 `fireImmediately`로 구독한다. `mountPreview(container)`를 제공한다 | `getUserMedia`, `srcObject` |
| `input/preview.ts` | C가 찾는 약속 위치다. `mountPreview`가 `startRuntime()`도 부른다 | 없음 |
| `vision/models.ts` | 모델 두 개를 GPU로 만들고, 실패하면 CPU로 만든다. 예열한다 | 없음 |
| `vision/stage0.ts` | 0단계를 반복하고 장면 상태기계를 돌린다. `addSceneDecision`·`setLiveObservation`·`recordRuns`를 쓴다 | `drawImage(video)` |
| `vision/plan.ts` | 포착 게이트. 스토어 상태만 읽는 순수 함수다 | 없음 |
| `vision/capture.ts` | 포착, 재검출, 가림, 분기, 축소·인코딩, 출구 재검사 | `drawImage(video)`, `toBlob`, `createImageBitmap` |
| `vision/branch.ts`, `geometry.ts`, `scene.ts` | 순수 함수: 분기 결정표, 좌표, 장면 선택, 상태기계 | 없음 |
| `broker/broker.ts` | `prepareDelivery`와 `sendDelivery` 호출(이 파일 한 곳), hold·skip 로그 | 없음(가린 Blob만) |

- `<video>`와 MediaStream은 스토어에 넣지 않는다. `<video>`의 `object-fit`은 A가 정하지 않는다(C의 CSS가 정하고, 박스 겹치기도 그 매핑을 따른다). `getVideo()`는 `vision/`만 import한다.
- 시작점은 `startRuntime()`(`vision/index.ts`) 하나다. 여러 번 불러도 구독과 반복은 하나만 돈다(HMR·StrictMode 대비).
- C는 `import.meta.glob('/src/input/preview.ts')`로 `mountPreview`를 찾는다(track-c/screens). `input/preview.ts`의 `mountPreview`는 처음 불릴 때 `startRuntime()`도 부른다. 그래서 `main.tsx`를 고치지 않아도 미리보기가 붙으면 판정이 돈다.
- 미리보기를 떼어도(`mountPreview`가 돌려준 함수) 판정은 이어진다. 문서에서 뗀 `<video>`는 브라우저가 잠시 뒤 멈추므로 그 뒤에 다시 재생한다(muted).
- `connectPluginHost` 연결 없이 전달을 시도하면 `console.error`를 한 번 남기고(연결될 때까지 다시 남기지 않음) 그 전달은 `failed`가 된다. 연결 누락이 조용히 "전달 0건"으로 묻히지 않게 하기 위해서다(02-SSRD "트랙 연결 기준").

### 2.2 입력(F1·F10)

- 요청이 없으면 기본 입력을 연다. 폭 768px 미만이면 후면, 이상이면 웹캠, `/hud`는 녹화 영상이다.
- 입력을 열기 시작하면 이전 소스를 바로 끊고(`srcObject = null`) `setInput(null)`을 쓴다. 0단계는 `session.input`이 null이면 쉰다. 그래서 옛 입력의 멈춘 프레임은 판정하지도 포착하지도 않는다.
- `getUserMedia`가 끝나면 그 사이에 다른 요청이 왔는지부터 본다. 왔으면 그 스트림을 멈추고 `<video>`에 붙이지 않는다. 권한 창이 떠 있는 동안에는 시간 제한을 두지 않는다. 8초 제한은 스트림이 열린 뒤 첫 프레임이 나오기까지에만 건다.
- 카메라가 실패하면(권한 거부, 장치 없음, HTTP, 첫 프레임 8초 초과) 녹화 영상으로 바꾸고 `InputSource.fallbackFrom`에 원래 종류를 적는다(FR-004).
- 대체 녹화 영상까지 못 열면(배포본처럼 `/demo` 영상이 없을 때) `setInput(null, { kind: 'video', fallbackFrom: 원래 카메라 })`로 `session.inputError`를 남긴다. 녹화 영상만 요청해 실패하면 `fallbackFrom: null`이다. 열기 순서는 `openWithFallback`(`input/adapter.ts`)이고 `scripts/check-runtime.ts`가 가짜 열기로 확인한다.
- 입력을 열 때마다 `inputEpoch`가 오른다. 포착은 이 값을 세대 토큰에 넣는다(2.5).
- 카메라 해상도는 `ideal` 1280×720으로 요청한다. K-11이 미정이라 V4 iPhone 실측 값을 시작값으로 썼다. 녹화 파일 기본값은 `/demo/pizza-alone.mp4`이고 `setVideoUrl()`로 바꾼다. mp4의 fps는 브라우저가 알려 주지 않으므로 `InputSource.fps = 0`(모름)으로 둔다.
- 광각(양옆 휘어짐, 2026-11-01): 기본으로 켜져 있다. vision은 `<video>` 대신 `grabFrame()`의 휜 프레임을 읽고, 미리보기도 그 캔버스를 붙인다. 위치·기본값·한계는 `docs/designs/input-wide-warp.md`.

### 2.2a 코디 스캔 실시간 받아쓰기(2026-11-01, 사용자 결정)

- `src/input/scribe.ts`의 `startScribe({ onPartial, onCommitted, onError })`를 C의 말 막대가 부른다. 마이크를 여는 일이라 A 디렉터리에 둔다(02-SSRD §1).
- 흐름
  1. `POST /api/scribe-token`(트랙 B)으로 일회용 토큰 `{ token }`을 받는다.
  2. 마이크를 `AudioContext(16kHz)`와 `public/pcm-worklet.js`로 16kHz Int16 PCM 4096샘플 조각으로 바꾼다.
  3. `wss://api.elevenlabs.io/v1/speech-to-text/realtime?token=…`에 연결한다. 파라미터는 `scribe_v2_realtime`, `pcm_16000`, `ko`, `vad`(SAI 검증값)이다.
  4. `input_audio_chunk { audio_base_64, commit: false, sample_rate: 16000 }`를 보낸다. `session_started` 전 오디오는 쌓아 둔다(5초 넘으면 실패).
  5. `partial_transcript`는 `onPartial`, `committed_transcript`는 `onCommitted`로 넘긴다.
- `stop()`: 워크릿 flush → 꼬리 오디오 → 마이크 정지 → 수동 commit(보낸 오디오가 2.1초 미만이면 무음으로 채움) → 확정 응답이나 1.5초 → 닫고 확정 글자 전체를 준다. 30초면 스스로 같은 정지를 한다.
- `startScribe`는 거부하지 않는다. 토큰·마이크·연결·제공사 오류(공식 문서의 오류 종류)는 `onError`로 한 번만 온다. C는 그때 브라우저 내장 받아쓰기로 넘어간다. 정지 뒤 확정을 기다리는 중의 오류는 조용히 닫는다.
- 오디오를 저장하지 않는다. 끝나면 마이크 트랙·AudioContext·소켓을 바로 닫는다. 녹음 중 여부(불값)는 `subscribeScribe`로 보고, core에 `setMicRecording`이 생기면 그것도 부른다.
- 메시지 처리와 워크릿은 사용자의 SAI 프로젝트(`apps/sai/src/server/eleven.ts`, `web/components/microphone.ts`, `web/public/pcm-worklet.js`)에서 옮겼다. SAI는 서버가 키 헤더로 중계했다. 여기서는 Vercel 함수가 웹소켓을 붙들 수 없어 브라우저가 토큰 쿼리로 바로 연결한다. 공식 문서 기준으로 `sample_rate`를 더했다.

### 2.3 모델과 WASM

- 모델 경로는 `vision/config.ts`의 `MODEL_PATHS` 하나에 모았다. 모델은 사용자가 고른다.
  - 파일이 없으면 상태가 `missing`이 되고 판정은 돌지 않는다.
  - 파일을 넣고 `loadModels()`를 다시 부르면 붙는다.
- 모델 파일은 직접 `fetch`하고 응답 형식을 확인한 뒤 `modelAssetBuffer`로 넘긴다. Vite 개발 서버가 없는 파일에도 `index.html`(200)을 돌려주기 때문이다.
- 두 모델은 `runningMode: 'IMAGE'` 인스턴스를 하나씩 쓴다. 0단계(640 캔버스), 포착 재검출(원본 프레임), 얼굴 검출(조각, 출구 JPEG)이 모두 같은 인스턴스를 쓴다. MediaPipe 호출은 동기라 차례대로 돈다.
- C에 엔진 상태를 알린다(track-c/screens가 core에 더하는 `engine`·`setEngine`, core에 아직 없으면 부르지 않는다). 모델 받기 시작 = `loading`(받은 바이트·전체 바이트), 0단계 첫 추론 = `ready`, 파일 없음·GPU와 CPU 모두 실패 = `failed`(사유 한 줄, NFR-022).
- 만든 직후 빈 캔버스로 한 번씩 돌려 예열한다. 첫 포착이 GPU 준비 때문에 느려져 쿨다운 간격이 흔들리는 것을 막기 위해서다.
- WASM은 `postinstall`(`scripts/copy-wasm.mjs`)이 `node_modules/@mediapipe/tasks-vision/wasm/`에서 SIMD판과 nosimd판만 `public/wasm/`으로 복사한다. 레포에는 넣지 않는다(`.gitignore`).

### 2.4 0단계(F2, FR-006~009)

- 반복 방식은 셋이다.
  - 프레임 콜백(`requestVideoFrameCallback`)이 있으면 그것으로 200ms 간격을 맞춘다.
  - 콜백이 두 간격 넘게 오지 않으면(화면에 그려지지 않는 `<video>`, 숨은 탭) 타이머가 대신 돈다.
  - 콜백이 없는 브라우저는 `setInterval`을 쓴다.
  - 한 번에 하나만 돌고, 밀린 프레임은 버린다.
- 긴 변 640 캔버스(비율 유지)에서 검출한다. 검출이 끝나면 그 캔버스를 지운다(`clearRect`).
- 장면 선택(`classifyScene`)
  - 점수 0.4 이상이고 **박스 중심**이 가운데 60%(가로·세로 각각) 안에 있어야 한다. 박스 전체를 요구하면 가까이 든 피자가 `none`이 된다.
  - 음식 12종이 사람보다 우선한다. 같은 종류끼리는 프레임 중심에 가까운 쪽을 고른다.
  - 사람은 프레임 면적의 5% 이상일 때만 대상이다.
  - N(화면 속 사람 수)은 영역·면적 필터 없이 0.4 이상인 사람 수다.
- 음식 라벨 12종은 고정 칼로리표 10종에 `bowl`·`cup`을 더한 것이다. 05 결정 21이 가리키는 "AGENTS.md 원문"이 레포에 없어서 02-SSRD IF-08과 PRD 위험 표로 만들었다.
- 상태기계는 03-SRS §4.1 그대로다. 한 틱이라도 다른 라벨이 나오면 후보부터 다시 센다. 확정되는 틱에 `addSceneDecision`을 한 번 쓴다.
- `setLiveObservation`
  - `label`은 **확정 장면**이다(확정 전이면 `none`). FR-008에 맞춘 것이다.
  - `objectLabel`·`targetBox`는 **이번 틱의 대상**이다(후보 포함). HUD "대상 위치"가 확정 전에도 따라 움직이게 하기 위해서다(FR-034). 02-SSRD §1의 미리보기 행도 이 값으로 고쳤다.
- `recordRuns`는 틱마다 `{ stage0Runs: 1, sourceFrames }`를 쓴다. `sourceFrames`는 `getVideoPlaybackQuality().totalVideoFrames`의 증가분이다. 포착 재검출도 같은 물체 검출 모델 호출이므로 `stage0Runs`에 1을 더한다. 처리량 비율이 모델 호출을 빠짐없이 세게 하기 위해서다.
- 입력이 바뀌거나(`inputEpoch`) 새 세션이 되면 상태기계를 `none`으로 되돌린다.

### 2.5 포착 게이트와 세대(FR-010·012, §4.1)

- 0단계 틱마다 `planCapture`가 플러그인을 `pluginOrder` 순서로 본다. 다음을 모두 만족하면 포착 대상이다.
  - 장면이 확정(L) 상태다.
  - `selectCanSend`가 참이다.
  - `now ≥ cooldownUntil`이고 `!busy`다.
  - iframe의 `runtimePolicy.manifestVersion`이 `manifest.version`과 같다.
- L이 플러그인의 `scenes`에 없으면 포착하지 않고 `skip`("선언하지 않은 장면")을 남긴다. 보낼 수 있는 플러그인에만 남기고, 같은 사유는 10초에 한 번만 남는다(스토어가 거른다).
- 한 틱에 포착 대상이 여럿이면 프레임 뜨기, 재검출, 가림은 **한 번만** 한다. 축소, 인코딩, 출구 재검사는 플러그인마다 따로 한다. 가림은 `maxSide` 축소 전 조각에서 하므로 플러그인마다 결과가 같다(A-10).
- 포착은 한 번에 하나만 돈다(모듈 잠금 `inFlight`). 스토어의 `busy`는 표시와 게이트에만 쓴다. 새 세션이 `busy`를 false로 되돌리기 때문에 잠금으로 쓸 수 없다.
- **세대 토큰:** 포착을 시작할 때 `{session.id, inputEpoch}`와 플러그인별 `runtimeId`·`manifestVersion`을 읽어 둔다. 그 뒤 await마다 스토어에 쓰기 직전에 대조한다(hold 로그, 전달, 쿨다운). 다르면 그 플러그인에는 아무것도 쓰지 않고 포착을 버린다. `prepareDelivery`도 `runtimeId`·버전을 마지막으로 다시 본다.
- **쿨다운:**
  - 시작할 때 `시작 시각 + 60/maxPerMinute`로 예약한다(05 결정 17).
  - 끝날 때 `max(예약값, 끝난 시각 + 간격)`으로 늘린다. 전달은 끝날 때 일어나므로 이렇게 해야 FR-012의 "어느 60초 창에서도 ≤ maxPerMinute"가 첫 포착이 느릴 때도 지켜진다.
  - 전달, 2d, 출구 재검사 보류, 대상 재검출 실패는 쿨다운을 시작한다(A-1·A-2).
  - 전환으로 버린 포착은 예약 전 값으로 되돌린다. 새 세션이면 스토어가 되돌린 값을 그대로 둔다.

### 2.6 포착·분기(FR-011·013~018, §4.2)

1. 원본 해상도 프레임 한 장(`drawImage(video)`)에 EfficientDet를 다시 돌린다. 필터 없이 점수 0.3 이상인 사람을 쓴다. 대상은 **이번 틱의** `objectLabel`·`targetBox`로 찾는다. 같은 라벨 중 그 박스와 가장 많이 겹치는 것을 고른다. SceneDecision의 박스는 쿨다운 뒤에는 오래된 값이라 쓰지 않는다. 대상이 없으면 `hold`(branch 없음, "대상 재검출 실패")를 남긴다. `Delivery.objectLabel`(`x-label`)은 재검출 결과의 라벨이다.
2. 대상 박스를 변마다 10% 넓혀 원본 px로 자른다. 원본 프레임 캔버스는 조각을 자른 직후 비운다. 비교 모드가 함께 있으면 raw 인코딩을 마친 직후 비운다.
3. 조각에 BlazeFace를 한 번 돌린다. 긴 변이 256 미만이면 256으로 키운 사본에서 돌리고, 사본은 바로 비운다. 신뢰도 0.5 이상을 얼굴로 본다.
4. 분기. 사람 박스와 얼굴은 모두 원본 좌표로 비교한다.
   - 얼굴은 중심이 어떤 사람의 **머리 영역(위 40% + 좌우 10%)** 안에 있을 때만 그 사람에 대응한다. 사람 박스 안이기만 하면 대응으로 치면 몸통 앞의 다른 얼굴(옷, 사진, 뒤에 선 사람)을 그 사람 얼굴로 착각한다. 그러면 그 사람의 옆얼굴이 가려지지 않은 채 나간다. 머리 영역 둘 이상에 들어 있으면 **대응 불확실 → 2d**다.
   - 조각과 겹치는(O, 5% 초과) 사람마다 다음 중 하나를 적용한다.
     - 대응된 얼굴이 있으면 R2(얼굴 가림)
     - 대응된 얼굴이 없고 P(50% 이상)이면 R4 → **조각 전체 2d**
     - 대응된 얼굴이 없고 P가 아니면 R3(머리 영역 가림)
   - 사람에 대응되지 않은 얼굴도 모두 가린다(R5).
   - 분기 값: 2d가 하나라도 있으면 2d, 그다음 머리 가림이 있으면 2c, 얼굴 가림이 있으면 2b, 아무것도 없으면 2a다.
   - **03-SRS §4.2를 고쳤다:** "사람 박스가 조각 경계에서 크게 잘렸으면 2d"를 지웠다. 사람 박스는 원본 전체를 재검출해서 얻으므로 조각 경계에서 잘리지 않는다. 머리 영역도 원본 좌표로 계산해 조각과 겹치는 만큼 가린다. R3 자체가 조각 경계를 넘는 사람 박스를 전제한다. 이 줄을 남겨 두면 데모 4단계의 옆얼굴(2c) 장면이 대부분 2d가 된다.
5. 가림
   - 얼굴 박스는 변마다 15% 넓힌다. 머리 영역은 그대로 쓴다.
   - 둘 다 조각 좌표로 옮겨 6×6 격자로 줄였다가 키운다(`ctx.filter` 없음, C-1).
   - **원본 해상도 조각 캔버스 위에 바로 덮어쓴다.** 그래서 가리기 전 픽셀은 따로 남지 않고, 인코딩도 이 캔버스에서만 한다.
   - 2d면 조각을 비우고 `hold`를 남긴다.
6. 플러그인마다 긴 변이 `maxSide`보다 크면 줄이고 `quality`로 JPEG를 만든다(`toBlob`). 이 Blob을 `createImageBitmap`으로 디코딩해 BlazeFace를 한 번 더 돌린다(출구 재검사). ImageBitmap은 `close()`한다.
   - 1 이상이면 `hold`(branch `2d`, "출구 재검사")
   - 오류면 `hold`(branch `2d`, "검사 실패")
   - 두 경우 모두 쿨다운을 시작한다.
7. `Detection`
   - 조각과 겹치는 사람: 박스는 조각 기준 0~1로 자르고 `overlap`을 적는다.
   - 얼굴: `overlap`은 null이다.
   - `masked`에는 실제로 가린 종류를 적는다. 2d면 모두 `none`이다.
   - `facesMasked`는 `masked ≠ none`인 수다(ERD).
8. 모든 작업 캔버스(원본 프레임, 조각, 확대 사본, 축소본, 디코딩 캔버스)는 보류·예외 경로를 포함해 `finally`에서 비운다(`width = 0`).

### 2.6a 전송 범위 프레임(F24, 03-SRS FR-060·063, 02-SSRD "전송 범위 프레임")

- 포착을 시작할 때 `session.captureFrame`(0~1)을 한 번 읽는다. 원본 크기를 안 뒤 `frameRect = frameToPx(captureFrame, W, H)`(core `frame.ts`)로 바꿔 그 포착 끝까지 쓴다.
- 대상과 사람은 포착 프레임 **전체**에서 다시 찾는다(FR-013). 그다음 대상 박스를 10% 넓혀 core `cropToFramePx`(C의 끌기·스토어와 같은 좌표 함수)로 `frameRect`와의 교집합을 안쪽 정수 px로 맞춘다. 늘 `cropRect ⊆ frameRect`이고, 스토어 `prepareDelivery`도 이 조건을 다시 본다(어기면 거부).
- 겹치지 않거나 한 변이 2px 미만이면(core는 1px 미만만 null, A가 2px 미만 띠도 보낼 조각이 아니라고 본다) `hold`(branch 없음, "프레임 밖", `frameRect` 포함)로 끝내고 쿨다운을 시작한다. "대상 재검출 실패"와 같은 취급이다.
- 조각 캔버스에는 `cropRect`만 그린다. 그래서 프레임 밖 픽셀은 얼굴 검출, Selfie, 가림, 인코딩 어디에도 들어가지 않는다. O·P는 잘린 조각과 원본 좌표 사람 박스의 교집합으로 잰다(`decideBranch`가 원래 그렇게 잰다).
- `Delivery.frameRect`를 늘 채운다. 스토어가 deliver 로그에 복사한다. "프레임 밖" hold에도 `frameRect`를 넣고, 다른 hold·skip에는 넣지 않는다.
- 비교 모드: raw는 `cropRect = frameRect`다(스토어가 raw인데 `frameRect`가 없거나 다르면 거부한다). 프레임 안 전체를 원본 해상도로, 가리지 않고 보낸다. `areaRatio`는 프레임 면적 / 원본 면적이다.
- 0단계 장면 판정은 지금처럼 전체 화면(가운데 60% 규칙)에서 한다. 프레임은 포착부터 적용한다.

### 2.7 비교 모드(F17)

- `compareMode`이고, 칼로리 플러그인이고, iframe이 `connect: 'none'`으로 ready면 분기표를 건너뛴다. 원본 프레임 전체를 **원본 해상도**로 `raw`로 보낸다(05 결정 30).
- 출구 재검사 값은 `faceCheck`에 쓰고 보류하지 않는다(M·K 측정용). 검사 오류면 보내지 않는다.
- 쿨다운과 `maxPerMinute`는 그대로 적용한다(K-17). raw 조건은 스토어 `prepareDelivery`가 마지막으로 검사한다(G1).

### 2.7a Selfie 모양 가림(F23, 03-SRS FR-016a, 1차 통합 뒤 별도 PR)

- 원칙: 어디를 볼지는 BlazeFace와 사람 검출이 정하고, Selfie Multiclass는 그 사각형 안에서 가릴 모양만 정한다. 분기, 카운터, 출구 재검사는 바뀌지 않는다.
- 로딩(`vision/segmenter.ts`)
  - 0단계 첫 추론 직후에 받기 시작한다. 16.4MB라 첫 판정을 늦추지 않기 위해서다.
  - GPU로 먼저 만들고, 실패하면 CPU로 만든다.
  - 받은 직후 빈 256 캔버스로 한 번 돌려 예열한다. 예열 동안 메인 스레드가 멈춘다(노트북 5.2초, iPhone 데모 11.6초). 첫 판정 뒤에 치르므로 첫 판정은 늦지 않지만, 그동안 0단계도 멈춘다.
- 가림(`capture.applyMasks`)
  - 가림 사각형이 하나 이상일 때만 돈다(2b·2c). 2a에서는 돌리지 않는다.
  - 가리기 전 조각에 Selfie를 한 번 돌리고 `categoryMask`를 콜백 안에서 복사한다.
  - 사각형마다 머리카락(1)·얼굴 피부(3) 픽셀을 고른다. 마스크는 조각 크기로 최근접 확대해 읽는다.
  - 고른 마스크를 조각 긴 변의 2%(최소 3px)만큼 팽창한다. 사각형 밖 픽셀도 팽창의 출발점이 되지만, 결과는 사각형 안만 쓴다.
  - 사각형 전체를 6×6으로 픽셀화한 사본을 만들고, 마스크 픽셀에만 덮는다.
  - 모든 사각형의 모양을 먼저 정한 뒤 가린다. 앞 사각형의 픽셀화가 뒤 사각형 판정에 섞이지 않게 하기 위해서다.
- 사각형 전체를 가리는 경우(FR-015·016대로)
  - Selfie가 아직 없을 때
  - Selfie가 실패했을 때
  - 그 사각형에 해당 픽셀이 하나도 없을 때
  - 그 종류의 모양 가림을 껐을 때. 설정값은 `selfieShapeFace`·`selfieShapeHead`이고, V2·V3에서 2c가 사각형보다 덜 가린 사례가 나오면 `selfieShapeHead = false`(사각형 ∪ Selfie = 사각형)로 둔다.
- 기록: 모양으로 가린 사각형이 있으면 deliver 로그 `reason`에 "Selfie 모양 가림 k/n"을 적는다. Selfie 호출은 처리량 비율(0단계 + 얼굴 검출)에 넣지 않는다.
- Selfie 작업에도 MediaPipe 로그 로거가 붙는다. 호스트 가드가 없으면 60초마다 로그 요청이 3건 나간다(V15).

### 2.7b 코디 스캔 응시 동의(`docs/designs/outfit-pipelines.md`, 2026-11-01)

- 동의한 사람 이어 보기(`geometry.withConsentedPerson`, 2026-11-01): 이번 틱 장면이 none이고 person 장면을 받는 앱이 켜져 있으면, 살아 있는 동의의 사람(추적 기준 0.3으로 보인 사람 중 가장 가운데)을 person 대상으로 둔다.
  - 점수가 장면 기준 0.4 근처에서 오르내리면 person 장면이 1초를 잇지 못해, 동의를 받고도 코디 스캔에 조각이 가지 않았다("아직 보낼 사진이 없어요").
  - 음식 장면과 이미 잡힌 person 대상은 그대로다. 포착은 동의를 다시 보므로 동의 없이 보내는 길은 생기지 않는다.
- 사람 장면 하한 `personMinArea`는 5%에서 2%로 내렸다(2026-11-01). 멀리 선 사람(상반신이 프레임 높이 15%, 넓이 3% 안팎)은 응시·동의까지 됐다. 그런데 person 장면이 확정되지 않아 코디 스캔에 포착이 아예 가지 않았고, 보류 사유도 남지 않았다. person 장면 앱(코디 스캔)은 동의가 있어야만 보내므로 하한을 내려도 보내는 범위는 넓어지지 않는다.

- 사람 추적(`vision/track.ts` 순수 함수, `vision/gaze.ts` 상태)
  - 0단계 틱마다 사람 상자(`trackScoreMin` 0.3 이상, 소스 프레임 0~1)를 이전 추적과 IoU `trackIouMin`(0.3) 이상인 쌍끼리 큰 순으로 잇는다. 못 이으면 새 `trackId`(`p1`, `p2` …, 페이지 동안 되돌리지 않음)다.
  - 한 상자가 이전 추적 둘 이상과(또는 그 반대로) 0.3 이상 겹치면 잇지 않는다. 사람이 엇갈릴 때 동의가 다른 사람에게 옮겨 가는 것보다 끊기는 쪽이 안전하다. 끊긴 동의는 `CONSENT_LOST_MS` 뒤 사라진다.
  - 안 보인 추적은 `trackKeepMs`(2초, `CONSENT_LOST_MS`와 같음) 동안 남긴다. 입력 전환·새 세션·0단계 정지 때 비운다.
  - IoU로 못 이은 상자는 중심 거리로 한 번 더 잇는다(2026-11-01). 조건은 중심 거리 ≤ `trackCenterGate`(0.6) × 큰 변, 넓이 비 0.5~2배, 양쪽 모두 짝이 하나뿐일 때다. 빠르게 움직이거나 0단계가 느리면(휴대폰) 틱 사이 IoU가 0.3 아래로 떨어져 trackId가 바뀌고 응시 3초가 다시 시작됐다.
- 응시
  - 대상은 상자 중심이 프레임 가운데 원(짧은 변 × `GAZE_CENTER_RADIUS`, px로 잼) 안에 있고, 흰 틀과 겹치는 사람 중 가장 가운데다.
  - 이미 보고 있는 사람은 `gazeKeepRadius`(0.4) 원 안이면 대상으로 남는다(2026-11-01). 다른 사람이 0.18 원 안에 들어오면 그 사람으로 바뀐다.
    - 광각은 가운데를 약 1.47배 키운다. 그래서 0.18 원이 원본 기준 가로 ±7%에 그쳐, 손이나 머리가 조금만 흔들려도 3초가 다시 시작됐다.
    - C는 원을 그리지 않으므로 보이는 것과 어긋나지 않는다.
  - 같은 `trackId`가 `GAZE_DWELL_MS`(3초) 이어지면 틱마다 `setGazeCandidate({ trackId, box, since })`를 쓴다. 대상이 `gazeGraceMs`(1500ms, 처음 400ms) 넘게 비면 null이다.
  - 추적·응시·동의 유지에 넣는 사람 점수는 `trackScoreMin` 0.3(= `detectorScoreFloor`)이다. 장면 판정 기준 `stage0ScoreMin` 0.4와 따로 둔다(2026-11-01).
    - 멀리 서거나 일부만 보이는 사람은 점수가 0.4 근처에서 오르내려 틱마다 나타났다 사라졌다.
    - 트랙 C의 시뮬레이션(이 순수 함수 그대로, 점수 μ0.40·틱 400ms)에서 6초 안 칩이 52% → 100%, 동의 30초 유지가 57% → 97%였다. 같은 시뮬레이션을 하나씩 바꿔 돌려 보니 이 기준 하나가 거의 전부였다. `gazeGraceMs` 1500은 칩 쪽만 52% → 74%였고, 추적·동의 유지 4초는 더 나아지지 않았다.
    - 동의는 여전히 가운데 원 + 3초 + 착용자 탭으로만 생긴다.
  - 이미 동의한 사람을 보고 있으면 후보로 올리지 않는다(스토어도 같은 규칙).
- 동의 갱신: 동의가 있는 `trackId`가 그 틱에 보이면 `touchConsent(trackId, box)`. 동의를 만들고(`grantConsent`) 지우는(`tick`·`revokeConsent`) 것은 스토어와 C다.
- 코디 스캔 조각(`capture.protectOutfit`)
  - 살아 있는 동의(`selectActiveConsents`)를 포착을 시작할 때 한 번 읽는다. 없으면 보류 "동의한 사람 없음"(분기 없음, 쿨다운 적용)이다.
  - 조각의 주인은 살아 있는 동의 중 상자가 가장 가운데인 사람이다. 원본 전체 재검출의 사람 상자와 동의 상자를 IoU `consentMatchIouMin`(0.3)으로 잇는다. 못 이으면 보류 "동의한 사람 재검출 실패"다(가장 가까운 사람을 대신 보내지 않는다).
  - 조각은 동의한 사람의 재검출 박스 ∩ 흰 틀(`cropToFramePx`, 넓히지 않음)이다.
  - 가림은 `decideBranch(..., body)`다. 동의하지 않은 사람(어느 동의와도 이어지지 않은 재검출 사람)은 조각과 겹치면 사람 박스 전체를 6×6으로 가린다(`MaskKind 'body'`). 몸을 다 덮으므로 R3·R4를 보지 않는다. 동의한 사람과 얼굴은 기존 R2~R5 그대로다. 그래서 동의한 사람도 얼굴을 못 찾으면 R4 보류다. 얼굴-사람 대응 불확실 보류와 출구 재검사도 그대로다.
  - 몸 전체 조각에서는 얼굴이 작아 BlazeFace short-range가 놓치기 쉽다. 그래서 동의한 사람(과 다른 동의한 사람)의 머리 영역 ∩ 조각을 따로 잘라 한 번 더 찾고(작으면 `faceMinSide`로 키움), 조각 전체 결과와 IoU 0.3으로 합친다.
  - 원본 전체 재검출은 한 번만 한다. 장면 대상 조각(칼로리 등)과 코디 스캔 조각이 같이 쓴다. deliver 로그 `reason`에 "몸 가림 n명"을 적는다.

### 2.8 중개기와 B 연결

- `broker.deliver`의 순서
  1. `sha256`(`crypto.subtle`, 없으면 순수 JS)을 구한다.
  2. 보낸 Blob 그대로 썸네일 object URL을 만든다.
  3. `prepareDelivery`를 부른다.
  4. `sendDelivery`를 부른다.
  - `prepareDelivery`가 null이면 썸네일 URL을 해제하고 버린다.
- B 모듈이 아직 없으므로 중개기는 B를 import하지 않고 **`connectPluginHost(send)`로 받는다.** 연결은 하나만 받는다. 이미 연결돼 있으면 거부(경고)하고, 돌려준 함수로 끊은 뒤에만 다시 받는다. 02-SSRD IF-02에 계약으로 적었다.
  ```ts
  type SendDelivery = (pluginId: string, msg: Extract<HostToPlugin, { type: 'delivery' }>) => void;
  // B는 돌아오기 전에 markDelivery(id, 'dispatched' | 'failed')를 쓴다.
  ```
- `markDelivery`는 B가 쓴다. 다만 다음 경우에는 중개기가 `failed`로 바꾼다. `markDelivery`는 `prepared`에서만 바뀌므로 B가 먼저 바꿨으면 아무 일도 일어나지 않는다.
  - 연결된 호스트가 없을 때
  - `send`가 예외를 던졌을 때
  - `send`가 돌아온 뒤에도 `prepared`일 때

## 3. 고르지 않은 방법

| 방법 | 고르지 않은 이유 |
| --- | --- |
| `liveObservation.label`을 이번 틱 장면으로 | HUD가 1초 확정 전에 "음식 앞"을 보여 FR-008과 어긋난다. 장면이 풀렸는지도 SceneDecision만으로는 알 수 없다 |
| 0단계와 재검출에 VIDEO 모드 인스턴스 따로 | 모델 메모리가 두 배다. 5fps라 IMAGE 모드로 충분하다(V1 시험 페이지도 같은 구성) |
| 플러그인마다 프레임·가림 따로 | 같은 계산을 반복하고, 같은 순간인데 분기가 달라질 수 있다 |
| 중개기가 `src/plugins/host`를 직접 import | B가 아직 없어 컴파일되지 않는다(core-store §3과 같은 이유) |
| 얼굴을 사람 박스 전체에 대응 | 몸통 앞 다른 얼굴로 R2가 되어 옆얼굴이 그대로 나간다(리뷰 1번) |
| 잘린 사람 박스를 모두 2d | 원본 재검출이라 조각 경계에서 잘리지 않고, 2c 데모 장면이 보류된다 |
| 쿨다운을 시작 시각으로만 | 첫 포착이 느리면 60초 창에 7건이 들어갈 수 있다(TC-023, 리뷰 4번) |
| raw를 640으로 축소 | 05 결정 30(원본 해상도 유지)과 다르다 |

## 4. 남은 위험

- **한 틱 끊김:** 상태기계는 한 틱이라도 놓치면 처음부터 센다. 실제 피자 영상에서 확정까지 오래 걸리면 `confirmMs`보다 점수 하한(`stage0ScoreMin`)부터 본다.
- **손에 든 피자는 거의 늘 P:** 사람 앞에 든 피자의 조각은 사람 박스 안에 들어가 겹침이 50% 이상이 된다. 그래서 옆얼굴(얼굴 미검출)이면 R4 → 2d가 된다. 데모 소재 표가 기대한 2c는 피자가 사람 박스 가장자리에 걸칠 때만 나온다. V2·V3에서 `holdOverlap`과 함께 본다.
- **픽셀화된 얼굴 오검출:** 출구 재검사가 6×6 얼굴을 다시 얼굴로 보면 2b가 모두 보류된다. V2에서 본다.
- **숨은 창 측정:** 탭이 숨겨지면 타이머와 프레임 콜백이 느려진다. V1 fps는 화면에 띄운 창에서 잰다.
- **가까운 상반신은 R4:** 머리 영역은 사람 박스 위 40%다. 머리·어깨만 보이는 가까운 장면은 얼굴 중심이 그 아래(이모지 시험에서 44%)로 내려가 동의한 사람의 얼굴로 치지 않고, R4로 보류된다. 상반신·전신(얼굴 중심 15~25%)은 해당하지 않는다. 안전한 쪽으로 틀리므로 규칙은 바꾸지 않았다.
- **카메라 해상도:** 노트북 웹캠에서 1280×720 원본을 `drawImage`하고 재검출하는 시간은 아직 재지 않았다(V4).

## 5. 확인 방법

- `npm run check:runtime`(`scripts/check-runtime.ts`)
  - 좌표, 장면 선택 경계, 상태기계, 대상 재검출
  - 분기 결정표(R1~R5, 5%·50% 경계, 여러 사람, 머리 영역 밖 얼굴)
  - 쿨다운
  - 포착 게이트(쿨다운·busy·일시 정지·매니페스트 전환·비교 모드)
  - 순수 JS SHA-256
- `/dev/` 페이지는 개발 서버 전용이다(프로덕션 빌드 입력이 아니다). 다음을 볼 수 있다.
  - 입력 선택, 모델 상태, 대상 박스 겹치기, SceneDecision, 처리량, 0단계 fps·추론 시간
  - B 목 호스트(300ms 뒤 ready, dispatched, ack)
  - 발표자 버튼(비교 모드, 일시 정지, 새 세션, `maxSide` 64)
  - 로그·전달 표

## 6. 리뷰 기록

맥락 없는 EGM 설계 리뷰어(egm-design) 한 명이 초안과 첫 PR 코드를 봤다(2026-10-31). Blocker는 없었다. Major 8개는 모두 반영했다.

| 지적 | 반영 |
| --- | --- |
| 얼굴을 사람 박스 전체에 대응 | 머리 영역 안으로 좁혔다(2.6-4) |
| 포착 중 전환 뒤 hold·쿨다운·busy 쓰기 | 세대 토큰과 모듈 잠금(2.5) |
| `openCamera`가 seq 확인 전에 `<video>`를 차지 | `getUserMedia` 직후 확인, 열기 시작 때 소스 끊기, input null이면 0단계 쉼(2.2) |
| 쿨다운 시작 시각만으로는 FR-012가 깨질 수 있음 | 끝날 때 늘리고 예열한다(2.3, 2.5) |
| 확대 사본·보류·예외·raw·ImageBitmap·0단계 캔버스의 픽셀 수명 | `finally`로 비우고 0단계 캔버스는 지운다(2.4, 2.6-8) |
| 대상 출처가 모호함 | 이번 틱 대상, `objectLabel`은 재검출 라벨(2.6-1) |
| raw 640 축소가 결정 30과 다름 | 원본 해상도(2.7) |
| "크게 잘림" 삭제는 명세 변경 | 03-SRS §4.2를 같은 PR에서 고쳤다 |

Nit 중 받은 것: 02-SSRD §1 HUD 대상 위치를 `liveObservation.targetBox`로 고쳤다. 출구 재검사 보류의 branch는 `2d`로 하고 쿨다운을 시작한다. BlazeFace를 돌릴 때마다 `recordRuns`를 부른다. `send` 뒤에도 `prepared`면 `failed`로 바꾼다. 연결은 하나만 받는다. 받지 않은 것: `types.ts` 주석 추가. `core/`는 합의해서 바꾸는 곳이라 02-SSRD 문구 수정만 했다.
