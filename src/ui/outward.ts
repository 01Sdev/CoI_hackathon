// IF-07 바깥 표시 채널. 메인 창이 1초마다 재발행하고, /outward 창은 받기만 한다.
// 싣는 것은 숫자와 불리언뿐(apps, compareMode, at). 값은 selectOutwardApps 그대로이고 여기서 다시 세지 않는다.

import { useEffect } from 'react';
import { OUTWARD_CHANNEL } from '../core/constants';
import type { OutwardMessage } from '../core/messages';
import { selectOutwardApps } from '../core/selectors';
import { lensStore } from '../core/store';

/** 마지막 메시지가 이보다 오래되면 "연결 끊김"(IF-07 [제안], 배치도 /outward). 재발행 주기 1초의 5배. */
export const OUTWARD_STALE_MS = 5_000;
export const OUTWARD_REPUBLISH_MS = 1_000;

/** 채널로 받은 값을 검사한다. 모양이 다르면 null(다른 창·옛 코드가 보낸 것은 버린다). */
export function parseOutwardMessage(data: unknown): OutwardMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.type !== 'outward') return null;
  if (typeof m.apps !== 'number' || !Number.isInteger(m.apps) || m.apps < 0 || m.apps > 99) return null;
  if (typeof m.compareMode !== 'boolean') return null;
  if (typeof m.at !== 'number' || !Number.isFinite(m.at)) return null;
  return { type: 'outward', apps: m.apps, compareMode: m.compareMode, at: m.at };
}

export type OutwardView =
  | { state: 'pending' }
  | { state: 'stale'; last: OutwardMessage }
  | { state: 'live'; last: OutwardMessage };

/** now = Date.now(). 같은 기기의 두 창이라 at과 같은 시계를 쓴다. */
export function outwardView(last: OutwardMessage | null, now: number): OutwardView {
  if (!last) return { state: 'pending' };
  if (now - last.at > OUTWARD_STALE_MS) return { state: 'stale', last };
  return { state: 'live', last };
}

/** 메인 창(휴대폰·데스크톱)에서만 부른다. 값이 바뀌면 바로, 그 밖에는 1초마다 다시 보낸다. */
export function useOutwardPublisher(): void {
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(OUTWARD_CHANNEL);
    let prev = '';
    const publish = (force: boolean) => {
      const s = lensStore.getState();
      const msg: OutwardMessage = { type: 'outward', apps: selectOutwardApps(s), compareMode: s.session.compareMode, at: Date.now() };
      const key = `${msg.apps}|${msg.compareMode}`;
      if (!force && key === prev) return;
      prev = key;
      ch.postMessage(msg);
    };
    publish(true);
    const t = window.setInterval(() => publish(true), OUTWARD_REPUBLISH_MS);
    const unsub = lensStore.subscribe((s) => s.counter.recent10s, () => publish(false));
    const unsubMode = lensStore.subscribe((s) => s.session.compareMode, () => publish(false));
    return () => {
      window.clearInterval(t);
      unsub();
      unsubMode();
      ch.close();
    };
  }, []);
}
