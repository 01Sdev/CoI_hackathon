// 좌표 변환과 시간 창 계산. 경계가 있는 함수라 scripts/check-ui.ts가 확인한다.

import { CAPTURE_FRAME_MIN_SIDE, RECENT_WINDOW_MS } from '../core/constants';
import { clampFrame } from '../core/frame';
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

export interface Point {
  x: number;
  y: number;
}

/** coverBox의 역: 화면 px 점 → 소스 프레임 기준 0~1(범위 밖이면 0~1 밖 값이 그대로 나온다). */
export function coverPointToSource(p: Point, src: Size | null, dst: Size): Point {
  const s = src && src.w > 0 && src.h > 0 ? src : dst;
  const scale = Math.max(dst.w / s.w, dst.h / s.h);
  const ox = (dst.w - s.w * scale) / 2;
  const oy = (dst.h - s.h * scale) / 2;
  return { x: (p.x - ox) / (s.w * scale), y: (p.y - oy) / (s.h * scale) };
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

/**
 * F24a 꼭짓점 끌기: 반대 꼭짓점을 고정하고 한 꼭짓점을 p(소스 0~1)로 옮긴다.
 * 점은 0~1 안으로 자르고, 한 변은 min 이상이라 틀이 뒤집히지 않는다. 마지막에 core clampFrame으로 한 번 더 맞춘다.
 */
export function dragCorner(f: Box, corner: Corner, p: Point, min = CAPTURE_FRAME_MIN_SIDE): Box {
  const px = Math.min(1, Math.max(0, p.x));
  const py = Math.min(1, Math.max(0, p.y));
  let x0 = f.x;
  let y0 = f.y;
  let x1 = f.x + f.w;
  let y1 = f.y + f.h;
  if (corner === 'nw' || corner === 'sw') x0 = Math.min(px, x1 - min);
  else x1 = Math.max(px, x0 + min);
  if (corner === 'nw' || corner === 'ne') y0 = Math.min(py, y1 - min);
  else y1 = Math.max(py, y0 + min);
  return clampFrame({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }) ?? f;
}

/** 꼭짓점의 소스 0~1 위치. */
export function cornerPoint(f: Box, corner: Corner): Point {
  return {
    x: corner === 'nw' || corner === 'sw' ? f.x : f.x + f.w,
    y: corner === 'nw' || corner === 'ne' ? f.y : f.y + f.h,
  };
}
