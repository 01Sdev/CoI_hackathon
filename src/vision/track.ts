// 사람 추적·응시 대상·동의 짝짓기(코디 스캔 응시 동의, docs/designs/outfit-pipelines.md 파이프라인 1·2).
// DOM·모델·스토어 없이 도는 순수 함수라 scripts/check-runtime.ts가 경계를 확인한다.
// 상자 단위는 인자마다 같기만 하면 된다(0단계는 소스 프레임 0~1, 포착은 원본 px). 응시 원만 px로 잰다.

import type { Box } from '../core/types';
import { VISION_CONFIG, type VisionConfig } from './config';
import { area, center, intersect } from './geometry';

export const iou = (a: Box, b: Box): number => {
  const inter = area(intersect(a, b));
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
};

/**
 * a[i]와 b[j]를 IoU가 minIou 이상인 쌍끼리 큰 순으로 하나씩 잇는다.
 * 한쪽 상자가 다른 쪽 둘 이상과 minIou 이상으로 겹치면(사람이 엇갈림) 그 상자는 잇지 않는다. 동의가 다른 사람에게
 * 옮겨 가는 것보다 끊기는 쪽이 안전하다(끊긴 동의는 CONSENT_LOST_MS 뒤 사라진다).
 */
export function matchBoxes(a: readonly Box[], b: readonly Box[], minIou: number): Map<number, number> {
  const pairs: { i: number; j: number; v: number }[] = [];
  const aHits = new Array<number>(a.length).fill(0);
  const bHits = new Array<number>(b.length).fill(0);
  a.forEach((ab, i) =>
    b.forEach((bb, j) => {
      const v = iou(ab, bb);
      if (v < minIou) return;
      pairs.push({ i, j, v });
      aHits[i] = (aHits[i] ?? 0) + 1;
      bHits[j] = (bHits[j] ?? 0) + 1;
    }),
  );
  pairs.sort((p, q) => q.v - p.v);
  const out = new Map<number, number>();
  const usedB = new Set<number>();
  for (const { i, j } of pairs) {
    if ((aHits[i] ?? 0) > 1 || (bHits[j] ?? 0) > 1) continue;
    if (out.has(i) || usedB.has(j)) continue;
    out.set(i, j);
    usedB.add(j);
  }
  return out;
}

export interface Track {
  id: string;
  /** 마지막으로 본 상자. */
  box: Box;
  score: number;
  lastSeenAt: number;
}

/**
 * 이번 틱 사람 상자를 이전 추적에 잇는다. 못 이은 상자는 newId()로 새 추적. trackKeepMs 넘게 안 보인 추적은 버린다.
 * visible은 이번 틱에 본 추적(상자 순서 그대로).
 */
export function stepTracks(
  prev: readonly Track[],
  people: readonly { box: Box; score: number }[],
  now: number,
  newId: () => string,
  cfg: VisionConfig = VISION_CONFIG,
): { tracks: Track[]; visible: Track[] } {
  const match = matchBoxes(
    people.map((p) => p.box),
    prev.map((t) => t.box),
    cfg.trackIouMin,
  );
  const continued = new Set<number>();
  const visible = people.map((p, i) => {
    const j = match.get(i);
    const old = j === undefined ? undefined : prev[j];
    if (j !== undefined) continued.add(j);
    return { id: old ? old.id : newId(), box: p.box, score: p.score, lastSeenAt: now };
  });
  const kept = prev.filter((t, j) => !continued.has(j) && now - t.lastSeenAt <= cfg.trackKeepMs);
  return { tracks: [...visible, ...kept], visible };
}

/**
 * 응시 대상: 상자 중심이 시야 가운데 원(짧은 변 × radius, px) 안이고 흰 틀(F24)과 겹치는 사람 중 가장 가운데.
 * 상자·frame은 0~1, width·height는 그 프레임의 px.
 */
export function pickGazeTarget(visible: readonly Track[], frame: Box, width: number, height: number, radius: number): Track | null {
  const r = Math.min(width, height) * radius;
  let best: Track | null = null;
  let bestDist = Infinity;
  for (const t of visible) {
    if (area(intersect(t.box, frame)) <= 0) continue;
    const c = center(t.box);
    const d = Math.hypot((c.cx - 0.5) * width, (c.cy - 0.5) * height);
    if (d > r || d >= bestDist) continue;
    best = t;
    bestDist = d;
  }
  return best;
}

export interface GazeDwell {
  trackId: string;
  /** 같은 사람을 보기 시작한 시각. */
  since: number;
  /** 마지막으로 응시 조건이 맞은 시각. */
  lastOkAt: number;
  /** 그때의 상자(0~1). */
  box: Box;
}

/**
 * 응시 유지 갱신. 같은 trackId면 since를 이어 가고, 다른 사람이면 새로 센다. 대상이 없어도 graceMs 안이면 이어 본다
 * (검출이 한 틱 빠지는 정도로 3초가 다시 시작되지 않게). 대상이 graceMs 넘게 없으면 null.
 */
export function stepGaze(prev: GazeDwell | null, target: Track | null, now: number, graceMs: number): GazeDwell | null {
  if (target) {
    if (prev && prev.trackId === target.id) return { ...prev, lastOkAt: now, box: target.box };
    return { trackId: target.id, since: now, lastOkAt: now, box: target.box };
  }
  if (prev && now - prev.lastOkAt <= graceMs) return prev;
  return null;
}

/** 응시가 dwellMs 이어졌는가. */
export const gazeHeld = (g: GazeDwell | null, now: number, dwellMs: number): g is GazeDwell => !!g && now - g.since >= dwellMs;

/** 코디 스캔 조각의 주인: 살아 있는 동의 중 상자 중심이 프레임 가운데에 가장 가까운 사람. width·height는 거리를 px로 재는 데만 쓴다. */
export function pickConsent<C extends { box: Box }>(live: readonly C[], width: number, height: number): C | null {
  let best: C | null = null;
  let bestDist = Infinity;
  for (const c of live) {
    const { cx, cy } = center(c.box);
    const d = Math.hypot((cx - 0.5) * width, (cy - 0.5) * height);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}
