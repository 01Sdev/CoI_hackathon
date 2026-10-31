# 설계: `src/plugins/` 플러그인 호스트, SDK 런타임, M0 시험 페이지

상태: EGM 리뷰 반영, 사용자 승인 대기(이 PR 머지 = 승인) · 2026-10-31 · 트랙 B · 근거: `docs/specs/02-SSRD.md` §1·§3(IF-01~06, 플러그인 SDK, CSP 문단, 입력 위생)·§4 전환 공통 절차·§5 M0, `docs/designs/core-store.md` §2.2·§2.3 · 코드: `src/plugins/host/`, `src/plugins/sdk/`, `src/plugins/hello.ts`, `src/plugins/registry.ts`, `dev/`, `scripts/check-plugins.ts`

## 1. 풀려는 문제

02-SSRD는 메시지 형식과 CSP, 전환 순서를 정했다. 코드로 옮길 때 남는 질문은 이것이다.

- SDK와 플러그인 코드를 어떤 형태로 들고 있다가 Worker 문자열로 만드는가. 타입 검사와 단위 시험은 어떻게 하는가.
- 호스트는 어떤 iframe의 메시지를 받고, 형식·한도를 어기면 무엇을 하는가.
- 조정기가 스토어 구독 안에서 iframe을 만들고 없앨 때 상태 전이(`loading`·`ready`·`stopped`·`terminated`)가 서로 덮어쓰지 않게 하려면.
- M0(match·mismatch·timeout)을 제품 SDK로 어떻게 재현하는가.

## 2. 결정

### 2.1 SDK와 플러그인은 TS 함수로 쓰고 `toString()`으로 Worker 문자열을 만든다

- `sdk/sha256.ts`의 `sha256Pure(bytes)`, `sdk/runtime.ts`의 `installFameletSdk(scope, sha256Pure, options)`, `host/bootstrap.ts`의 `iframeBootstrap()`, 플러그인마다 `xxxPlugin(famelet, ...data)` 함수를 둔다. 모두 **바깥 스코프의 이름을 쓰지 않는다**(인자와 Worker·iframe 전역만). 숫자 상수(`SDK_INIT_TIMEOUT_MS`, 글자 한도)는 `options` JSON으로 넣는다.
- Worker 소스 = `"use strict";` + `var __name = …;` + `(installFameletSdk)(self, (sha256Pure), 옵션 JSON);` + `(plugin)(self.famelet, 데이터 JSON);`(`sdk/source.ts`의 `buildWorkerSource`·`pluginCall`).
- `__name` 줄: esbuild를 `keepNames`로 돌리면(tsx가 그렇다) 함수 본문에 모듈 수준 도우미 `__name(fn, "이름")` 호출이 들어간다. 옮긴 코드에는 그 도우미가 없어 `ReferenceError`가 났다(check-plugins에서 실제로 관측). 아무 일도 안 하는 같은 이름을 앞에 둔다. Vite 개발·빌드는 `keepNames`를 쓰지 않는다. 축소와 `keepNames`를 함께 쓰면 도우미 이름이 바뀌어 이 줄로 못 막으므로 그 조합은 쓰지 않는다.
- 장점: `tsc`가 SDK·부트스트랩·플러그인을 검사하고, `scripts/check-plugins.ts`가 같은 문자열을 Node `vm`에서 돌린다. 원본(tsx, keepNames)과 esbuild 축소판(Vite 7 기본 target `chrome107, edge107, firefox104, safari16`) 둘 다 돌린다.

### 2.2 iframe 한 개 = 실행 세대(runtime) 한 개

