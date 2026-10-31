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

/** 흰 틀 오른쪽 위 사람 수(#44 .fm-selection__count): 틀 안쪽 8px, 줄 높이 24px. 폭은 두 자리 숫자까지 넉넉히 잡는다. */
const COUNT_INSET = 8;
const COUNT_H = 24;
const COUNT_W = 48;
/** 코디 답 패널(outfit-talk.css)과 같은 값. 아래쪽은 말 막대(24 + 56)와 여백을 비운다. */
const PANEL_GUTTER = 16;
const PANEL_BOTTOM_RESERVE = 104;
/** 이보다 좁으면 숫자 위에 두지 않고 숫자 아래로 내린다. 머리줄 + 말풍선 한두 개가 보이는 높이. */
export const PANEL_MIN_H = 120;

/** 코디 답 패널 폭. outfit-talk.css의 inline-size와 같은 식이다(480px 이하는 좁게). */
export function talkPanelWidth(dst: Size): number {
  return dst.w <= 480 ? Math.min(260, dst.w * 0.68) : Math.min(320, dst.w - 2 * PANEL_GUTTER);
}

/**
 * 코디 답 패널의 위치(시야 오른쪽 가장자리). 패널이 흰 틀의 사람 수와 가로로 겹치면 숫자를 덮지 않게
 * 숫자 위 공간이 PANEL_MIN_H 이상일 때는 그 높이로 줄이고, 아니면 숫자 바로 아래로 내린다. frame은 화면 px.
 */
export function talkPanelPlacement(frame: { top: number; right: number }, dst: Size, top = PANEL_GUTTER): { top: number; maxHeight: number } {
  const width = talkPanelWidth(dst);
  const cap = Math.min(520, dst.h * (dst.w <= 480 ? 0.44 : 0.5));
  const left = dst.w - PANEL_GUTTER - width;
  const countRight = frame.right - COUNT_INSET;
  const countTop = frame.top + COUNT_INSET;
  const overlapsX = left < countRight && dst.w - PANEL_GUTTER > countRight - COUNT_W;
  const overlapsY = countTop + COUNT_H > top;
  if (!overlapsX || !overlapsY) return { top, maxHeight: cap };
  const above = countTop - COUNT_INSET - top;
  if (above >= PANEL_MIN_H) return { top, maxHeight: Math.min(cap, above) };
  const below = countTop + COUNT_H + COUNT_INSET;
  return { top: below, maxHeight: Math.max(PANEL_MIN_H, Math.min(cap, dst.h - below - PANEL_BOTTOM_RESERVE)) };
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
