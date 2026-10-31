# 설계: 트랙 A 런타임(입력·0단계·포착·가림·중개기)

상태: EGM 리뷰 반영 전 초안, 사용자 승인 대기(PR 머지 = 승인) · 2026-10-31 · 근거: `docs/specs/02-SSRD.md` §1·§2·IF-02·§4, `docs/specs/03-SRS.md` FR-001~018·FR-051·FR-055, §4.1·§4.2, `docs/designs/core-store.md` · 코드: `src/input/`, `src/vision/`, `src/broker/`

## 1. 풀려는 문제

명세는 무엇을 해야 하는지(입력 3종, 5fps 판정, 1초 확정, +10% 포착, 2a~2d, 출구 재검사)는 정했지만 다음은 비워 두었다.

- 스토어의 어떤 값을 언제 쓰는지(`liveObservation.label`이 확정 장면인지 이번 틱 장면인지 등)
- 한 프레임에서 플러그인 여럿이 포착할 때 프레임·검출을 나눠 쓰는지
- 포착 중에 입력·플러그인이 바뀌었을 때 어디서 버리는지
- B 코드가 아직 없는데 중개기가 `sendDelivery`를 어떻게 부르는지
- 모델 파일이 아직 없을 때 어떻게 도는지

## 2. 결정

### 2.1 모듈과 원본 픽셀의 경계

| 파일 | 하는 일 | 원본 픽셀 |
| --- | --- | --- |
| `input/adapter.ts` | `<video playsInline muted autoplay>` 하나를 만들고 웹캠·후면·mp4를 연다. `startInput()`이 `session.inputRequest`를 `fireImmediately`로 구독한다. `mountPreview(container)` | `getUserMedia`, `srcObject` |
| `vision/models.ts` | 모델 두 개를 GPU로 만들고 실패하면 CPU | 없음 |
| `vision/stage0.ts` | 0단계 반복, 장면 상태기계, `addSceneDecision`·`setLiveObservation`·`recordRuns` | `drawImage(video)` |
| `vision/capture.ts` (둘째 PR) | 포착 게이트, 포착·재검출·가림·분기·축소·인코딩·출구 재검사 | `drawImage(video)`, `toBlob`, `createImageBitmap` |
| `broker/broker.ts` (둘째 PR) | `prepareDelivery`, `sendDelivery` 호출(유일), hold·skip 로그 | 없음(가린 Blob만) |
| `vision/geometry.ts`, `vision/scene.ts` | 순수 함수(좌표, 장면 선택, 상태기계, 분기 결정) | 없음 |

- `<video>`와 MediaStream은 스토어에 넣지 않는다. `getVideo()`는 `vision/`만 import한다.
- 시작점은 `startRuntime()`(`vision/index.ts`) 하나다. 여러 번 불러도 구독·반복은 하나다(HMR·StrictMode). 앱 연결(`main.tsx`에서 부르기)은 통합 PR에서 한다.

### 2.2 입력(F1·F10)

- 요청이 없으면 기본 입력을 연다: 폭 768px 미만 후면, 이상 웹캠, `/hud`는 녹화.
- 카메라가 실패하면(권한 거부·장치 없음·HTTP·8초 시간 초과) 녹화 영상으로 바꾸고 `InputSource.fallbackFrom`에 원래 종류를 쓴다(FR-004).
- 입력을 열 때마다 `inputEpoch`가 오른다. 포착은 시작할 때 이 값을 읽고, 끝날 때 다르면 버린다(입력 전환은 iframe을 다시 만들지 않고 A가 진행 중 포착만 버린다, core-store §2.1).
- 카메라 해상도는 `ideal` 1280×720(K-11 미정, V4 iPhone 실측 값을 시작값으로). 녹화 파일 기본값은 `/demo/pizza-alone.mp4`, `setVideoUrl()`로 바꾼다.
- mp4의 fps는 브라우저가 알려 주지 않아 `InputSource.fps = 0`(모름)이다.

