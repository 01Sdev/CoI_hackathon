// 판정 엔진이 어떤 화면을 띄울 상태인지. engine.status가 ready가 아니어도 liveObservation이 들어오면 판정 중으로 본다
// (A가 setEngine을 아직 안 불러도 HUD가 뜨게).

import { useEffect, useState } from 'react';
import { useLensStore } from '../core/store';
import { selectPluginTotals } from '../core/selectors';
import type { EngineState } from '../core/types';

export type EngineView = EngineState['status'];

export function useEngineView(): EngineView {
  return useLensStore((s) => {
    if (s.engine.status === 'failed') return 'failed';
    if (s.engine.status === 'ready' || s.liveObservation !== null) return 'ready';
    return s.engine.status;
  });
}

/** 이 세션에서 모든 플러그인에 실제로 보낸(dispatched) 전달 수. Counter 누적값이라 로그가 밀려나도 줄지 않는다. */
export function useTotalDeliveries(): number {
  return useLensStore((s) => s.pluginOrder.reduce((n, id) => n + selectPluginTotals(s, id).deliveries, 0));
}

/** 마운트한 뒤 지난 초. */
export function useElapsedSeconds(): number {
  const [start] = useState(() => performance.now());
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setSec(Math.floor((performance.now() - start) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [start]);
  return sec;
}
