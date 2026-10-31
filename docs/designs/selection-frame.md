# 범위 선택 프레임과 외부 인원 수 표시 추출

사용자가 지정한 `design.html`의 흰 선택 프레임, 테두리 이동, 네 모서리·네 중간점 크기 조절과 오른쪽 위 사람 아이콘·숫자를 React로 추출한다. 인원수는 외부에서 전달받아 표시만 하며, 이 컴포넌트는 사람 검출·카운팅을 하지 않는다. 숫자 흰 외곽선은 1.5px이며 배경 패널은 없다. 아이콘 24px, 숫자 30px/40px, 프레임 오른쪽·위 8px 배치를 유지한다. 드래그할 때 별도 테두리를 만들지 않는다.

## 이번 변경의 범위

- `src/ui/SelectionFrame.tsx`: 프레임 이동·크기 조절·키보드 조작·인원 수 표시.
- `src/ui/selection-frame.ts`: 경계·최소 크기·이동·크기 조절 순수 함수.
- `src/ui/selection-frame.css`: 위 컴포넌트에 한정한 스타일.
- `dev/selection-frame.html`, `dev/selection-frame.tsx`: 외부 인원수 전달을 시연하는 개발 페이지.
- `scripts/check-selection-frame.ts`: 최소 크기·부모 경계·크기 조절 검증.

`npm run dev` 후 `/dev/selection-frame.html`을 연다. 기존 Pretendard 패키지를 개발 진입점에서 불러오며 새 의존성·카페 사진·모델은 추가하지 않는다. 현재 프로덕션 빌드는 루트 index.html만 입력으로 써 개발 페이지를 포함하지 않는다.

## 기능과 데이터 의미

| 조작 | 동작 |
| --- | --- |
| 네 변의 테두리 드래그 | 크기를 유지하면서 프레임 이동 |
| 네 모서리 드래그 | 반대 꼭짓점을 고정해 두 축 크기 조절 |
| 네 변 중간점 드래그 | 반대 변을 고정해 한 축 크기 조절 |
| 프레임·테두리에 포커스 후 방향키 | 프레임 이동 |
| 손잡이에 포커스 후 방향키 | 해당 손잡이 크기 조절 |
| Shift + 방향키 | 더 큰 간격으로 이동·조절 |
| 외부 인원수 값 변경 | 전달받은 숫자만 갱신 |

인원수는 `peopleCount` prop으로 받는다. `null`이면 미확인 `—`, `0`이면 `0`, `3`이면 `3`을 그대로 표시한다. 프레임 이동·크기 조절로 이 값을 다시 계산하지 않는다. 개발 페이지의 버튼은 외부에서 값이 바뀌어 전달되는 상황만 시연한다.

사용자 지정 연결 흐름: 프레임 변경(`onChange`) → 로컬 AI가 인원수 계산 → 결과를 `peopleCount`로 전달 → UI 표시. 로컬 AI의 종류와 계산 구현은 이 UI 추출에 포함하지 않는다.

## React 연결

```tsx
const [frame, setFrame] = useState({ x: .14, y: .08, w: .72, h: .88 });

<div style={{ position: 'relative', width: '100%', height: 600 }}>
  <SelectionFrame value={frame} onChange={setFrame} peopleCount={peopleCount} />
</div>
```

- `value`: `{x,y,w,h}`. 부모 시야 영역 기준 0~1 좌표다.
- `onChange`: 이동·크기 조절과 부모 크기 변경에 맞춰 제한된 값을 돌려준다. 값을 상태에 다시 반영한다.
- `peopleCount`: 외부에서 계산한 `number | null`. 숫자의 계산·갱신은 호출 측이 맡는다. 이 컴포넌트는 표시만 한다.
- 12px 안쪽 여백과 최소 260×160px을 유지하며, 더 작은 부모에서는 들어갈 수 있는 크기까지 줄인다.
- `object-fit: cover` 원본 좌표와 부모 좌표는 다를 수 있다. 원본 검출 결과와 전송 범위에 연결할 때 기존 `ui/geometry.ts`의 cover 변환을 사용한다. 부모 좌표를 `Session.captureFrame`에 그대로 쓰지 않는다.

## 기존 실제 앱과의 구분

현재 main(#43)의 `Hud.PersonCount`와 `selectFaceM` 등 기존 계산은 변경하지 않는다. 이번 추출은 프레임 UI와 숫자 표시까지만 제공하며, 기존 HUD·보호 카운터·전송 범위·가림 파이프라인·core 계약을 바꾸지 않는다. 기존 앱에 자동 장착하지 않는다.

원본 픽셀 접근과 검출·가림은 A 트랙의 책임이며, 실제 전송 범위 연결은 F24의 소스 좌표·포착 시점 계약을 따른다. 이번 컴포넌트를 넣는 것만으로 픽셀 전송 범위나 사람 검출 기능이 연결되지는 않는다. 관련 근거는 사용자 요청에 따른 UI 추출, F8·F24·FR-061과 기존 G1·G2 경계다.

## 검증

- `npm run typecheck`, `npm run check:ui`, `npm run check:core`, `npm run build`.
- `npx tsx scripts/check-selection-frame.ts`: 이동 제한, 네 모서리·네 중간점·최소 크기·작은 부모 검증.
- 브라우저에서 테두리 이동, 8개 손잡이, 터치, 방향키, 부모 크기 변경, 외부 숫자 갱신과 프레임 조작 시 숫자 유지, 흰 배경 없음과 숫자 1.5px 외곽선을 확인한다. 실행 결과는 PR 본문에 기록한다.
- 실제 카메라·모델의 검출 정확도, 전송·모자이크 연결, 실휴대폰·글래스는 이 UI 추출로 검증하지 않는다.

## 앱 연결(2026-11-01, `track-c/outfit-ui`)

사용자 결정(2026-11-01): 휴대폰 웹은 스마트 글래스 시야를 휴대폰 브라우저로 흉내 내는 화면이고, 플랫폼 UI는 이 프레임을 최대한 따른다. 그래서 메인 화면(`/`)의 흰 틀은 이 컴포넌트다.

- `CaptureFrame`이 `SelectionFrame`을 그린다. 스토어의 `session.captureFrame`(소스 0~1)과 이 컴포넌트의 부모 0~1 값은 `geometry.ts`의 `sourceToView`·`viewToSource`(cover 변환)로 오간다.
- 휴대폰·데스크톱에서는 늘 조절할 수 있다(조절 모드 버튼 없음). 화면에 맞춘 값(12px 여백, 최소 260×160px)도 스토어에 쓴다. 그래서 흰 틀이 곧 보내는 범위다.
- `/hud`는 `editable={false}`로 틀과 숫자만 그리고 스토어에 쓰지 않는다. 글래스 화면은 검정이 투명이라 숫자를 흰색으로 48px로 그린다(NFR-040).
- `peopleCount` = `selectConsentCount(s)`(지금 살아 있는 코디 스캔 동의 수, 평소 0). 1 이상이면 `onCountPress`로 숫자가 버튼이 되고, 누르면 모든 동의를 끈다(`revokeConsent`).
- 이 컴포넌트에 더한 선택 prop: `editable`(기본 true), `countLabel`, `onCountPress`, `countPressLabel`. 개발 페이지 동작은 그대로다.
- 플러그인 화면(금빛 상태창·코디 답 패널, z 4)보다 위(z 5)에 두어 앱 화면이 틀과 숫자를 덮지 않게 한다.