| 단계 | 하는 일 |
| --- | --- |
| 만들기 | nonce 16바이트(`crypto.getRandomValues`, base64). CSP `default-src 'none'; script-src 'nonce-N'; worker-src blob:; connect-src <목록 또는 'none'>`. 목록 = 그때의 `plugins[id].allowedOrigins`. `connect`가 `'none'`이거나 목록이 비면 `'none'`. 각 항목은 `^https?://[a-z0-9.-]+(:[0-9]+)?$`와 `new URL(o).origin === o`를 둘 다 통과해야 들어간다(검증기 다음의 두 번째 방어. `&`·따옴표가 meta 속성을 깨지 못한다). srcdoc 생성이 예외면 만들지 않는다 |
| 속성 | `sandbox="allow-scripts"`, `allow=""`, `data-plugin-id`·`data-runtime-id`, `srcdoc`, `load` 리스너를 먼저 두고 DOM에 붙인다. 붙이기 전과 붙인 직후 두 번 `getAttribute`, `sandbox.length === 1`, `allow-same-origin` 없음을 확인한다. 다르면 떼고 LogEntry("iframe 속성 확인 실패", host), `stopped` |
| 첫 `load` | `contentWindow.postMessage(init, '*')`. iframe origin이 `"null"`이라 대상 origin을 지정할 수 없다. `apiBase` = `connect === 'none'`이면 null, 아니면 호스트 `location.origin`. `manifest`는 `version`을 뺀 7개 필드 |
| 두 번째 `load` | 재로드 위반. 즉시 종료, LogEntry(violation, "iframe 재로드", host), `terminated` |
| DOM에 붙인 뒤 3초 안에 `ready` 없음 | 종료, `stopped`(→ 스토어가 `enabled = false`). LogEntry는 남기지 않는다(상태로 보인다) |

부트스트랩(iframe 안 nonce 스크립트)은 `event.source === parent`인 `init`을 1번 받고 그 리스너를 지운다. `code`로 blob Worker를 만들고 **`{type:'init', pluginId, manifest, apiBase}`(code 없이)를 Worker에 1번 보낸다**. Worker를 못 만들면 아무것도 보내지 않는다(호스트 3초 → `stopped`, iframe 메인 스레드 폴백 없음). blob URL은 iframe이 없어질 때까지 둔다(바로 revoke하면 Worker 로드와 경합할 수 있다). 그 뒤 `parent`에서 온 `delivery`만 Worker로 넘기고, Worker의 메시지는 그대로 `parent`로 넘긴다. 형식 검사는 호스트가 한다.

### 2.3 호스트의 메시지 검증

1. `event.source`로 runtime을 찾는다. 모르는 창(호스트 창 자신 포함), 지금 runtime이 아닌 옛 iframe, `origin !== "null"`이면 기록 없이 버린다.
2. 1초 창 메시지 수 > 20이면 종료("한도 초과: 초당 메시지 20건").
3. `event.ports`가 있으면 형식 오류.
4. `parsePluginMessage(data)`(`host/validate.ts`, 순수 함수). **형식을 먼저, 한도를 나중에** 본다.
   - 형식: 일반 객체가 아님, 문자열이 아닌 값(Blob 등), 모르는 `type`, 키가 정확히 그 type의 키가 아님(빠짐·남음), `ack.sha256`이 16진 64자(대소문자 무관)가 아님, `result.source`가 `api`·`fallback`이 아님, `violation.attempt`가 4종이 아님.
   - 한도: `JSON.stringify(data)`의 UTF-8 바이트 > 8KiB, `pluginId`·`deliveryId` > 128, `text` > 200, `target` > 512. 길이는 **코드 포인트**로 센다(SDK도 코드 포인트로 자른다. 이모지 200개는 통과).
5. `ack`·`result`의 `deliveryId`가 그 runtime에 보낸 것이 아니면 형식 오류.
6. 같은 runtime의 두 번째 `ready`, 같은 `deliveryId`의 두 번째 `ack`·`result`, 같은 `attempt`·`target`의 두 번째 `violation`은 조용히 버린다. 서로 다른 `violation`이 8건을 넘으면 종료("한도 초과: 위반 보고 8건"). 변조 플러그인은 4건이다. 자기 보고로 로그 100건을 밀어내 다른 플러그인의 전달·썸네일을 지우지 못하게 한다.

형식 오류는 버리고 LogEntry(violation, "형식 오류: …", host). 한 runtime의 3번째 형식 오류는 그 줄 대신 "형식 위반 반복(3회): …" 한 줄을 남기고 종료한다. 한도 초과는 "한도 초과: …" 한 줄을 남기고 종료한다. 종료 순서는 **떼기(지금 runtime에서 빼기·ready 타이머·load 리스너·iframe 제거) → `addLog` → `setPluginRuntime({ status: 'terminated', runtimeId: null, runtimePolicy: null })`**이고, 마지막 set 뒤에는 아무것도 하지 않는다.

