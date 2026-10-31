# 에이전트 작업 규칙

이 레포에서 코드를 만드는 모든 에이전트(Claude Code, Codex 등)는 이 파일을 먼저 읽는다.

## 반드시 지킬 두 가지

1. **EGM이 있으면 EGM으로 설계하고 리뷰한다.** 작업 환경에 EGM(Elephant-Goldfish Model) 플러그인이 설치돼 있으면 쓴다. Claude Code에서는 `/egm:*` 스킬, Codex에서는 스킬 선택기의 EGM 스킬이다.
   - 설계 결정이 필요한 기능은 `egm-draft`로 설계 문서를 쓰고 `egm-review`로 검토받는다. 사용자가 승인한 뒤에 구현한다. 승인된 설계는 `docs/designs/`에 둔다.
   - 레포에 EGM 문서(`egm-bootstrap`이 만든 디렉터리 README, `docs/designs/`)가 있으면 코드를 고치기 전에 먼저 읽고, 코드를 바꾸면 함께 갱신한다.
   - 작은 버그 수정처럼 설계 결정이 없는 일은 일반 흐름으로 한다.
2. **부분 부분 구현하고 그때그때 PR을 올린다.**
   - 기능 하나 또는 통합 관문 하나가 동작하면 바로 브랜치를 PR로 올린다. 여러 기능을 한 PR에 몰지 않는다.
   - `main`에 직접 푸시하지 않는다.
   - PR 본문에는 다음을 적는다.
     - 관련 요구사항 번호(FR·NFR·IF·F)
     - 직접 확인한 방법
     - 확인하지 못한 것

## 기준 문서

| 문서 | 쓰임 |
| --- | --- |
| `docs/specs/02-SSRD.md` | **기준 인터페이스 계약.** 메시지, 매니페스트, `/api/calorie`, 전환 절차, 트랙 소유 |
| `docs/specs/03-SRS.md` | 요구사항(FR·NFR)과 시험(TC) |
| `docs/specs/04-ERD.md` | 메모리 데이터 모델 |
| `docs/specs/PRD.md` | 제품 범위, 보장, 데모 시나리오 |
| `docs/specs/05-코드-전-결정사항.md` | 팀이 정한 결정 결과(맨 위 표) |
| `docs/specs/06-유저플로우.html` | 사용자 흐름 그림 |
| `docs/specs/00-추가결정사항.md`, `01-SRD.md` | 배경 결정, 운영 환경 |

명세의 원본은 이 레포의 `docs/specs/`다. 명세를 바꾸면 같은 PR에서 코드도 맞춘다. `core/`의 타입·계약을 바꾸면 `02-SSRD.md`도 같은 PR에서 고친다.

## 트랙과 디렉터리 소유

| 트랙 | 맡는 것 | 디렉터리 | 브랜치 접두어 |
| --- | --- | --- | --- |
| A 런타임 | 입력, 0~2단계 판정·포착·가림, 중개기, 처리량 | `src/input/`, `src/vision/`, `src/broker/` | `track-a/` |
| B 격리·플러그인 | iframe·Worker, 메시지, 칼로리·변조·hello 플러그인, `/api/calorie` | `src/plugins/`, `api/` | `track-b/` |
| C UI | HUD, 로그, 확인 화면, 매니페스트 편집기, 전달 신호, 바깥 표시, 비교 모드, 발표자 컨트롤 | `src/ui/`, `src/proof/` | `track-c/` |
| 공용 | 타입, `validateManifest`, 스토어 | `src/core/` | `core/` |

- 다른 트랙의 디렉터리는 고치지 않는다. 필요하면 그 트랙의 PR로 요청한다.
- `src/core/`는 세 트랙이 합의하고 바꾼다. 바꾸는 PR에는 영향받는 트랙을 적는다.

## 구현 규칙

- **스택:** Vite, React 18, TypeScript strict, zustand, `@mediapipe/tasks-vision`, Vercel 함수. UI 라이브러리는 쓰지 않는다.
- **모델·WASM:** CDN이 아니라 `public/`에 둔다.
- **비밀값:** API 키(`ANTHROPIC_API_KEY`)는 서버 환경 변수에만 둔다. 레포와 클라이언트 코드에 넣지 않는다. 빌드 결과물 `dist`에서 키 문자열이 나오지 않는지 확인한다.
- **원본 픽셀 접근:** 원본 프레임에 닿는 API(`getUserMedia`, `drawImage(video)` 등)는 A 트랙 디렉터리에서만 쓴다. 자세한 허용 위치는 `02-SSRD.md` §1을 따른다.
- **플러그인 문자열:** 플러그인이 보낸 문자열은 `textContent`로만 화면에 넣는다.
- **테스트:** 테스트 프레임워크는 쓰지 않는다. 쿨다운, 좌표 변환, 분기, 전환처럼 경계가 있는 함수는 짧은 assertion 스크립트로 확인한다. 실기기 확인 항목은 `05-코드-전-결정사항.md`의 V1~V14를 따른다.
- **제품명:** famelet(2026-10-31 확정). 코드와 화면 문구에서 이름을 직접 쓰지 말고 `src/core/` 상수 하나(`APP_NAME`)로 모은다. 옛 문서·대화의 LensGate는 같은 제품의 가칭이다.

## 아직 정해지지 않은 것

- **Supabase 사용 여부와 범위:** 사용자가 나중에 알려 준다. 지금 명세는 영구 저장소가 없는 설계다(`04-ERD.md`). 결정이 오기 전에는 Supabase를 넣지 않는다.
- **배포 방식과 주소:** 사용자가 나중에 알려 준다. 명세는 Vercel을 전제로 한다.

## 커밋

커밋 메시지 끝에 작업한 에이전트의 Co-Authored-By 줄을 붙인다.
