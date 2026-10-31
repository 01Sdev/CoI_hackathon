# 설계: `src/core/` 공용 스토어와 트랙 사이 호출 방식

상태: EGM 리뷰 반영, 사용자 승인 대기(이 PR 머지 = 승인) · 2026-10-31 · 근거: `docs/specs/02-SSRD.md` §1·§2·§4, `docs/specs/04-ERD.md` §1~§4 · 코드: `src/core/store.ts`, `selectors.ts`, `plugins.ts`, `types.ts`

## 1. 풀려는 문제

02-SSRD와 04-ERD는 엔티티 7개, 각 상태를 누가 쓰는지, 메시지 형식을 정했다. 정하지 않은 것은 이것이다.

> C(UI)가 "입력 바꾸기", "매니페스트 적용", "플러그인 켜기", "비교 모드", "일시 정지", "새 세션"을 누르면 A·B는 이것을 어떻게 알고 처리하는가? 그 사이에 진행 중이던 포착은 어떻게 되는가?

첫 1시간에 세 트랙이 동시에 시작해야 하므로, 서로의 코드가 없어도 컴파일되고 돌아야 한다.

## 2. 결정

### 2.1 스토어 하나, C는 의도 상태만 바꾼다

- `src/core/store.ts`의 `createLensStore()`가 zustand vanilla 스토어를 만든다(`subscribeWithSelector`). 앱은 `lensStore` 하나를 쓴다.
  - C(React): `useLensStore(selector)`. 객체를 돌려주는 selector는 `useShallow`로 감싼다.
  - A·B(React 밖): `lensStore.getState().액션()`, `lensStore.subscribe(selector, handler, { equalityFn: shallow, fireImmediately: true })`.
- C의 버튼은 스토어 액션만 부른다. 액션은 상태만 바꾸고 카메라·iframe 같은 부수 효과는 하지 않는다. 그래서 C는 A·B 모듈을 import하지 않는다.
- 플러그인 행은 `src/core/plugins.ts`의 `PLUGIN_SEEDS`(calorie 켜짐, tamper·hello 꺼짐)로 스토어가 만들어질 때 채운다. A가 B 파일을 import하지 않아도 되고, 첫 1시간에도 C 화면에 플러그인이 보인다. B의 `src/plugins/`는 Worker 코드만 내보낸다.

| C가 부르는 액션 | 스토어에서 바뀌는 것 | 처리하는 쪽 |
| --- | --- | --- |
| `selectInput(kind)` | `session.inputRequest = { kind, seq }`. 부를 때마다 `seq`가 올라 같은 입력도 다시 요청된다 | A: 입력을 열고 `setInput`. 진행 중인 포착은 A가 스스로 버린다. iframe은 다시 만들지 않는다 |
| `applyManifest(id, json)` | 통과하면 `manifest`(version+1)·`allowedOrigins`, **같은 set에서 그 플러그인 게이트 닫기**. 실패하면 변화 없음. 결과를 바로 반환 | B |
| `setPluginEnabled(id, on)` | `enabled`. 끄면 게이트도 닫는다 | B |
| `setCompareMode(on)` | `compareMode`, **칼로리 게이트 닫기**. 끌 때 raw Delivery의 썸네일·Blob 해제 | B. A는 포착 때 읽는다 |
| `setPaused(on)` | `paused`만. 게이트는 건드리지 않는다 | A·B 모두 `selectCanSend`로 판단 |
| `startNewSession()` | 새 `session.id`, `compareMode`·`paused` false, **모든 게이트 닫기**, 로그·전달·판정·결과·Counter 비우기, 썸네일 revoke. 플러그인 행·매니페스트·`enabled`·`input`은 유지 | B |
| `tick()` | 10초·60초 창에서 지난 기록 제거(메모리 정리·화면 갱신) | C가 1초마다 |

### 2.2 B는 플러그인마다 선택자 하나만 구독한다