정상 메시지 처리(모든 LogEntry의 `pluginId`는 runtime의 것, `sceneDecisionId`·`branch`는 null, `ready.pluginId`는 쓰지 않는다):

| 메시지 | 호스트가 부르는 것 |
| --- | --- |
| `ready` | 2.4의 5번 |
| `ack` | ack 타이머 해제, `setAck(deliveryId, sha256)`(스토어가 소문자로 비교, 불일치면 "해시 불일치" host) |
| `result` | `setResult(pluginId, { deliveryId, text, source, at: performance.now() })` |
| `violation` | `addLog(violation, reason, 'plugin-report')`. reason = `<시도 이름(attempt)> <target>`이고, `fetch`·`script`이면 target의 origin을 **그 iframe의 실제 `connect-src` 목록**(= `network` ∩ `HOST_ALLOWED_ORIGINS`, 비교 모드면 빈 목록)과 대조해 "· 허용 목록 밖" 또는 "· 허용 목록 안인데 실패". URL이 아니면 "허용 목록 밖". 02-SSRD IF-06 문구를 같은 PR에서 이렇게 고쳤다(`network`에 있지만 호스트가 허용하지 않은 주소는 실제로 막힌 이유가 "목록 밖"이기 때문) |

### 2.4 조정기: 플러그인마다 `selectDesiredRuntime` 구독 하나

`store.subscribe((s) => selectDesiredRuntime(s, id), () => reconcile(id), { equalityFn: shallow })`로 **먼저 구독한 뒤** 플러그인마다 `reconcile(id)`를 한 번 직접 부른다. zustand `subscribeWithSelector`의 `fireImmediately`는 리스너를 등록하기 전에 불리므로, 그 안에서 `stopped`가 되면 리스너가 낡은 값을 들고 있다가 사용자가 다시 켜도 불리지 않는다.

`reconcile(id)`는 재진입하면 표시만 하고, 끝난 뒤 최신 상태로 한 번 더 돈다. 한 번 도는 일(`reconcileOnce`)은 구독 인자가 아니라 **지금 상태의 `selectDesiredRuntime`**을 본다.

1. 지금 runtime이 같은 `desired`로 만들어졌으면 아무것도 안 한다.
2. 게이트가 열려 있으면 닫고(`setPluginRuntime({ gateOpen: false })`), 지금 runtime을 뗀다(iframe 제거 → Worker 종료, 창 매핑 삭제).
3. 플러그인이 없으면 끝. `enabled`가 false면 `runtimeId`·`runtimePolicy`를 null로 하고 상태는 **`stopped`면 그대로, 아니면 `terminated`**(이미 그 값이면 쓰지 않는다). `stopped`·`terminated`로 바꾸면 스토어가 `enabled = false`로 만들어 구독이 한 번 더 불리는데, 이 규칙 덕분에 `stopped`가 `terminated`로 덮이지 않는다.
4. 켜져 있으면 새 runtime을 만들고 `{ status: 'loading', runtimeId, runtimePolicy, gateOpen: false }`를 마지막에 쓴다. 코드가 없거나(`sourceFor`가 null) 속성 확인이 실패하면 `stopped`를 마지막에 쓴다.
5. `ready`가 오면, 그 runtime이 아직 지금 runtime이고 그 `desired`가 지금 `selectDesiredRuntime`과 shallow로 같을 때만 `{ status: 'ready', runtimeId, runtimePolicy, gateOpen: true }`.

`runtimeId`·`runtimePolicy`는 만들 때 스토어에 쓴다(`loading` 동안은 `selectCanSend`가 false라 보낼 수 없다). 큐는 없다. 만드는 중에 값이 바뀌면 그 runtime을 버리고 다시 만든다. 모든 비동기 콜백(load, ready 타이머, 메시지)은 "이 runtime이 아직 지금 runtime인가"를 먼저 본다.

