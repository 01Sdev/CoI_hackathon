// 전달·보류 신호와 1초 tick.
// 전달 신호는 dispatched로 바뀐 Delivery마다 한 번(FR-040: dispatched 수 = 점멸 수). 보류(2d)는 소리·진동·점멸 없이 "보류"만(FR-041).

import { useEffect, useState } from 'react';
import { lensStore } from '../core/store';
import type { Delivery, LogEntry } from '../core/types';
import { playDeliveryTone, vibrateDelivery } from './signal';

/** C가 1초마다 tick()을 부른다. 10초·60초 창에서 지난 기록이 빠지며 M·처리량이 다시 그려진다. */
export function useStoreTick(): void {
  useEffect(() => {
    const t = window.setInterval(() => lensStore.getState().tick(), 1000);
    return () => window.clearInterval(t);
  }, []);
}

export interface DeliverySignal {
  /** 지금까지 낸 전달 신호 수. 점멸을 다시 시작하는 key로도 쓴다. */
  count: number;
  last: Delivery | null;
}

export function useDeliverySignal(): DeliverySignal {
  const [sig, setSig] = useState<DeliverySignal>({ count: 0, last: null });
  useEffect(
    () =>
      lensStore.subscribe(
        (s) => s.deliveries,
        (cur, prev) => {
          const fresh: Delivery[] = [];
          for (const d of Object.values(cur)) {
            if (d.sendStatus === 'dispatched' && prev[d.id]?.sendStatus === 'prepared') fresh.push(d);
          }
          if (fresh.length === 0) return;
          // 같은 순간에 여러 건이 오면 소리·진동은 겹쳐 하나로 들린다. 수는 count에 그대로 쌓는다.
          playDeliveryTone();
          vibrateDelivery();
          setSig((s) => ({ count: s.count + fresh.length, last: fresh[fresh.length - 1]! }));
        },
      ),
    [],
  );
  return sig;
}

/** 마지막 보류 로그. 같은 줄은 한 번만. */
export function useHoldSignal(): { count: number; last: LogEntry | null } {
  const [sig, setSig] = useState<{ count: number; last: LogEntry | null }>({ count: 0, last: null });
  useEffect(
    () =>
      lensStore.subscribe(
        (s) => s.logs,
        (cur, prev) => {
          const seen = new Set(prev.map((l) => l.id));
          const holds = cur.filter((l) => l.kind === 'hold' && !seen.has(l.id));
          if (holds.length > 0) setSig((s) => ({ count: s.count + holds.length, last: holds[holds.length - 1]! }));
        },
      ),
    [],
  );
  return sig;
}

/** key가 바뀐 뒤 ms 동안 true. */
export function useRecent(key: number, ms: number): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (key === 0) return;
    setOn(true);
    const t = window.setTimeout(() => setOn(false), ms);
    return () => window.clearTimeout(t);
  }, [key, ms]);
  return on;
}
