# 입력 단계 광각(양옆 휘어짐)

상태: 구현(2026-11-01, 트랙 A). 출처: 사용자가 Codex 에이전트(donggyun/x20-codex-23)의 결과를 보고 "지금 광각효과 딱 좋아"로 승인했고, 배포 웹사이트에서 이 효과를 기본으로 쓰기로 했다. 넣을 위치는 허브가 정했다(사용자 선호 없음, 추천안).

인계 원본(레포 밖, 읽기만 함):
- `pov-warp-lab.html`(sha256 `1d39d488…92bf`)
- `POV-landscape-wrap.ko.md`
- `landscape-wrap.cjs`

## 위치

- 입력 단계에서 휜다. `src/input/adapter.ts`의 `grabFrame()`이 지금 `<video>` 프레임을 휜 캔버스에 그려 돌려준다. 0단계(`vision/stage0.ts`)와 포착(`vision/capture.ts`)은 `<video>` 대신 이것만 읽는다.
- 미리보기(`mountPreview`)에도 같은 캔버스를 붙인다. `<video>`는 같은 컨테이너에 1px·투명으로 남긴다. 문서 안에 있어야 iPhone이 프레임을 계속 내기 때문이다.
- 그래서 보이는 화면, 0단계 판정, 흰 틀 자르기, 얼굴 가림, 출구 재검사, 보내는 조각이 모두 같은 휜 픽셀이다.
- 원본 픽셀 규칙(02-SSRD §1)은 그대로다. 휜 캔버스도 원본 프레임이라 `src/input/` 밖으로는 `src/vision/`에만 나간다. 저장·업로드하지 않는다. 권한·개인정보 흐름은 바뀌지 않는다.

## 수식과 기본값

- `src/input/warp.ts`(순수 함수)와 `src/input/warpRenderer.ts`(렌더러)는 인계 파일의 수식을 바꾸지 않고 옮겼다.
  - fragment shader: 97~117행
  - `renderCPU`: 156행~
  - `render()`의 cover/contain·cornerScale·zoom·pan 경계: 196~205행
- 출력 → 원본 역매핑:
  - `angle = (p.x / Ao) * periphery`
  - `p.x = Ao * tan(angle) / tan(periphery)`
  - `p.y *= periphery / (tan(periphery) * cos(angle))`
  - 이 세 줄은 `periphery > 0.0001`일 때만 적용한다. 그다음 `q = p * (1 + k * r2) / zoom`.
- 기본값(`src/input/config.ts`의 `WIDE_WARP`): `fit` cover, `strength` 0, `framing` 1, `lookX`·`lookY` 0, `periphery` 0.82.
  - 0.82는 사용자가 iPhone에서 마지막으로 맞춘 값이다. 인계 파일의 슬라이더 기본값은 0.80이다.
  - cover 0.82에서는 확대 `z = 0.82 / sin 0.82 ≈ 1.12`라 위아래가 조금 잘린다.
- 출력 크기: 원본 비율 그대로, 긴 변 1280 이하(키우지 않음), 짝수 px.
  - 인계 파일의 출력 비율 기본은 16:9였다. 여기서는 원본 비율로 두었다. 세로 입력을 16:9로 자르지 않고, C의 화면 배치와 `session.input` 비율이 그대로이게 하기 위해서다.
  - 방향은 브라우저가 디코딩한 그대로다. 자동 회전은 하지 않는다. 영상 크기가 바뀌면 다음 그리기에서 캔버스 크기를 다시 맞춘다.
- 경로: WebGL2를 먼저 쓴다. 안 되면 CPU(긴 변 640, 쌍선형) 경로다. 둘 다 안 되면 휘지 않고 `<video>`를 쓴다. 새 의존성은 없다.
- 끄기: `WIDE_WARP.enabled = false`(`/dev`는 `?warp=0`). 꺼지면 `<video>`를 그대로 쓰므로 원본과 같다. 수식도 periphery 0이면 항등이다(검사 있음).
- `periphery`는 실제 화각(°)이나 초광각 렌즈가 아니다. 원통형 역투영의 2D 재투영이고, 없는 픽셀을 만들지 않는다.

## 좌표가 한결같은 이유

- 0단계 박스(0~1), 흰 틀 `captureFrame`(0~1), 조각 `cropRect`·`frameRect`(px), 얼굴·사람 박스, 응시·동의 상자는 모두 `grabFrame()`의 휜 프레임 한 장을 기준으로 잰다.
- 미리보기 캔버스는 원본과 비율이 같다. 그래서 C가 `session.input` 비율로 하는 cover 매핑(`src/ui/geometry.ts`)이 휜 화면에도 그대로 맞는다.
- 그리기는 읽는 쪽이 같은 task 안에서 한다(`render` 뒤 바로 `drawImage`). WebGL `preserveDrawingBuffer: false`여도 그 프레임을 읽는다.

## 한계와 위험

- **가장자리 얼굴 검출이 약해진다.** 휜 프레임은 가운데를 가로 약 1.31배로 키우고 양 끝을 약 0.61배로 줄인다(세로는 1.31배 → 0.89배).
  - 이모지 얼굴로 재 보니 가운데 얼굴은 BlazeFace 점수가 올랐다(0.75 → 0.86).
  - 휜 프레임 가로 위치 0.97 근처 얼굴은 0.5까지 떨어지거나 못 찾았다. 원본에서는 0.6~0.76으로 찾았다.
  - `/dev`의 `local-face-pizza` 영상에서도 오른쪽 끝 얼굴을 휜 프레임에서는 못 찾았다. BlazeFace는 피자 위에 잘못 잡은 박스를 가렸고, 출구 재검사도 0이라 얼굴이 가려지지 않은 채 전달됐다(그림 얼굴, `/dev`).
  - 출구 재검사도 같은 휜 픽셀을 보므로 같은 약점이 있다.
  - 고치는 방법 후보: 얼굴만 휘기 전 원본에서 찾아 휜 좌표로 옮겨 가린다(이 PR에는 없음).
- **판정 부담:** 노트북 Chrome에서 0단계는 5.0fps를 유지했다. 0단계 추론 시간 측정값(`meanInferMs`)은 평균 22ms에서 약 43ms로 늘었다. 휜 GPU 캔버스를 읽는 동기화가 그 안에 들어간 것으로 본다. `grabFrame` + 읽기는 약 5.4ms였다. 미리보기는 30fps로 다시 그린다. 휴대폰 실측은 없다.
- cover에서는 가장자리가 잘린다(위 `z`).
- 실기기 화각, 발열, 사용자 기준의 최종 느낌은 인계 메모와 마찬가지로 확인하지 않았다.