### 2.5 `sendDelivery(deliveryId): boolean` (broker만 부른다)

스토어의 Delivery에서만 메시지를 만든다. Delivery가 없거나 `prepared`가 아니면 `false`(없으면 표시도 못 한다). 다음 중 하나면 `markDelivery(id, 'failed')`, `false`: 호스트 중지, `selectCanSend` false, 지금 runtime이 없거나 `ready`가 아님, `runtimeId`가 스토어·runtime과 다름, `manifestVersion`이 스토어 `runtimePolicy`·runtime 정책과 다름, Blob 없음 또는 `bytes ≠ blob.size`, `raw`인데 비교 모드·칼로리·**runtime 자신의** `connect 'none'` 중 하나라도 아님, 보호 모드인데 `faceCheck`가 `checked`·0이 아님(A가 만들지 않는 행의 마지막 방어). 통과하면 runtime의 보낸 목록에 넣고 `postMessage`(예외면 빼고 `failed`), `markDelivery(id, 'dispatched')`, 2초 타이머 → `setAck(id, null)`(이미 받았으면 스토어가 무시). 재전송은 없다.

### 2.6 SDK 런타임 규칙(02-SSRD "플러그인 SDK" 그대로)

- `onInit`·`onDelivery`는 마지막 등록이 이긴다. `init`은 처음 1번만. 핸들러 Promise가 2.5초 안에 끝나면 `ready`, 예외·시간 초과면 보내지 않는다. 핸들러가 없으면 바로 `ready`.
- `ready` 전 `delivery`는 버린다. `delivery`마다 Blob을 읽어 `crypto.subtle` → 실패하면 `sha256Pure`로 해시를 만들고 **핸들러보다 먼저** `ack`. 핸들러 예외는 삼킨다.
- `result`: 받은 `deliveryId`에만, 1번만, `text`는 200자(코드 포인트)로 자름, `source`는 `api`·`fallback`만. `reportViolation`: `attempt` 4종만, 같은 `attempt`·`target` 1번, `target` 512자. `ready` 전에도 보낼 수 있다.
- SDK는 시작할 때 `scope.postMessage`를 붙잡아 쓰고, `self.famelet`은 고칠 수 없는 속성(얼린 객체)이다. 플러그인이 같은 Worker에서 이것을 우회할 수 있다는 점은 02-SSRD "지킬 수 없는 것" 그대로다.
- 시험용 옵션(`forcePureHash`, `testAckMode: 'corrupt'`(받은 바이트의 `byte[0] ^= 0xff` 뒤 해시) `| 'suppress'`(ack 없음))은 호스트 옵션 `sdkTestOptionsFor`로만 넣는다. 제품 코드에서 넣는 곳은 없고 `/dev` 시험 페이지만 쓴다. 플러그인은 원래 같은 Worker에서 무엇이든 할 수 있으므로 이 옵션이 새 권한을 주지 않는다.

### 2.7 내보내는 것

| 이름 | 쓰는 쪽 | 설명 |
| --- | --- | --- |
| `startPluginHost(): () => void` | `main.tsx`(칼로리 코드가 들어오는 PR부터) | 기본 `lensStore`로 호스트 하나. 여러 번 불러도 하나, 해제 함수 반환 |
| `sendDelivery(deliveryId): boolean` | A `broker/` | 2.5. 호스트가 없으면 `prepared`를 `failed`로 |
| `sha256Hex(blob): Promise<string>` | A `broker/` | `Delivery.sha256`(소문자 16진). `crypto.subtle`(LAN HTTP에서는 없음) → 순수 JS |
| `createPluginHost(options): { sendDelivery, stop }` | `/dev`, 시험 | `store`, `container`, `hostOrigin`, `sourceFor(plugin)`(플러그인 id로 고를 수 있다), `sdkTestOptionsFor(pluginId)`, `readyTimeoutMs`, `ackTimeoutMs`, `now` 주입. `stop()`은 구독·타이머·iframe을 없애고 돌던 플러그인을 `loading`으로 둔다(다음 호스트가 다시 만든다) |

### 2.8 M0 시험 페이지

