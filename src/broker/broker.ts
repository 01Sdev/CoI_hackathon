// 중개기(F6 단일 경로). 근거: 02-SSRD IF-02·§4, docs/designs/track-a-runtime.md §2.8.
// 플러그인에 바이트를 보내는 sendDelivery는 이 파일에서만 부른다. 가린 Blob만 받고 원본 프레임에는 닿지 않는다.

import type { HostToPlugin } from '../core/messages';
import { lensStore, type NewDelivery, type NewDetection } from '../core/store';
import type { Branch, Delivery } from '../core/types';
import { sha256Hex } from './sha256';

export type DeliveryMessage = Extract<HostToPlugin, { type: 'delivery' }>;
/**
 * B(plugins/host)의 전달 함수. **돌아오기 전에** postMessage까지 성공하면 markDelivery(id, 'dispatched'),
 * 거부(bytes ≠ blob.size, 게이트 닫힘, runtimeId·버전 불일치)·예외면 'failed'로 바꾼다. 돌아온 뒤에도 prepared면 중개기가 failed로 바꾼다.
 */
export type SendDelivery = (pluginId: string, msg: DeliveryMessage) => void;

let host: SendDelivery | null = null;

/**
 * B가 시작할 때 한 번 부른다. 연결은 하나뿐이다: 이미 연결돼 있으면 거부하고(경고) 아무것도 하지 않는 함수를 돌려준다.
 * 돌려준 함수로 끊은 뒤에만 다시 연결할 수 있다(HMR에서는 dispose에서 끊는다).
 */
export function connectPluginHost(send: SendDelivery): () => void {
  if (host && host !== send) {
    console.warn('[broker] 플러그인 호스트가 이미 연결돼 있어 새 연결을 거부함');
    return () => undefined;
  }
  host = send;
  return () => {
    if (host === send) host = null;
  };
}

export function isPluginHostConnected(): boolean {
  return host !== null;
}

/** 보류(2d, 대상 재검출 실패, 출구 재검사, 검사 실패). Delivery를 만들지 않고 로그만 남긴다. */
export function hold(pluginId: string, sceneDecisionId: string | null, branch: Branch | null, reason: string, detections?: readonly NewDetection[]): void {
  lensStore.getState().addLog({ pluginId, sceneDecisionId, kind: 'hold', branch, reason, enforcedBy: null }, detections);
}

/** 선언하지 않은 장면 등. 같은 플러그인·같은 사유는 스토어가 10초에 1번만 남긴다. */
export function skip(pluginId: string, sceneDecisionId: string | null, reason: string): void {
  lensStore.getState().addLog({ pluginId, sceneDecisionId, kind: 'skip', branch: null, reason, enforcedBy: null });
}

export type DeliverInput = Omit<NewDelivery, 'bytes' | 'sha256' | 'thumbnailRef' | 'location' | 'blob'> & { blob: Blob };

/**
 * 해시·썸네일을 만들고 prepareDelivery(prepared) → sendDelivery. 포착 중 전환으로 prepareDelivery가 null이면
 * 아무것도 남기지 않고 null을 돌려준다(호출자는 그 포착을 버린다).
 */
export async function deliver(input: DeliverInput, log: { sceneDecisionId: string | null; reason?: string }, detections?: readonly NewDetection[]): Promise<Delivery | null> {
  const { blob, ...meta } = input;
  const sha256 = await sha256Hex(blob);
  // 썸네일은 보낸 Blob 그대로(전송 바이트 = 로그 썸네일, IF-02). 해제는 스토어가 한다.
  const thumbnailRef = URL.createObjectURL(blob);
  const store = lensStore.getState();
  const r = store.prepareDelivery({ ...meta, bytes: blob.size, sha256, thumbnailRef, location: 'browser', blob }, log, detections);
  if (!r) {
    URL.revokeObjectURL(thumbnailRef);
    return null;
  }
  const d = r.delivery;
  const msg: DeliveryMessage = {
    type: 'delivery',
    deliveryId: d.id,
    scene: d.scene,
    objectLabel: d.objectLabel,
    width: d.width,
    height: d.height,
    bytes: d.bytes,
    blob,
  };
  if (!host) {
    console.warn('[broker] 연결된 플러그인 호스트 없음, failed로 기록', d.id);
    store.markDelivery(d.id, 'failed');
    return d;
  }
  try {
    host(d.pluginId, msg);
  } catch (e) {
    console.error('[broker] sendDelivery 예외', e);
  }
  // B가 dispatched·failed로 바꿨으면 아무 일도 없다(markDelivery는 prepared에서만 바뀜). 예외·미기록이면 failed.
  if (lensStore.getState().markDelivery(d.id, 'failed')) console.warn('[broker] sendDelivery가 상태를 남기지 않아 failed로 기록', d.id);
  return d;
}
