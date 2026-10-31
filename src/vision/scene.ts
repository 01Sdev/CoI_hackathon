// 장면 상태기계(03-SRS §4.1). none → 후보(L, t0) → 확정(L). 0단계 틱마다 step을 부른다.

import type { SceneLabel } from '../core/types';

export type SceneState =
  | { kind: 'none' }
  | { kind: 'candidate'; label: Exclude<SceneLabel, 'none'>; since: number }
  | { kind: 'confirmed'; label: Exclude<SceneLabel, 'none'>; since: number };

export const SCENE_NONE: SceneState = { kind: 'none' };

/**
 * 다음 상태와, 이번 틱에 새로 확정됐는지를 돌려준다.
 * - none에서 L ≠ none → 후보(L, now)
 * - 후보(L)에서 같은 L이 confirmMs 이상 이어지면 확정(L)
 * - 후보·확정에서 다른 L′ → L′ ≠ none이면 후보(L′, now), 아니면 none
 * - 확정(L)에서 같은 L → 그대로
 */
export function stepScene(prev: SceneState, label: SceneLabel, now: number, confirmMs: number): { next: SceneState; confirmed: boolean } {
  if (label === 'none') return { next: SCENE_NONE, confirmed: false };
  if (prev.kind === 'none' || prev.label !== label) {
    return { next: { kind: 'candidate', label, since: now }, confirmed: false };
  }
  if (prev.kind === 'candidate' && now - prev.since >= confirmMs) {
    return { next: { kind: 'confirmed', label, since: prev.since }, confirmed: true };
  }
  return { next: prev, confirmed: false };
}