`dev/m0.html` + `dev/m0.ts`(Vite가 개발 서버에서 `/dev/m0.html`로 연다. `dev/index.html`은 트랙 A 확인 페이지라 이름을 나눴다. 빌드 입력은 루트 `index.html`뿐이라 프로덕션에 들어가지 않는다. 확인함). 따로 만든 스토어에 hello 변형을 시드로 넣고 A 역할을 직접 한다: `dev/fixtures/m0-test.jpg`(SHA-256 `358dbf25…05e8`, `08-데모-소재.md`)의 해시를 계산해 `prepareDelivery` → `sendDelivery`. 줄은 차례로 돌고, 결과는 표와 `window.__m0 = { done, pass, rows: [{ name, pass, detail }] }`에 쓴다. 시각은 스토어 구독으로 잰다(배경 탭에서는 `setTimeout` 폴링이 1초 단위로 늦어진다).

| 플러그인 | SDK 옵션·코드 | 기대 |
| --- | --- | --- |
| `hello` | 기본 | `match`. 결과 줄에 `document:undefined`, `RTCPeerConnection:undefined`(TC-051) |
| `hello-pure` | `forcePureHash` | `match`(TC-059, V10 순수 JS 경로) |
| `hello-corrupt` | `testAckMode: 'corrupt'` | `mismatch`, LogEntry "해시 불일치"(host) |
| `hello-silent` | `testAckMode: 'suppress'` | 1.9초까지 `pending`, 2초 뒤 `timeout`, `ackSha256 === null` |
| `hello-spoof` | 처음엔 꺼짐. silent 전달을 `prepare`한 뒤 `{deliveryId, sha256}`을 데이터로 넣어 켜고 ready를 기다린다. 자기 전달을 받으면 그 데이터로 `self.postMessage(ack)` | silent 전달 직후 spoof에도 하나 보낸다 → 위조 ack는 형식 오류 1줄(host), silent는 그대로 `timeout`. 같은 때 호스트 창이 보낸 가짜 `ack`는 로그 0줄 |
| `hello-noready` | `onInit`이 끝나지 않음 | 3초 뒤 `stopped`, `enabled = false` |
| `hello-reload` | 기본 | `srcdoc` 재설정 → `terminated`, "iframe 재로드"(host), iframe 제거(TC-030) |

함께 본다: iframe 속성과 CSP·nonce(TC-029), `ready` 전 `prepareDelivery` 거부, `bytes ≠ blob.size`인 Delivery가 `failed`이고 누적 전달 수·`recent10s`가 그대로, 매니페스트 재적용 뒤 새 `runtimeId`·`manifestVersion + 1`, 옛 `runtimeId` 포착 거부, 다시 `match`.

## 3. 고르지 않은 방법

| 방법 | 고르지 않은 이유 |
| --- | --- |
| SDK를 처음부터 JS 문자열로 | 타입 검사와 Node 시험이 안 된다 |
| `?raw`로 순수 JS 파일을 실어 보내기 | 실어 보내는 바이트가 시험한 바이트와 같아지는 장점이 있지만 타입 검사가 빠지고 Node 시험에서 Vite 전용 import를 따로 풀어야 한다. 대신 축소판을 vm에서 돌린다 |
| Vite `?worker&inline`·별도 번들 | Worker를 호스트 origin URL로 만들게 되거나 빌드 설정이 늘어난다. 우리는 iframe 안에서 blob URL로 만들어야 한다 |
| 한도 초과 메시지를 잘라서 받기 | 02-SSRD 입력 위생은 "한도를 넘으면 종료"다. 협조하는 SDK는 미리 자르므로 정상 플러그인은 걸리지 않는다 |
| 형식 오류마다 바로 종료 | 시연 중 사소한 실수로 칼로리 플러그인이 꺼진다. 3번째에 종료한다 |
| `fireImmediately` 구독 | 2.4 첫 문단(재활성화가 안 불리는 문제) |
| `/dev`를 `App.tsx` 라우트로 | C 소유 파일이고 프로덕션 번들에 시험 코드가 섞인다 |

## 4. 남은 위험

