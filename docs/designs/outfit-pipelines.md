# 코디 스캔 파이프라인: 응시 동의와 말로 묻기

상태: 구현 배분(2026-11-01 06:40). 트랙 A·B·C가 이 문서의 이름과 시그니처를 그대로 쓴다. 바꿀 일이 생기면 허브에 먼저 알린다.

근거: 사용자 요청(2026-11-01 06:10) "패션 플러그인이 잘 돌아가도록 두 파이프라인". 두 번째 플러그인 코디 스캔의 UI는 siloyuki의 열린 PR #42(`track-c/outfit-assistant-ui`), 흰 틀과 사람 수 표시는 #44(`track-c/selection-frame-count`)를 바탕으로 한다.

## 결정

- **얼굴은 계속 가린다.** 사용자가 "선호 없음"을 골라 권장안으로 정했다. 지금 가림은 얼굴·머리카락(Selfie 클래스 1·3)만 가려서 옷은 이미 보인다. 핵심 보장 2번("framelet이 찾은 얼굴은 가리고, 못 가리면 보내지 않아요")은 그대로다.
- **동의 = 그 사람의 몸을 코디 스캔에 보내도 된다는 착용자의 허락.** 동의가 없으면 코디 스캔에는 사람 조각을 하나도 보내지 않는다(보류). 동의한 사람의 조각 안에 다른 사람이 들어오면 그 사람은 몸 전체를 모자이크한다.
- **사람 아이콘 옆 숫자 = 지금 동의가 살아 있는 사람 수.** 평소에는 0.
- **답변 모델은 Gemini.** 사용자가 골랐다. 키는 서버 환경 변수 `GEMINI_API_KEY`로만 둔다(레포·메시지에 쓰지 않는다).

## 파이프라인 1: 응시 동의

1. A가 0단계 틱마다 사람 상자(EfficientDet person)를 IoU로 이어 붙여 `trackId`를 단다.
2. 상자 중심이 시야 가운데 원(짧은 변의 `GAZE_CENTER_RADIUS` 배) 안에 있고 흰 틀(F24)과 겹치는 사람 중 가장 가운데 사람이 응시 대상이다. 그 상태가 `GAZE_DWELL_MS`(3초) 이어지면 `setGazeCandidate`.
   - 정면 얼굴(눈 마주침) 판정은 선택이다. 시간이 남으면 BlazeFace 눈 두 점이 코를 기준으로 대칭인지로 더한다.