### 2.3 모델과 WASM

- 경로는 `vision/config.ts`의 `MODEL_PATHS` 하나에 모았다. 모델은 사용자가 고른다. 파일이 없으면 상태가 `missing`이 되고 판정은 돌지 않는다. 파일을 넣고 `loadModels()`를 다시 부르면 붙는다.
- 모델 파일은 직접 `fetch`해 응답 형식을 본다. Vite 개발 서버는 없는 파일에 `index.html`(200)을 돌려주기 때문이다. 그 버퍼를 `modelAssetBuffer`로 넘긴다.
- 두 모델 모두 `runningMode: 'IMAGE'` 인스턴스 하나씩이다. 0단계(640 캔버스), 포착 재검출(원본 프레임), 얼굴 검출(조각) 모두 같은 인스턴스를 쓴다. MediaPipe 호출은 동기라 순서대로 돈다.
- WASM은 `postinstall`(`scripts/copy-wasm.mjs`)이 `node_modules/@mediapipe/tasks-vision/wasm/`에서 SIMD·nosimd 판만 `public/wasm/`으로 복사한다. 레포에는 넣지 않는다(`.gitignore`). Vercel도 설치 때 복사된다.

### 2.4 0단계(F2, FR-006~009)

- 프레임 콜백(`requestVideoFrameCallback`)이 있으면 그것으로, 없으면 `setInterval`로 200ms 간격을 맞춘다. 콜백이 두 간격 넘게 안 오면(DOM에 없는 `<video>`) 직접 돈다. 한 번에 하나만 돌고 밀린 프레임은 버린다.
- 긴 변 640 캔버스(비율 유지)에서 검출한다. 장면 선택(`classifyScene`): 점수 0.4 이상, **박스 중심**이 가운데 60%(가로·세로 각각) 안, 음식 12종이 사람보다 우선, 같은 종류는 프레임 중심에 가까운 쪽, 사람은 프레임 면적 5% 이상. N(화면 속 사람 수)은 영역·면적 필터 없이 0.4 이상인 사람 수다.
- 음식 라벨 12종: 고정 칼로리표 10종 + `bowl`·`cup`. 05 결정 21이 가리키는 "AGENTS.md 원문"은 레포에 없어서 02-SSRD IF-08과 PRD 위험 표로 만들었다.
- 상태기계는 03-SRS §4.1 그대로다(한 틱이라도 다른 라벨이면 후보부터 다시). 확정되는 틱에 `addSceneDecision`을 한 번 쓴다.
- `setLiveObservation`: `label`은 **확정 장면**(확정 전이면 `none`), `objectLabel`·`targetBox`는 **이번 틱의 대상**(후보 포함)이다. HUD "장면"은 확정만 보이고, "대상 위치"는 확정 전에도 따라 움직인다.
- `recordRuns`는 틱마다 `{ stage0Runs: 1, sourceFrames }`. `sourceFrames`는 `getVideoPlaybackQuality().totalVideoFrames`의 증가분이다.
- 입력이 바뀌거나(`inputEpoch`) 새 세션이면 상태기계를 `none`으로 되돌린다.

### 2.5 포착 게이트(FR-010·012, §4.1)

- 0단계 틱마다 플러그인 순서(`pluginOrder`)대로 본다. 장면 = 확정(L) ∧ `selectCanSend` ∧ `now ≥ cooldownUntil` ∧ `!busy`이면 포착 대상이다. L이 그 플러그인의 `scenes`에 없으면 포착하지 않고 `skip`("선언하지 않은 장면")을 남긴다(보낼 수 있는 플러그인에만, 같은 사유 10초 1번은 스토어가 거른다).
- 한 틱에 대상 플러그인이 여럿이면 **프레임·재검출·가림을 한 번만** 하고 축소·인코딩·출구 재검사만 플러그인마다 한다. 가림은 `maxSide` 축소 전 조각에서 하므로(A-10) 플러그인마다 같다.
- 쿨다운(`60 / maxPerMinute`초)은 **포착을 시작한 시각**부터 센다. 전달, 2d, 대상 재검출 실패에서 시작한다(A-1·A-2). 전환 때문에 버린 포착은 쿨다운을 시작하지 않는다.

