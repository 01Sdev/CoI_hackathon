// 시안의 부모 영역 기준 0~1 좌표. 원본 이미지 좌표 변환·검출은 호출 측이 맡는다.
import type { Box } from '../core/types';

export interface SelectionPoint { x: number; y: number }
export type SelectionHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export interface SelectionLimits {
  left: number; top: number; right: number; bottom: number; minWidth: number; minHeight: number;
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const finite = (v: number, fallback: number) => Number.isFinite(v) ? v : fallback;

/** 시안과 같은 12px 여백, 최소 260×160px. 작은 부모에서는 들어갈 수 있는 크기까지 줄인다. */
export function selectionLimits(width: number, height: number): SelectionLimits {
  const w = Math.max(1, finite(width, 1)), h = Math.max(1, finite(height, 1));
  const mx = Math.min(12 / w, .25), my = Math.min(12 / h, .25);
  return { left: mx, top: my, right: 1 - mx, bottom: 1 - my, minWidth: Math.min(260 / w, 1 - 2 * mx), minHeight: Math.min(160 / h, 1 - 2 * my) };
}

/** 부모 범위와 최소 크기를 지킨다. 숫자가 아닌 값 때문에 스타일이 NaN이 되지 않게 한다. */
export function fitSelection(value: Box, limit: SelectionLimits): Box {
  const w = clamp(finite(value.w, limit.minWidth), limit.minWidth, limit.right - limit.left);
  const h = clamp(finite(value.h, limit.minHeight), limit.minHeight, limit.bottom - limit.top);
  return { x: clamp(finite(value.x, limit.left), limit.left, limit.right - w), y: clamp(finite(value.y, limit.top), limit.top, limit.bottom - h), w, h };
}

export function moveSelection(value: Box, dx: number, dy: number, limit: SelectionLimits): Box {
  const f = fitSelection(value, limit);
  return { ...f, x: clamp(f.x + finite(dx, 0), limit.left, limit.right - f.w), y: clamp(f.y + finite(dy, 0), limit.top, limit.bottom - f.h) };
}

export function selectionHandlePoint(value: Box, handle: SelectionHandle): SelectionPoint {
  return { x: value.x + (handle.includes('w') ? 0 : handle.includes('e') ? value.w : value.w / 2), y: value.y + (handle.includes('n') ? 0 : handle.includes('s') ? value.h : value.h / 2) };
}

/** 반대쪽 변을 고정한다. 중간점은 그 축만 바뀐다. */
export function resizeSelection(value: Box, handle: SelectionHandle, point: SelectionPoint, limit: SelectionLimits): Box {
  const f = fitSelection(value, limit);
  let left = f.x, right = f.x + f.w, top = f.y, bottom = f.y + f.h;
  if (handle.includes('w')) left = clamp(finite(point.x, left), limit.left, right - limit.minWidth);
  if (handle.includes('e')) right = clamp(finite(point.x, right), left + limit.minWidth, limit.right);
  if (handle.includes('n')) top = clamp(finite(point.y, top), limit.top, bottom - limit.minHeight);
  if (handle.includes('s')) bottom = clamp(finite(point.y, bottom), top + limit.minHeight, limit.bottom);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** 사람당 하나의 대표점이 프레임 안(경계 포함)에 있으면 1명. null은 미확인, []는 확인된 0명. */
export function countSelectionPeople(value: Box, people: readonly SelectionPoint[] | null): number | null {
  if (people === null || ![value.x, value.y, value.w, value.h].every(Number.isFinite) || value.w <= 0 || value.h <= 0) return null;
  const eps = 1e-9;
  return people.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 && p.x >= value.x - eps && p.x <= value.x + value.w + eps && p.y >= value.y - eps && p.y <= value.y + value.h + eps).length;
}
