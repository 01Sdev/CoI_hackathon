// F24 전송 범위 프레임의 좌표 함수. 근거: docs/specs/02-SSRD.md "전송 범위 프레임".
// A(포착 박스 자르기)와 C(꼭짓점 끌기)·스토어(setCaptureFrame)가 같은 함수를 쓴다.

import { CAPTURE_FRAME_MIN_SIDE } from './constants';
import type { Box } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 0~1 프레임을 범위 안으로 맞춘다. 한 변은 CAPTURE_FRAME_MIN_SIDE~1, 위치는 프레임이 0~1 안에 들도록. 유한한 숫자가 아니면 null. */
export function clampFrame(f: Box): Box | null {
  if (![f.x, f.y, f.w, f.h].every(Number.isFinite)) return null;
  const w = clamp(f.w, CAPTURE_FRAME_MIN_SIDE, 1);
  const h = clamp(f.h, CAPTURE_FRAME_MIN_SIDE, 1);
  return { x: clamp(f.x, 0, 1 - w), y: clamp(f.y, 0, 1 - h), w, h };
}

/** 0~1 프레임을 원본 px로. 네 변을 각각 반올림해 이웃한 박스와 틈 없이 맞물리게 한다. */
export function frameToPx(f: Box, width: number, height: number): Box {
  const x0 = Math.round(f.x * width);
  const y0 = Math.round(f.y * height);
  const x1 = Math.round((f.x + f.w) * width);
  const y1 = Math.round((f.y + f.h) * height);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** 같은 단위의 두 박스의 교집합. 넓이가 0이면 null(F24 "프레임 밖"). */
export function intersectBox(a: Box, b: Box): Box | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
