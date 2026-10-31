// 응시 동의(docs/designs/outfit-pipelines.md 파이프라인 1). 0단계 틱마다 사람 상자를 이어 trackId를 달고,
// 응시 대상이 GAZE_DWELL_MS 이어지면 setGazeCandidate, 동의한 사람이 보이면 touchConsent를 쓴다.
// 동의를 주고(grantConsent) 지우는(tick·revokeConsent) 것은 스토어와 C가 한다.

import { GAZE_CENTER_RADIUS, GAZE_DWELL_MS } from '../core/constants';
import { lensStore } from '../core/store';
import type { Box } from '../core/types';
import { VISION_CONFIG } from './config';
import { gazeHeld, pickGazeTarget, stepGaze, stepTracks, type GazeDwell, type Track } from './track';

let tracks: Track[] = [];
let dwell: GazeDwell | null = null;
/** 페이지가 살아 있는 동안 되돌리지 않는다. 옛 동의의 trackId가 새로 나타난 다른 사람에게 붙지 않게. */
let seq = 0;
const newId = () => `p${++seq}`;

/** 지금 추적 중인 사람(개발 페이지용). */
export function getTracks(): readonly Track[] {
  return tracks;
}

/**
 * 0단계 틱 하나. people은 이번 틱 사람 상자(소스 프레임 0~1), width·height는 0단계 프레임 px(응시 원을 원으로 재려고).
 * 이미 동의한 사람을 보고 있으면 응시 칩을 다시 띄우지 않는다.
 */
export function observePeople(people: readonly { box: Box; score: number }[], width: number, height: number, now: number): void {
  const s = lensStore.getState();
  const step = stepTracks(tracks, people, now, newId);
  tracks = step.tracks;
  for (const t of step.visible) if (s.consents[t.id]) s.touchConsent(t.id, t.box);

  const keep = dwell ? { trackId: dwell.trackId, radius: VISION_CONFIG.gazeKeepRadius } : undefined;
  const target = pickGazeTarget(step.visible, s.session.captureFrame, width, height, GAZE_CENTER_RADIUS, keep);
  dwell = stepGaze(dwell, target && !s.consents[target.id] ? target : null, now, VISION_CONFIG.gazeGraceMs);
  if (gazeHeld(dwell, now, GAZE_DWELL_MS)) s.setGazeCandidate({ trackId: dwell.trackId, box: dwell.box, since: dwell.since });
  else if (s.gaze) s.setGazeCandidate(null);
}

/** 입력 전환·새 세션·0단계 정지. 추적을 버리고 응시 후보를 내린다(동의는 스토어가 만료시킨다). */
export function resetPeople(): void {
  tracks = [];
  dwell = null;
  const s = lensStore.getState();
  if (s.gaze) s.setGazeCandidate(null);
}
