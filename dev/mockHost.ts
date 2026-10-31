// /dev/ 전용 B 목 호스트. 실제 iframe·Worker 없이 B가 할 스토어 쓰기만 흉내 낸다(02-SSRD §1 "/dev/* 목 호출").
// - 플러그인마다 selectDesiredRuntime을 구독해 300ms 뒤 ready(새 runtimeId)로 게이트를 연다(전환 공통 절차 흉내).
// - connectPluginHost로 sendDelivery를 넘긴다: dispatched로 바꾸고, 받은 Blob의 해시로 ack(match)를 쓴다.

import { shallow } from 'zustand/shallow';
import { selectDesiredRuntime, type DesiredRuntime } from '../src/core/selectors';
import { lensStore, newId } from '../src/core/store';
import { sha256Hex } from '../src/broker/sha256';
import { connectPluginHost, type DeliveryMessage } from '../src/vision';

export interface MockSent {
  pluginId: string;
  deliveryId: string;
  bytes: number;
  at: number;
}

const sent: MockSent[] = [];
export const getMockSent = () => sent;

let started = false;

export function startMockHost(): void {
  if (started) return;
  started = true;
  const s = lensStore.getState();
  for (const id of s.pluginOrder) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    lensStore.subscribe(
      (st) => selectDesiredRuntime(st, id),
      (want: DesiredRuntime | null) => {
        if (timer) clearTimeout(timer);
        if (!want) return;
        const st = lensStore.getState();
        if (!want.enabled) {
          if (st.plugins[id]?.status !== 'terminated') st.setPluginRuntime(id, { status: 'terminated', runtimeId: null, runtimePolicy: null });
          return;
        }
        st.setPluginRuntime(id, { status: 'loading', runtimeId: null, runtimePolicy: null });
        timer = setTimeout(() => {
          const now = selectDesiredRuntime(lensStore.getState(), id);
          if (!now || !shallow(now, want)) return;
          lensStore.getState().setPluginRuntime(id, {
            status: 'ready',
            runtimeId: newId(`mock-${id}`),
            runtimePolicy: { connect: want.connect, manifestVersion: want.manifestVersion },
            gateOpen: true,
          });
        }, 300);
      },
      { equalityFn: shallow, fireImmediately: true },
    );
  }

  connectPluginHost((pluginId: string, msg: DeliveryMessage) => {
    const st = lensStore.getState();
    if (msg.bytes !== msg.blob.size) {
      st.markDelivery(msg.deliveryId, 'failed');
      return;
    }
    st.markDelivery(msg.deliveryId, 'dispatched');
    sent.push({ pluginId, deliveryId: msg.deliveryId, bytes: msg.bytes, at: performance.now() });
    void sha256Hex(msg.blob).then((h) => lensStore.getState().setAck(msg.deliveryId, h));
  });
}
