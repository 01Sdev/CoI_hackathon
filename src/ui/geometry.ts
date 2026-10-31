// 좌표 변환과 시간 창 계산. 경계가 있는 함수라 scripts/check-ui.ts가 확인한다.

import { RECENT_WINDOW_MS } from '../core/constants';
import type { Box, RecentFaceRecord } from '../core/types';

export interface Size {
  w: number;
  h: number;
}

/**
 * 소스 프레임 기준 0~1 박스를 object-fit: cover로 채운 화면의 px 위치로 바꾼다.
 * 미리보기는 좌우 반전하지 않는다(02-SSRD §1). 소스 크기를 모르면 화면 비율과 같다고 본다.
 */
export function coverBox(box: Box, src: Size | null, dst: Size): { left: number; top: number; width: number; height: number } {
  const s = src && src.w > 0 && src.h > 0 ? src : dst;
  const scale = Math.max(dst.w / s.w, dst.h / s.h);
  const ox = (dst.w - s.w * scale) / 2;
  const oy = (dst.h - s.h * scale) / 2;
  return {
    left: ox + box.x * s.w * scale,
    top: oy + box.y * s.h * scale,
    width: box.w * s.w * scale,
    height: box.h * s.h * scale,
  };
}

/**
 * 카운터 바깥 호(--fm-window)의 남은 비율 1 → 0. M이 0으로 돌아가는 시각은 얼굴이 담긴 마지막 기록 + 10초다.
 * M 자체는 selectFaceM이 계산하고, 여기는 그 기록이 언제 빠지는지만 본다.
 */
export function faceWindowRemaining(records: readonly RecentFaceRecord[], now: number): number {
  let last = -Infinity;
  for (const r of records) if (r.detectedFaces > 0 && now - r.at < RECENT_WINDOW_MS && r.at > last) last = r.at;
  if (last === -Infinity) return 0;
  return Math.max(0, Math.min(1, (last + RECENT_WINDOW_MS - now) / RECENT_WINDOW_MS));
}
