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