### 2.6 포착·분기(FR-011·013~018, §4.2)

1. 포착 시작 때 플러그인의 `runtimeId`, `runtimePolicy.manifestVersion`, 매니페스트(`maxSide`·`quality`)와 `inputEpoch`를 읽어 둔다. `manifest.version ≠ runtimePolicy.manifestVersion`이면 시작하지 않는다.
2. 원본 해상도 프레임 한 장(`drawImage(video)`)에 EfficientDet를 다시 돌린다(필터 없음, 사람 0.3 이상). 0단계 대상과 같은 라벨 중 0단계 박스와 가장 많이 겹치는 것을 대상으로 고른다. 없으면 `hold`(branch 없음, "대상 재검출 실패").
3. 대상 박스를 변마다 10% 넓혀 원본 px로 자른다. 원본 프레임 캔버스는 여기서 바로 비운다.
4. 조각(긴 변 256 미만이면 256으로 확대)에 BlazeFace 1회, 0.5 이상이 얼굴.
5. 분기(사람 박스는 원본 좌표, 얼굴은 원본 좌표로 옮겨 비교):
   - 얼굴은 중심이 들어 있는 사람 박스에 대응한다. 둘 이상의 사람 박스에 들어 있으면 **대응 불확실 → 2d**.
   - 조각과 겹치는(O, 5% 초과) 사람마다: 대응된 얼굴이 있으면 R2(얼굴 가림), 없고 P(50% 이상)면 R4 → **조각 전체 2d**, 아니면 R3(머리 영역 가림).
   - 사람에 대응되지 않은 얼굴도 모두 가린다(R5).
   - 분기 값: 2d가 하나라도 있으면 2d, 아니면 머리 가림이 있으면 2c, 얼굴 가림이 있으면 2b, 없으면 2a.
   - "사람 박스가 조각 경계에서 크게 잘림"은 따로 보류하지 않는다. 머리 영역을 원본 좌표로 계산해 조각과 겹치는 부분만큼 가리므로 잘린 사람의 머리도 조각 안에 든 만큼 가려진다. 이것을 보류로 만들면 데모 4단계의 옆얼굴(2c) 장면이 대부분 2d가 된다.
6. 가림: 얼굴 박스 변마다 +15%, 머리 영역(사람 박스 위쪽 40% + 좌우 10%)을 조각 좌표로 옮겨 6×6 격자로 줄였다 키운다(`ctx.filter` 없음, C-1). 조각 캔버스 위에서 바로 덮어쓰므로 가리기 전 픽셀은 따로 남지 않는다. 2d면 여기서 조각을 비우고 `hold`를 남긴다.
7. 플러그인마다 긴 변 > `maxSide`이면 줄이고 `quality`로 JPEG(`toBlob`). 이 Blob을 `createImageBitmap`으로 디코딩해 BlazeFace 1회(출구 재검사). 보호 모드에서 1 이상이면 `hold`("출구 재검사"), 오류면 `hold`("검사 실패").
8. `Detection`: 조각과 겹치는 사람(박스는 조각 기준 0~1로 자름, `overlap`), 얼굴(`overlap` null). `masked`는 실제 가린 종류. `facesMasked` = `masked ≠ none` 수(ERD).

### 2.7 비교 모드(F17)