- `selectDesiredRuntime(s, id) = { enabled, manifestVersion, connect, sessionId }`. `connect`는 비교 모드의 칼로리면 `'none'`, 아니면 `'network'`.
- B는 이 값이 바뀌면 전환 공통 절차를 돈다. 큐를 쌓지 않고 최신 값만 본다. iframe을 만드는 중에 값이 또 바뀌면 그 결과를 버리고 다시 만든다.
- 새 iframe의 `ready`가 왔을 때, **그 iframe을 만든 값이 지금 `selectDesiredRuntime`과 같을 때만** `setPluginRuntime(id, { status: 'ready', runtimeId, runtimePolicy, gateOpen: true })`로 게이트를 연다.
- `status`의 뜻: `loading` = 생성·전환 중, `ready`, `stopped` = 전환 실패(3초 안에 ready 없음), `terminated` = 꺼짐(사용자 끔·재로드 위반). 전환 중에는 `terminated`가 아니라 `loading`을 쓴다.
- `setPluginRuntime`이 지키는 것: `status ≠ ready`이면 `gateOpen = false`. `stopped`·`terminated`이면 `enabled = false`라서 사용자가 다시 켜면 값이 바뀌고 구독이 불린다.
- 보낼 수 있는지는 `selectCanSend = status === 'ready' && gateOpen && !paused` 하나로 판단한다.

### 2.3 포착 도중의 전환은 스토어가 마지막에 막는다

`prepareDelivery`는 다음이면 아무것도 쓰지 않고 `null`을 돌려준다. A는 그 포착을 버린다. B의 `sendDelivery`도 같은 검사를 다시 한다.

- `selectCanSend`가 false
- `delivery.runtimeId`(포착을 시작할 때 읽은 값) ≠ 지금 `plugin.runtimeId`
- `delivery.manifestVersion` ≠ 지금 iframe의 `runtimePolicy.manifestVersion`
- `branch === 'raw'`인데 비교 모드가 아니거나, 칼로리가 아니거나, 지금 iframe이 `connect: 'none'`이 아님

마지막 줄은 B의 구현 순서와 상관없이 원본 프레임이 통신 가능한 iframe으로 가지 않게 하는 G1의 마지막 방어다.

### 2.4 A·B가 쓰는 액션은 함께 바뀌는 값을 한 번에 바꾼다

| 액션 | 쓰는 쪽 | 하는 일 |
| --- | --- | --- |
| `setInput`, `setPluginBusy`, `setLiveObservation`, `addSceneDecision`, `recordRuns` | A | 값 쓰기. 시각은 스토어 시계로 찍는다 |
| `addLog(hold·skip·violation)` | A, B(violation) | 100건 상한. `skip`은 같은 플러그인·같은 사유 10초에 1번(버리면 null). `hold`는 `window60s.holds` +1 |
| `prepareDelivery` | A(broker) | 2.3 검사 후 Delivery(`prepared`, `pending`)와 LogEntry(`deliver`)를 함께 쓴다 |
| `markDelivery(id, dispatched·failed)` | B | `prepared`에서만 바뀐다. `dispatched`일 때만 Counter(`recent10s`, `perPlugin`, `window60s.deliveries`)에 쌓는다. 바뀐 뒤 스토어는 Blob 참조를 놓는다 |
| `setAck(id, sha256 \| null)` | B | `dispatched`·`pending`일 때만. null = timeout(2초 타이머는 B). 소문자로 비교. 불일치면 violation("해시 불일치", host) |
| `setPluginRuntime` | B | 2.2 |
| `setResult` | B | 결과 줄. `source: 'api'`면 `apiSends` +1(플러그인 자기 보고 기준) |

- 픽셀을 놓는 곳은 넷이다: 로그 밀어내기(Delivery 삭제와 썸네일 revoke), 비교 모드 끄기(raw), 새 세션(전체), `markDelivery`(Blob 참조).
- 파생값(M, 바깥 표시 N개, 처리량, "외 k장")은 `selectors.ts`가 계산한다. 시간 창 판정은 `now`로 직접 해서 `tick`이 늦어도 값이 틀리지 않는다. `now`는 `performance.now()` 기준이다.
- `faceCheck`가 `error`인 Delivery가 `dispatched`되면 얼굴 1개로 센다. 보호 모드에서는 만들어지지 않는 행이지만, 들어왔을 때 덜 세는 쪽보다 안전하다. 리뷰는 throw를 제안했지만 시연 중 예외보다 이쪽을 골랐다.

### 2.5 ERD·02-SSRD와 달라진 점 (같은 PR에서 문서를 고쳤다)