3. C가 그 사람 상자 위쪽에 작은 칩 "마스크 해제"를 띄운다. 착용자가 칩을 누르거나 Enter(글래스 물리 버튼 대용)를 누르면 `grantConsent(trackId)`.
4. 동의는 `CONSENT_MAX_MS`(60초)가 지나거나, 그 사람이 `CONSENT_LOST_MS`(2초) 넘게 안 보이거나, 착용자가 사람 수를 눌러 끄면 사라진다(`revokeConsent`).
5. 흰 틀 오른쪽 위 사람 수(#44 `SelectionFrame`의 `peopleCount`) = `selectConsentCount(state)`.

## 파이프라인 2: 말로 묻기

1. 동의가 하나라도 살아 있고 장면이 `person`으로 확정되면 A가 코디 스캔에 조각을 보낸다.
   - 조각 = 동의한 사람 상자 ∩ 흰 틀.
   - 가림 = 얼굴은 늘 가림(기존 2b·2c), 동의하지 않은 다른 사람 상자는 `body` 모자이크.
   - 나가기 전 검사는 지금과 같다.
2. 동시에 C가 시야 아래에 대화 막대(#42 런처 자리)를 띄우고 브라우저 음성 인식(`SpeechRecognition`, `ko-KR`, 중간 결과 표시)을 켠다. 말하는 동안 막대에 글자가 받아 적힌다. 음성 인식이 없는 브라우저는 입력창으로 대신한다.
3. 끝내기: 막대를 탭하거나 Enter·Space(글래스 버튼 대용). 그러면 `askPlugin('outfit', 질문)`.
4. 호스트 → 플러그인 `question`(가장 최근 코디 스캔 deliveryId와 함께) → 플러그인이 그 조각과 질문으로 `/api/outfit` 호출 → `answer` → 호스트가 `recordAnswer`.
5. C가 시야 오른쪽 가장자리에 #42 폰 모양 대화창을 펼쳐 질문과 답을 보여 준다.

## 계약(이름과 시그니처)

### types.ts

```ts
export type PluginKind = 'calorie' | 'tamper' | 'hello' | 'outfit';            // B
export type MaskKind = 'none' | 'face' | 'head' | 'body';                      // A: body = 동의하지 않은 사람 몸 전체
export interface GazeCandidate { trackId: string; box: Box; since: number }    // A. box는 원본 프레임 0~1
export interface Consent { trackId: string; box: Box; grantedAt: number; lastSeenAt: number; expiresAt: number } // A
export interface OutfitTurn {                                                    // B
  id: string; pluginId: string; deliveryId: string | null; question: string;
  answer: string | null; status: 'asking' | 'answered' | 'failed';
  source: 'api' | 'fallback' | null; askedAt: number; answeredAt: number | null;
}
```

### store.ts

- A 구역: 상태 `gaze: GazeCandidate | null`, `consents: Record<string, Consent>`. 액션 `setGazeCandidate(c: GazeCandidate | null)`, `grantConsent(trackId: string): boolean`(지금 응시 대상일 때만 true), `touchConsent(trackId: string, box: Box)`(A가 틱마다), `revokeConsent(trackId: string)`. `tick()`이 만료·놓친 동의를 지운다. 새 세션이면 비운다.
- B 구역: 상태 `outfitTurns: OutfitTurn[]`(최근 20개). 액션 `askPlugin(pluginId: string, question: string): string | null`(turnId, 보낼 조각이 없으면 null), `recordAnswer(turnId: string, text: string, source: 'api' | 'fallback')`, `failTurn(turnId: string, reason: string)`.
- 선택자(selectors.ts, A): `selectConsentCount(s, now)`.
- 상수(constants.ts, A): `GAZE_DWELL_MS = 3000`, `GAZE_CENTER_RADIUS = 0.18`, `CONSENT_MAX_MS = 60000`, `CONSENT_LOST_MS = 2000`.

### 메시지·SDK(B)

- 호스트 → 플러그인: `{ type: 'question'; questionId: string; deliveryId: string; text: string }`
- 플러그인 → 호스트: `{ type: 'answer'; questionId: string; text: string; source: 'api' | 'fallback' }`. 1,000자까지. 호스트는 제어·방향 문자를 거르고 줄바꿈은 남긴다.
- SDK: `onQuestion(handler: (q: { questionId: string; deliveryId: string; text: string }) => void | Promise<void>)`, `answer(questionId: string, text: string, source: 'api' | 'fallback')`.
- 플러그인은 받은 적 있는 deliveryId의 조각만 쓸 수 있다(호스트가 확인).

### API(B)

- `POST /api/outfit`, 본문 JSON `{ image: string /* base64 JPEG */, question: string }` → `{ answer: string }`.
- 서버 환경 `GEMINI_API_KEY`. 모델은 B가 Gemini 공식 문서에서 지금 쓸 수 있는 빠른 모델로 고르고 PR에 적는다.
- 시스템 지시: 한국어 해요체로 옷 종류·핏·스타일·유행·브랜드에 답한다. 사람이 누구인지, 나이·인종·건강 같은 신상은 추측하지 않는다. 브랜드는 로고·글자가 보일 때만 말하고, 아니면 모른다고 한다.
- 15초 안에 답이 없거나 키가 없으면 대체 문구(`source: 'fallback'`)를 돌려준다.

### 플러그인 씨앗(B)

- `id: 'outfit'`, `kind: 'outfit'`, `purpose: '코디 스캔'`, `scenes: ['person']`, `network: ['$ORIGIN/api/outfit']`.
- 앱 목록 두 번째 자리. `hello`(장면 기록)는 씨앗에서 뺄 수 있으면 뺀다(검사가 깨지면 남기고 PR에 적는다).

## 트랙 나눔

`src/core/`는 허브가 `core/outfit-contract` 한 PR로 바꾼다(위 계약 전부 + 스토어 액션 구현 + `02-SSRD.md`). 트랙은 자기 디렉터리만 고친다(AGENTS.md).

| 트랙 | 맡는 것 | 디렉터리 | 브랜치(`core/outfit-contract`에서) |
| --- | --- | --- | --- |
| 허브 | 위 계약 전부, 스토어 액션(`grantConsent`·`tick` 만료·`askPlugin`·`recordAnswer`), `selectConsentCount`, 상수, 씨앗 `outfit`, `02-SSRD.md` | `src/core/`, `docs/` | `core/outfit-contract` |
| A | 사람 추적·응시 판정 → `setGazeCandidate`·`touchConsent`, 코디 스캔 조각 만들기(동의한 사람 ∩ 흰 틀, 다른 사람 `body` 모자이크), 동의 없음 보류 사유 "동의한 사람 없음" | `src/vision/`, `src/broker/` | `track-a/outfit-consent` |
| B | 호스트가 `outfitTurns`의 `asking`을 `question`으로 보내고 `answer`를 `recordAnswer`로 넘기기, SDK `onQuestion`·`answer` 런타임, `src/plugins/outfit.ts`, `api/outfit.ts`(Gemini) | `src/plugins/`, `api/` | `track-b/outfit-ask` |
| C | #44·#42를 브랜치에 합친 뒤 연결: 응시 칩, 사람 수 = 동의 수, 대화 막대(음성 받아쓰기·끝내기), 오른쪽 대화창, zip 글로우, 규약 보기의 받는 곳 문구, 보류 사유 표시 | `src/ui/`, `src/proof/` | `track-c/outfit-ui` |

머지 순서: #44 → #42 → `core/outfit-contract` → A → B → C. 트랙은 계약 PR이 올라오기 전에도 이 문서의 이름으로 시작하고, 올라오면 그 위로 다시 맞춘다.

## 대화창 모양(C)

#42 `OutfitAssistant`를 바탕으로 사용자가 준 zip(`웹사이트 AI 챗 바 디자인`)의 겉 글로우와 테두리만 가져온다.

- 테두리: 1.5px, `conic-gradient(from var(--a), #7c6cff, #3fd0ff, #ff6fd8, #ffb86b, #7c6cff)`, 6초에 한 바퀴(`@property --a`).
- 글로우: 같은 그라디언트, `inset: -6px`, `blur(18px)`, 불투명도 0.55.
- 안쪽 바탕 `#0d0e13`, 글자 `#ececf2`, 자리 글자 `#7b7d88`. 사용자 말풍선 `#2a2650`, AI 말풍선 `#181920`.
- 막대는 알약 28px, 펼친 창은 22px. 움직임 줄이기면 회전과 전환을 끈다.

## 바뀌는 명세(허브가 정리)

- 보장 문구에 "사람 조각은 동의한 사람만 보내요. 얼굴은 늘 가려요"를 더한다.
- SRS C-8(런타임 마이크 미사용)에 코디 스캔 예외를 적는다. Chrome의 음성 인식은 소리를 Google 서버로 보낸다. 규약 보기에 적는다.
- 코디 스캔의 받는 곳: framelet 서버 → Google Gemini. 규약 보기와 연결 요청에 적는다.

## 확인하지 못한 것

- 실제 글래스의 눈 추적·물리 버튼은 이 브라우저 런타임에서 받을 수 없다. 응시는 머리 방향(시야 가운데), 버튼은 키보드·탭으로 대신한다.
- Gemini 모델 이름과 요금은 B가 문서로 확인한다.
