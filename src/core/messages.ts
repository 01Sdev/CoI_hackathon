// 호스트 ↔ 플러그인 메시지(IF-01~06, 코디 스캔 IF-09·10)와 /outward 메시지(IF-07). 02-SSRD §3 그대로.

import type { Manifest } from './manifest';
import type { SceneLabel, Enforced } from './types';

export type { SceneLabel, Enforced };

/** 호스트 → 플러그인. 해시는 싣지 않는다(IF-04). */
export type HostToPlugin =
  | { type: 'init'; pluginId: string; manifest: Manifest; apiBase: string | null; code: string } // IF-01
  | {
      type: 'delivery'; // IF-02
      deliveryId: string;
      scene: SceneLabel;
      objectLabel: string;
      width: number;
      height: number;
      bytes: number;
      blob: Blob;
    }
  // IF-09 코디 스캔 질문. deliveryId는 그 플러그인에 이미 보낸 조각이다(새 픽셀을 싣지 않는다).
  | { type: 'question'; questionId: string; deliveryId: string; text: string };

/** 플러그인 → 호스트. 플러그인이 보낸 pluginId는 권한 판단에 쓰지 않는다. */
export type PluginToHost =
  | { type: 'ready'; pluginId: string } // IF-03
  | { type: 'ack'; deliveryId: string; sha256: string } // IF-04
  | { type: 'result'; deliveryId: string; text: string; source: 'api' | 'fallback' } // IF-05
  | { type: 'violation'; attempt: ViolationAttempt; target: string } // IF-06, 플러그인 자기 보고
  // IF-10 코디 스캔 답. 1,000자(PLUGIN_MESSAGE_LIMITS.answerText), 줄바꿈 허용. questionId당 1번.
  | { type: 'answer'; questionId: string; text: string; source: 'api' | 'fallback' };

export type ViolationAttempt = 'camera' | 'hostDom' | 'fetch' | 'script';

/** IF-07. 숫자와 불리언만. at = Date.now(). */
export type OutwardMessage = { type: 'outward'; apps: number; compareMode: boolean; at: number };