| 항목 | 이전 | 지금 |
| --- | --- | --- |
| 플러그인 행 생성 | A가 B의 `PLUGINS`로 생성 | 스토어가 `core/plugins.ts` 시드로 생성. B는 코드만 |
| Counter를 쓰는 쪽 | A | 스토어 액션(`markDelivery`는 B, `addLog(hold)`·`recordRuns`는 A가 부른다) |
| 썸네일 해제 | C | 스토어 |
| 일시 정지 | B가 게이트를 닫고 연다 | 게이트와 따로, `selectCanSend`가 판단 |
| 입력 전환 | 전환 공통 절차(iframe 재생성) | iframe 유지. A가 진행 중 포착을 버린다 |
| `apiSends` | 정의 없음 | `result.source === 'api'` 수(자기 보고) |
| 새 필드 | — | Session `inputRequest`, Plugin `enabled`·`runtimePolicy`, Delivery `runtimeId`·`scene`·`width`·`height`·`blob`, Counter `window60s` 이벤트 배열 |
| skip 중복 키 | 같은 사유 | 같은 플러그인·같은 사유 |

## 3. 고르지 않은 방법

| 방법 | 고르지 않은 이유 |
| --- | --- |
| C가 A·B 모듈을 직접 import | 첫 1시간에 상대 코드가 없으면 컴파일되지 않는다 |
| 이벤트 버스 따로 두기 | 상태와 이벤트가 두 군데로 나뉘고, 늦게 붙은 구독자는 지난 이벤트를 못 받는다 |
| 트리거마다 핸들러 + 전환 FIFO 큐 | 낡은 정책으로 게이트가 열리거나 같은 iframe을 두 번 만든다(EGM 설계 리뷰 3번). 선택자 하나 + 최신 값 조정기가 코드도 적다 |
| 입력 전환에도 iframe 재생성 | 정책이 안 바뀌는데 다시 만드는 것은 마감 앞에서 낭비다 |

## 4. 남은 위험

- **구독이 두 번 붙는다.** HMR·StrictMode로 B·A 시작 함수가 두 번 돌 수 있다. 시작 함수는 여러 번 불러도 구독을 한 번만 붙이고 해제 함수를 돌려주게 하고, `main.tsx`에서 React 밖에서 부른다.
- **같은 origin이라 누구나 아무 액션이나 부를 수 있다.** 쓰는 쪽 규칙은 위 표로 코드 리뷰한다. 플러그인(iframe)은 스토어에 닿지 못한다.
- **5fps `setLiveObservation`.** C는 필요한 필드만 selector로 구독한다.

## 5. 확인 방법

`npm run check:core`(`scripts/check-core.ts`, 시계·revoke를 주입한 스토어로 실행). 35개 항목:

- `validateManifest` 15개: 기본값, 잘못된 JSON, 모르는 필드, 범위, CSP 주입 문자열, purpose 40자
- `resolveAllowedOrigins` 3개
- 스토어 17개: 시드, `applyManifest`, 두 번 `markDelivery`, 100건 밀어내기와 revoke·`perPlugin` 유지, skip 9,999/10,000ms, hold, `setAck` 세 결과와 늦은 ack, M·바깥 표시 10초 경계와 tick, 처리량 null, runtimeId·version 변경 시 거부, raw 조건(G1), 비교 모드 끌 때 해제, 일시 정지와 canSend, stopped → enabled false, inputRequest seq, 새 세션 초기화, apiSends

## 6. 리뷰 기록

맥락 없는 EGM 리뷰어 두 명이 초안을 봤다(2026-10-31).

- **구현 준비도(egm-implementation-readiness):** 상태 모양·인자·시계·새 세션 범위·전이 규칙·확인 방법이 비어 있다는 지적 10개. 타입 파일, 시계 주입, 전이 규칙, 확인 항목으로 반영했다. 받지 않은 것: 7개 필드 모두 필수(03-SRS EI-4의 기본값을 따라 3개는 선택), `faceCheck` error throw(2.4).
- **설계 비평(egm-design):** 포착 중 전환으로 원본이 통신 가능한 iframe에 가는 경로(2.3), 비교 모드를 꺼도 원본이 남는 문제, 트리거별 핸들러의 경쟁(2.2), 같은 값 재요청, 이중 집계, 시간 기준, 플러그인 행 생성 위치, 02-SSRD와 다른 점 미기재. 모두 반영했다.
