// 파생값. Counter 계산은 ERD §4. C는 다시 계산하지 않고 이 함수만 쓴다.
// 시간 인자 now는 performance.now() 기준이다(Date.now()를 넘기면 기록이 모두 지난 것으로 보인다).
// 기간 판정은 tick에 기대지 않고 여기서 직접 한다. tick은 메모리 정리와 화면 갱신용이다.

import { RECENT_WINDOW_MS, THROUGHPUT_WINDOW_MS } from './constants';
import type { LensState } from './store';
import type { RuntimePolicy } from './types';

type CounterView = Pick<LensState, 'counter'>;

const perfNow = () => performance.now();

/** 지금 보낼 수 있는가. A의 포착 게이트와 B의 sendDelivery가 같은 판단을 쓴다. 일시 정지는 게이트와 따로 본다. */
export function selectCanSend(s: Pick<LensState, 'plugins' | 'session'>, pluginId: string): boolean {
  const p = s.plugins[pluginId];
  return !!p && p.status === 'ready' && p.gateOpen && !s.session.paused;
}

export interface DesiredRuntime {
  enabled: boolean;
  manifestVersion: number;
  connect: RuntimePolicy['connect'];
  sessionId: string;
}

/**
 * B가 플러그인마다 이것 하나만 구독한다(equalityFn: shallow, fireImmediately: true).
 * 값이 바뀌면 전환 공통 절차를 돌고, 새 iframe을 만든 정책이 지금 값과 같을 때만 게이트를 연다.
 */
export function selectDesiredRuntime(s: Pick<LensState, 'plugins' | 'session'>, pluginId: string): DesiredRuntime | null {
  const p = s.plugins[pluginId];
  if (!p) return null;
  return {
    enabled: p.enabled,
    manifestVersion: p.manifest.version,
    connect: s.session.compareMode && p.kind === 'calorie' ? 'none' : 'network',
    sessionId: s.session.id,
  };
}

/** HUD M: 최근 10초 dispatched 전달의 detectedFaces 최댓값. 없으면 0. */
export function selectFaceM(s: CounterView, now: number = perfNow()): number {
  let m = 0;
  for (const r of s.counter.recent10s) if (now - r.at < RECENT_WINDOW_MS && r.detectedFaces > m) m = r.detectedFaces;
  return m;
}

/** 바깥 표시 N개(IF-07 apps): 최근 10초 얼굴이 담긴 전달을 받은 플러그인 수. */
export function selectOutwardApps(s: CounterView, now: number = perfNow()): number {
  const ids = new Set<string>();
  for (const r of s.counter.recent10s) if (now - r.at < RECENT_WINDOW_MS && r.detectedFaces > 0) ids.add(r.pluginId);
  return ids.size;
}

/** 세션 누적 "얼굴이 담긴 전달 N건"과 확인 화면 "N장". */
export function selectPluginTotals(s: CounterView, pluginId: string): { deliveries: number; faceDeliveries: number } {
  return s.counter.perPlugin[pluginId] ?? { deliveries: 0, faceDeliveries: 0 };
}

/** F12 "외 k장": 누적 전달 수 − 스토어에 남은 dispatched Delivery 수(로그가 밀려나 썸네일이 해제된 것). */
export function selectEvictedCount(s: Pick<LensState, 'counter' | 'deliveries'>, pluginId: string): number {
  let kept = 0;
  for (const d of Object.values(s.deliveries)) if (d.pluginId === pluginId && d.sendStatus === 'dispatched') kept += 1;
  return Math.max(0, selectPluginTotals(s, pluginId).deliveries - kept);
}

export interface ThroughputView {
  stage0Runs: number;
  faceDetectRuns: number;
  sourceFrames: number;
  deliveries: number;
  holds: number;
  /** (stage0Runs + faceDetectRuns) / (2 × sourceFrames). sourceFrames가 0이면 null. */
  ratio: number | null;
}

/** 처리량(F16): 직전 60초 합. 객체를 돌려주므로 React에서는 useShallow로 감싼다. */
export function selectThroughput(s: CounterView, now: number = perfNow()): ThroughputView {
  const t = { stage0Runs: 0, faceDetectRuns: 0, sourceFrames: 0, deliveries: 0, holds: 0 };
  for (const r of s.counter.window60s) {
    if (now - r.at >= THROUGHPUT_WINDOW_MS) continue;
    t.stage0Runs += r.stage0Runs;
    t.faceDetectRuns += r.faceDetectRuns;
    t.sourceFrames += r.sourceFrames;
    t.deliveries += r.deliveries;
    t.holds += r.holds;
  }
  const ratio = t.sourceFrames > 0 ? (t.stage0Runs + t.faceDetectRuns) / (2 * t.sourceFrames) : null;
  return { ...t, ratio };
}
