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

/**
 * IoU로 못 이은 상자를 중심 거리로 한 번 더 잇는다. 빠르게 움직이거나 0단계가 느리면(휴대폰) 틱 사이 겹침이 IoU 기준 아래로
 * 떨어져 같은 사람이 새 trackId가 되고 응시 3초가 다시 시작됐다. 중심 거리 ≤ gate × 두 상자 중 큰 변, 넓이 비 0.5~2배일 때만,
 * 그리고 양쪽 모두 그런 짝이 하나뿐일 때만 잇는다(사람이 둘 가까이 있으면 잇지 않는다: 동의가 옮겨 가지 않게).
 */
export function matchByCenter(
  a: readonly Box[],
  b: readonly Box[],
  gate: number,
  takenA: ReadonlySet<number>,
  takenB: ReadonlySet<number>,
): Map<number, number> {
  const near = (x: Box, y: Box) => {
    const cx = center(x);
    const cy = center(y);
    const ratio = area(x) / (area(y) || 1);
    return Math.hypot(cx.cx - cy.cx, cx.cy - cy.cy) <= gate * Math.max(x.w, x.h, y.w, y.h) && ratio >= 0.5 && ratio <= 2;
  };
  const out = new Map<number, number>();
  a.forEach((ab, i) => {
    if (takenA.has(i)) return;
    const cands = b.map((bb, j) => (near(ab, bb) ? j : -1)).filter((j) => j >= 0);
    const j = cands[0];
    if (cands.length !== 1 || j === undefined || takenB.has(j)) return;
    const back = a.filter((x) => near(x, b[j] as Box)).length;
    if (back === 1) out.set(i, j);
  });
  return out;
}

/** 0단계 검출 중 추적·응시·동의에 넣을 사람(trackScoreMin 이상). 박스는 프레임 0~1로 바꾼다. */
export function trackablePeople(
  found: readonly { label: string; score: number; box: Box }[],
  width: number,
  height: number,
  cfg: VisionConfig = VISION_CONFIG,
): { box: Box; score: number }[] {
  return found
    .filter((f) => f.label === 'person' && f.score >= cfg.trackScoreMin)
    .map((f) => ({ box: { x: f.box.x / width, y: f.box.y / height, w: f.box.w / width, h: f.box.h / height }, score: f.score }));
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
  const boxes = people.map((p) => p.box);
  const prevBoxes = prev.map((t) => t.box);
  const match = matchBoxes(boxes, prevBoxes, cfg.trackIouMin);
  const byCenter = matchByCenter(boxes, prevBoxes, cfg.trackCenterGate, new Set(match.keys()), new Set(match.values()));
  for (const [i, j] of byCenter) match.set(i, j);
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
 * keep이 있으면(이미 보고 있는 사람) 그 사람이 keep.radius 원 안이고 흰 틀과 겹치는 동안은 그대로 둔다. 단 다른 사람이
 * radius 원 안에 있으면 그 사람으로 바뀐다(착용자가 다른 사람을 보고 있다). 상자·frame은 0~1, width·height는 그 프레임의 px.
 */
export function pickGazeTarget(
  visible: readonly Track[],
  frame: Box,
  width: number,
  height: number,
  radius: number,
  keep?: { trackId: string; radius: number },
): Track | null {
  const short = Math.min(width, height);
  const dist = (t: Track) => {
    const c = center(t.box);
    return Math.hypot((c.cx - 0.5) * width, (c.cy - 0.5) * height);
  };
  let best: Track | null = null;
  let bestDist = Infinity;
  for (const t of visible) {
    if (area(intersect(t.box, frame)) <= 0) continue;
    const d = dist(t);
    if (d > short * radius || d >= bestDist) continue;
    best = t;
    bestDist = d;
  }
  if (keep && (!best || best.id === keep.trackId)) {
    const cur = visible.find((t) => t.id === keep.trackId);
    if (cur && area(intersect(cur.box, frame)) > 0 && dist(cur) <= short * keep.radius) return cur;
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