- **데스크톱 Chrome의 느린 첫 시작.** Chrome은 sandbox iframe마다 렌더러 프로세스를 따로 띄운다. 이 노트북의 부하 평균이 16~35일 때 headless Chrome에서 iframe 7개를 한꺼번에 만들면 Worker 코드가 3초 안에 돌지 못해 모두 `stopped`가 되는 실행이 있었다(같은 때 따뜻한 실행은 ready 39~144ms). 제품은 iframe이 1~3개라 덜하지만, 발표 노트북에서 첫 로드 직후 칼로리가 `stopped`면 다시 켜야 한다. 리허설에서 본다. 3초 시작 시점을 "첫 load"로 옮기는 안은 02-SSRD 수치를 바꾸므로 두지 않았다.
- **Chrome Worker에 `crypto.subtle` 없음.** localhost에서도 origin null sandbox iframe의 blob Worker는 `crypto.subtle`이 없었다(Chrome 152·156). 그래서 Chrome에서는 기본 경로도 순수 JS다. iPhone Safari HTTPS는 있었다(S7).
- **`toString()`과 빌드 도구.** 함수가 바깥 이름을 참조하거나 빌드가 도우미를 넣으면 깨진다. 2.1의 `__name` 줄과 check-plugins의 원본·축소판 vm 실행으로 막는다. 칼로리 코드가 들어와 프로덕션 번들에 SDK가 실리는 PR에서 빌드본으로 M0를 한 번 더 돌린다.
- **Worker CSP 상속.** blob Worker가 iframe CSP를 상속한다는 것은 Chrome(팀원 v2)과 iPhone Safari(S1~S4) 재현 페이지에서만 봤다. Android Chrome은 V9, 통합 앱은 V11에서 본다.
- **늦은 `ack`.** 옛 iframe을 없애면 그 iframe에 보낸 전달은 2초 뒤 `timeout`이 된다. 02-SSRD IF-04대로 "수신 미확인"이 맞다.

## 5. 확인 방법

- `npm run check:plugins`(`scripts/check-plugins.ts`) 22개: `sha256Pure` 표준 벡터·무작위 길이·600KB·M0 JPEG, 메시지 검증기 경계(200/201자, 이모지, 128·512자, 크기, 모르는 키, Blob 값, 빈 프로토타입), CSP 생성과 주입 거부, srcdoc 순서, violation reason 대조, SDK를 원본·축소판으로 `vm`에서 돌려 ready·ack·result·violation·순수 JS·corrupt·suppress·onInit 예외·hello 결과 줄.
- 개발 서버 `/dev/m0.html` M0 페이지 15줄.

## 6. 리뷰 기록

맥락 없는 EGM 리뷰어 두 명이 초안을 봤다(2026-10-31).

- **설계 비평(egm-design):** 재진입하는 reconcile과 `fireImmediately` 순서(2.4), runtime별 ready 타이머(이미 runtime별이고 지금 runtime인지 확인), 플러그인이 고르는 target으로 로그 밀어내기(2.3의 8건 상한), 글자 단위 불일치(코드 포인트로 통일), 축소 시 도우미 주입(2.1, 실제로 tsx에서 재현), IF-06 대조 목록(02-SSRD 수정), 부트스트랩의 init 전달(2.2), `&` 주입(엄격 정규식), sendDelivery의 faceCheck·runtime 정책 재검사(2.5). 모두 반영했다. 받지 않은 것: 빌드 산출물의 자유 식별자 정적 검사(축소판 vm 실행과 다음 PR의 빌드본 M0로 대신), `build.target` 고정(공용 설정이라 바꾸지 않음).
- **구현 준비도(egm-implementation-readiness):** init 전달, `createPluginHost` 모양, 검증 순서·단위·크기 정의, 정상 메시지 처리 표, 종료 순서와 사유 문구, spoof 시험 순서와 `window.__m0` 모양, `stopped`에 로그 없음, hello 결과 문구. 모두 반영했다. 받지 않은 것: blob URL 즉시 revoke(2.2), 코드를 kind가 아니라 id로만 찾기(기본은 kind, `sourceFor(plugin)`이 id로도 고른다).
