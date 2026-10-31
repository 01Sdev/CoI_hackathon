// 플러그인 SDK 타입(Worker 안의 전역 `framelet`). 규칙: docs/specs/02-SSRD.md "플러그인 SDK".
// 런타임 구현은 B(src/plugins/)가 Worker 코드 문자열로 만든다. 여기는 플러그인 작성자와 B가 같이 보는 계약이다.

import type { Manifest } from './manifest';
import type { ViolationAttempt } from './messages';
import type { ResultSource, SceneLabel } from './types';

export interface FrameletInit {
  pluginId: string;
  manifest: Manifest;
  /** 호스트 origin. 비교 모드의 칼로리 iframe에서는 null이고, 그때는 요청하지 않고 고정표를 쓴다. */
  apiBase: string | null;
}

export interface FrameletDelivery {
  deliveryId: string;
  scene: SceneLabel;
  /** COCO 영문 물체 라벨(pizza 등). x-label·고정표 키. */
  objectLabel: string;
  width: number;
  height: number;
  bytes: number;
  /** 호스트가 보낸 JPEG 그대로. /api/calorie에는 다시 인코딩하지 않고 이 Blob을 본문으로 보낸다. */
  blob: Blob;
}

/** IF-09. 착용자가 말로 물은 것. deliveryId는 이 플러그인이 onDelivery로 이미 받은 조각이다. */
export interface FrameletQuestion {
  questionId: string;
  deliveryId: string;
  text: string;
}

export interface FrameletSdk {
  /** 최상위에서 바로 등록. Promise가 끝나면 ready를 보낸다. 2.5초를 넘기거나 예외면 ready 없음. */
  onInit(handler: (init: FrameletInit) => void | Promise<void>): void;
  /** 전달마다. SDK는 이 핸들러를 부르기 전에 ack(SHA-256)를 먼저 보낸다. */
  onDelivery(handler: (d: FrameletDelivery) => void | Promise<void>): void;
  /** 결과 한 줄(IF-05). deliveryId당 1번, 200자까지. */
  result(deliveryId: string, text: string, source: ResultSource): void;
  /** 자기 보고(IF-06). 같은 attempt·target은 1번만. */
  reportViolation(attempt: ViolationAttempt, target: string): void;
  /** 코디 스캔 질문(IF-09). 질문을 받는 플러그인만 등록한다. */
  onQuestion(handler: (q: FrameletQuestion) => void | Promise<void>): void;
  /** 답(IF-10). questionId당 1번, 1,000자까지(줄바꿈 허용). */
  answer(questionId: string, text: string, source: 'api' | 'fallback'): void;
}

/** SDK가 init 뒤 ready를 기다리는 최대 시간. 호스트 READY_TIMEOUT_MS(3초)보다 짧아야 한다. */
export const SDK_INIT_TIMEOUT_MS = 2_500;
