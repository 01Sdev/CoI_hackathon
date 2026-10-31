// 좌표 변환과 시간 창 계산. 경계가 있는 함수라 scripts/check-ui.ts가 확인한다.

import { RECENT_WINDOW_MS } from '../core/constants';
import { dragCorner, type FrameCorner } from '../core/frame';
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

/** 박스 중심을 화면 비율(0~1)로. 칼로리 화면 연결선의 시작점이다. 박스가 없으면 NaN이라 선을 그리지 않는다. */
export function boxCenter(box: Box | null, src: Size | null, dst: Size): { x: number; y: number } {
  if (!box || dst.w === 0 || dst.h === 0) return { x: NaN, y: NaN };
  const r = coverBox(box, src, dst);
  return { x: (r.left + r.width / 2) / dst.w, y: (r.top + r.height / 2) / dst.h };
}

/**
 * 소스 0~1 박스 → 화면(부모) 0~1 박스. 흰 틀(SelectionFrame)은 부모 기준 값을 쓰고, 스토어의 captureFrame은 소스 기준이다.
 * 화면 크기가 0이면 박스를 그대로 돌려준다.
 */
export function sourceToView(box: Box, src: Size | null, dst: Size): Box {
  if (dst.w <= 0 || dst.h <= 0) return { ...box };
  const r = coverBox(box, src, dst);
  return { x: r.left / dst.w, y: r.top / dst.h, w: r.width / dst.w, h: r.height / dst.h };
}

/** sourceToView의 역: 화면 0~1 박스 → 소스 0~1 박스(clampFrame은 스토어가 한다). */
export function viewToSource(box: Box, src: Size | null, dst: Size): Box {
  if (dst.w <= 0 || dst.h <= 0) return { ...box };
  const a = coverPointToSource({ x: box.x * dst.w, y: box.y * dst.h }, src, dst);
  const b = coverPointToSource({ x: (box.x + box.w) * dst.w, y: (box.y + box.h) * dst.h }, src, dst);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

/** 두 박스가 사실상 같은지(좌표 왕복 오차는 무시). 흰 틀이 같은 값을 스토어에 다시 쓰지 않게 한다. */
export function sameBox(a: Box, b: Box, eps = 1e-6): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.w - b.w) < eps && Math.abs(a.h - b.h) < eps;
}

/**
 * 응시 칩(GazeChip)을 둘 화면 px 점: 사람 상자 위쪽 가운데. 칩은 이 점 위로 올라간다(translate -50% -100%).
 * 가로는 화면 가장자리에서 edge만큼, 세로는 위쪽 top px 아래·아래쪽 edge 위로 붙잡는다. 상자는 그리지 않는다.
 */
export function gazeChipPoint(box: Box, src: Size | null, dst: Size, edge = 72, top = 56): Point {
  const r = coverBox(box, src, dst);
  const clamp = (v: number, lo: number, hi: number) => (hi < lo ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
  return { x: clamp(r.left + r.width / 2, edge, dst.w - edge), y: clamp(r.top - 8, top, dst.h - edge) };
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

/**
 * 화면 px 점으로 꼭짓점을 끈다(F24a). 화면 → 소스 0~1은 coverPointToSource, 끌기 규칙(맞은편 고정·0~1 안·최소 0.1)은
 * core dragCorner가 정한다. 결과는 setCaptureFrame에 그대로 넘긴다.
 */
export function dragCornerFromScreen(f: Box, corner: FrameCorner, p: Point, src: Size | null, dst: Size): Box {
  const s = coverPointToSource(p, src, dst);
  return dragCorner(f, corner, s.x, s.y);
}

/** 꼭짓점의 소스 0~1 위치. */
export function cornerPoint(f: Box, corner: FrameCorner): Point {
  return {
    x: corner === 'tl' || corner === 'bl' ? f.x : f.x + f.w,
    y: corner === 'tl' || corner === 'tr' ? f.y : f.y + f.h,
  };
}

/** 화살표 키 한 번: 꼭짓점을 소스 0~1에서 (dx, dy)만큼 옮긴다. 규칙은 dragCorner와 같다. */
export function nudgeCorner(f: Box, corner: FrameCorner, dx: number, dy: number): Box {
  const p = cornerPoint(f, corner);
  return dragCorner(f, corner, p.x + dx, p.y + dy);
}