- `compareMode`이고 칼로리 플러그인이면 분기표를 건너뛰고 원본 프레임 전체를 긴 변 640(명세 "축소 여부 미정")으로 줄여 `raw`로 보낸다. 출구 재검사 값은 `faceCheck`에 쓰고 보류하지 않는다(M·K 측정). 검사 오류면 보내지 않는다.
- 쿨다운·`maxPerMinute`은 그대로 적용한다(K-17). raw 조건 검사는 스토어 `prepareDelivery`가 마지막으로 한다(G1).

### 2.8 중개기와 B 연결

- `broker`가 하는 일: `sha256`(`crypto.subtle`, 없으면 순수 JS) → 썸네일 object URL(보낸 Blob 그대로) → `prepareDelivery` → `sendDelivery`. `prepareDelivery`가 null이면 썸네일 URL을 해제하고 버린다.
- B 모듈이 아직 없으므로 중개기는 B를 import하지 않고 **`connectPluginHost(send)`로 받는다.** B(또는 `main.tsx`)가 시작할 때 자기 `sendDelivery`를 한 번 넘긴다. 이 함수를 부르는 곳은 `broker.ts` 한 곳이다.
  ```ts
  type SendDelivery = (pluginId: string, msg: Extract<HostToPlugin, { type: 'delivery' }>) => void;
  // B: 거부·예외면 markDelivery(id, 'failed'), postMessage 성공이면 'dispatched'
  ```
- `markDelivery`는 B가 쓴다. 다만 연결된 호스트가 없거나 `send`가 예외를 던지면 `prepared`로 남지 않게 중개기가 `failed`로 바꾼다(`markDelivery`는 `prepared`에서만 바뀌므로 B가 먼저 바꿨으면 아무 일도 없다).

## 3. 고르지 않은 방법

| 방법 | 고르지 않은 이유 |
| --- | --- |
| `liveObservation.label`을 이번 틱 장면으로 | HUD가 1초 확정 전에 "음식 앞"을 보여 FR-008과 어긋난다. 장면이 풀렸는지도 SceneDecision만으로는 알 수 없다 |
| 0단계와 재검출에 VIDEO 모드 인스턴스 따로 | 모델 메모리가 두 배다. 5fps라 IMAGE 모드로 충분하다(V1 시험 페이지도 같은 구성) |
| 플러그인마다 프레임·가림 따로 | 같은 계산을 반복하고, 같은 순간인데 분기가 달라질 수 있다 |
| 중개기가 `src/plugins/host`를 직접 import | B가 아직 없어 컴파일되지 않는다(core-store §3과 같은 이유) |
| 잘린 사람 박스를 모두 2d | 2c 데모 장면(손에 든 피자 + 옆얼굴)이 보류된다(2.6-5) |

## 4. 남은 위험

- **한 틱 끊김:** 상태기계는 한 틱이라도 놓치면 처음부터다. 실제 피자 영상에서 확정까지 오래 걸리면 `confirmMs`가 아니라 점수 하한(`stage0ScoreMin`)부터 본다.
- **픽셀화된 얼굴 오검출:** 출구 재검사가 6×6 얼굴을 다시 얼굴로 보면 2b가 모두 보류된다. 실측(V2)으로 본다.
- **숨은 창 측정:** 탭이 숨겨지면 타이머·프레임 콜백이 느려져 fps가 낮게 나온다. V1 fps는 화면에 띄운 창에서 잰다.
- **카메라 해상도:** 노트북 웹캠에서 1280×720 원본 `drawImage`·재검출 시간은 아직 재지 않았다(V4).

## 5. 확인 방법

- `npm run check:runtime`(`scripts/check-runtime.ts`): 좌표·장면 선택·상태기계·대상 재검출·분기 결정·쿨다운 경계.
- `/dev/` 페이지(개발 서버 전용, 프로덕션 빌드 입력 아님): 입력 선택, 모델 상태, 대상 박스 겹치기, SceneDecision, 처리량, 0단계 fps·추론 시간. 둘째 PR에서 B 목 호스트, 로그·전달 표.
