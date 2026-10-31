# 음식 상태창 추출본

사용자가 지정한 `design.html`의 금빛 연결선, 장식 테두리와 순환 글로우, 글꼴 스타일만 추출했다. React 18·TypeScript·Vite에 맞췄으며, 기존 앱에 자동 연결하지 않는다. 카페 사진, 선택 프레임, 사람 수, 로그, 모델, API는 포함하지 않는다.

## 파일과 미리보기

- `src/ui/FoodStatusPanel.tsx`: 연결선·상태창 SVG, 드래그·방향키 이동, 닫기, 글로우 제어.
- `src/ui/food-status-panel.css`: 위 요소만 대상으로 하는 스타일. 기존 `pretendard` 패키지를 재사용하며 새 의존성을 추가하지 않는다. 글꼴 파일은 앱에서는 `theme.css`가, 미리보기에서는 `dev/food-status-panel.tsx`가 불러온다(2026-11-01, 겹친 `@import` 정리).
- `dev/food-status-panel.html`, `dev/food-status-panel.tsx`: 해당 컴포넌트만 보여 주는 개발 페이지. 이름은 표시 예시이며 인식을 실행하지 않는다.

`npm run dev`를 실행한 뒤 출력된 로컬 주소에 `/dev/food-status-panel.html`을 붙인다. 예: `http://localhost:5173/dev/food-status-panel.html`. 개발 페이지는 루트 `index.html`만 사용하는 현재 프로덕션 빌드 입력에 포함되지 않는다.

## 연결 방법

```tsx
import { FoodStatusPanel } from './ui/FoodStatusPanel';

<div style={{ position: 'relative', width: '100%', height: 480 }}>
  <FoodStatusPanel
    result={foodResult}
    anchor={{ x: 0.2, y: 0.78 }}
  />
</div>
```

- `foodResult`: `{ id: string | number, name: string, kcal: number | null }` 또는 `null`. 실제로 확인된 결과만 넘기고, 인식하지 못하면 `null`로 숨긴다.
- `id`: 새로운 인식 결과마다 바뀌는 식별자. ×로 닫은 뒤 새 ID의 결과가 들어오면 다시 열린다. 같은 결과를 렌더링하는 동안에는 닫힌 상태를 유지한다.
- `kcal`: 호출 측에서 확인한 실제 열량만 전달한다. `null`, 음수 또는 유효하지 않은 값이면 `— kcal`를 표시한다.
- `anchor`: 부모 영역 기준 0~1 좌표. 연결선 시작점이며, 이미지의 박스 좌표를 화면 좌표로 바꾸는 처리는 포함하지 않는다.
- 부모는 `position: relative`와 명시적인 높이가 필요하다. 상태창 위치는 부모 내부로 제한되고, 창을 움직이면 연결선도 함께 바뀐다.
- 이름은 `textContent`로 넣는다. 폰트는 `Pretendard Variable`, `Pretendard`, `Malgun Gothic`, `sans-serif` 순서다. 원본 글자 크기 36/40px, 이름 굵기 600, 열량 굵기 500, 금빛 색상을 유지했다.
- SVG ID는 인스턴스별로 분리한다. 움직임 줄이기 설정에서는 글로우를 숨기고, 창이 닫히거나 탭이 숨겨지면 애니메이션을 멈춘다.

기존 `Hud.tsx`, 스토어, 플러그인 계약과 전역 테마는 바꾸지 않았다. 앱에 연결하는 작업은 별도다. 2026-11-01 `src/ui/PluginViews.tsx`가 칼로리 플러그인 화면으로 연결했다(이름은 `sanitizeAppText`를 거치고, `anchor`는 0단계 대상 박스 중심, 고정표 결과는 이름 뒤에 "(고정표)"). 결과가 아직 없는 최신 전달이 있으면 `{ id: 그 전달의 deliveryId, name: 대상 이름, kcal: null }`로 먼저 띄워 "— kcal"이 보이고, 결과가 오면 같은 id라 같은 창에서 숫자로 바뀐다(`labels.ts` `calorieView`). 이 추출본의 금색은 사용자가 지정한 원본 시안이며, 기존 전역 의미색 토큰을 재정의하지 않는다.

## 확인한 결과

2026-11-01 확인:

- `npm run typecheck` 통과(앱·개발 페이지·기존 assertion 스크립트 타입 검사).
- 실제 Vite 개발 서버와 Chromium에서 테두리 글로우의 시각적 이동, 로컬 Pretendard 로딩, 드래그 시 연결선 갱신을 확인했다.
- ×로 닫기, 새 ID로 재표시, 결과가 `null`일 때 숨김, 움직임 줄이기에서 애니메이션 정지를 확인했다.
- 390px 너비에서 가로 넘침이 없고 상태창이 화면 안에 배치됐다. 스크립트 오류와 외부 도메인 요청은 없었다.
- 실제 앱·카메라·모델과의 연결, 실기기 검증은 이 추출 작업에 포함하지 않았다.

## PowerShell에서 브랜치와 커밋 만들기

파일은 이미 프로젝트 경로에 있다. 복사할 필요가 없다. 아래 Git 작업은 사용자가 직접 실행한다.

```powershell
cd "C:\Users\oscar\Desktop\Project\Inthon\CoI_hackathon"
git status --short
git switch -c track-c/food-status-panel
npm run typecheck
npm run dev
```

미리보기에서 상태창 이동·닫기·다시 표시를 확인한 뒤, 개발 서버 터미널에서 Ctrl+C를 누른다. 같은 이름의 브랜치가 이미 있으면 생성 명령 대신 `git switch track-c/food-status-panel`을 쓴다.

기존 수정 파일이 많으므로 이번 파일만 지정한다. 아래 경로에는 카페 이미지나 모델이 들어가지 않는다.

```powershell
git add -- src/ui/FoodStatusPanel.tsx src/ui/food-status-panel.css dev/food-status-panel.html dev/food-status-panel.tsx docs/designs/food-status-panel.md
git diff --cached --stat
git diff --cached --check
git commit -m "feat: extract glowing food status panel" -m "Co-Authored-By: Codex <noreply@openai.com>"
git push -u origin track-c/food-status-panel
```

커밋 전에 `git diff --cached --stat`에 위 다섯 파일만 있는지 확인한다. 미리 스테이징한 다른 파일이 있다면 별도로 처리한 뒤 진행한다. 푸시 후 GitHub에서 `track-c/food-status-panel` → `main`으로 PR을 만든다. 관련 근거는 사용자 요청에 따른 디자인 추출이며 기존 F8/FUI 표시의 참고용이다. 검증에는 타입 검사와 개발 페이지의 이동·연결선·닫기·새 결과 재표시를 적고, 실카메라·실모델 연결은 미검증으로 적는다.
