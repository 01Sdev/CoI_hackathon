// F24 전송 범위 프레임의 좌표 함수. 근거: docs/specs/02-SSRD.md "전송 범위 프레임".
// A(포착 박스 자르기)와 C(꼭짓점 끌기)·스토어(setCaptureFrame, prepareDelivery)가 같은 함수를 쓴다.
// 원칙: 프레임은 픽셀을 막는 경계라서, 맞출 때 넓히는 쪽이 아니라 잘라 내는 쪽으로 맞춘다.

import { CAPTURE_FRAME_MIN_SIDE } from './constants';
import type { Box } from './types';

/** 끌기로 만든 한 변(= 최소값을 뺄셈으로 구한 값)이 부동소수 오차로 최소값보다 조금 작아도 받기 위한 여유. */
const EPS = 1e-9;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finite = (b: Box) => [b.x, b.y, b.w, b.h].every(Number.isFinite);

/**
 * 0~1 밖으로 나간 부분을 잘라 낸다. 프레임을 안쪽으로 밀어 넣지 않는다(밀면 사용자가 뺀 픽셀이 들어온다).
 * 잘라 낸 뒤 한 변이 CAPTURE_FRAME_MIN_SIDE보다 작거나, 유한한 숫자가 아니면 null.
 */
export function clampFrame(f: Box): Box | null {
  if (!finite(f)) return null;
  const x0 = Math.max(0, f.x);
  const y0 = Math.max(0, f.y);
  const x1 = Math.min(1, f.x + f.w);
  const y1 = Math.min(1, f.y + f.h);
  if (x1 - x0 < CAPTURE_FRAME_MIN_SIDE - EPS || y1 - y0 < CAPTURE_FRAME_MIN_SIDE - EPS) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export type FrameCorner = 'tl' | 'tr' | 'bl' | 'br';

/**
 * 꼭짓점 끌기(F24a). 맞은편 꼭짓점은 그대로 두고, 끄는 꼭짓점을 0~1 안에서, 맞은편에서 최소값만큼 떨어진 곳에서 멈춘다.
 * px·py는 소스 프레임 기준 0~1. 숫자가 아니면 그 축은 지금 위치를 유지한다. f는 clampFrame을 통과한 프레임이어야 한다.
 */
export function dragCorner(f: Box, corner: FrameCorner, px: number, py: number): Box {
  const left = corner === 'tl' || corner === 'bl';
  const top = corner === 'tl' || corner === 'tr';
  const fixedX = left ? f.x + f.w : f.x;
  const fixedY = top ? f.y + f.h : f.y;
  const curX = left ? f.x : f.x + f.w;
  const curY = top ? f.y : f.y + f.h;
  const wantX = Number.isFinite(px) ? px : curX;
  const wantY = Number.isFinite(py) ? py : curY;
  const x = left ? clamp(wantX, 0, fixedX - CAPTURE_FRAME_MIN_SIDE) : clamp(wantX, fixedX + CAPTURE_FRAME_MIN_SIDE, 1);
  const y = top ? clamp(wantY, 0, fixedY - CAPTURE_FRAME_MIN_SIDE) : clamp(wantY, fixedY + CAPTURE_FRAME_MIN_SIDE, 1);
  return { x: Math.min(x, fixedX), y: Math.min(y, fixedY), w: Math.abs(fixedX - x), h: Math.abs(fixedY - y) };
}

/** 0~1 프레임을 원본 px로. 네 변을 각각 반올림해 정수 px로 만든다. */
export function frameToPx(f: Box, width: number, height: number): Box {
  const x0 = Math.round(f.x * width);
  const y0 = Math.round(f.y * height);
  const x1 = Math.round((f.x + f.w) * width);
  const y1 = Math.round((f.y + f.h) * height);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** 같은 단위의 두 박스의 교집합. 넓이가 0이거나 숫자가 아니면 null. */
export function intersectBox(a: Box, b: Box): Box | null {
  if (!finite(a) || !finite(b)) return null;
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * A의 1단계: 넓힌 대상 박스(원본 px, 소수 가능)를 frameRect(frameToPx 결과)로 자르고 안쪽 정수 px로 맞춘다.
 * 결과는 늘 frameRect 안이다. 한 변이 1px 미만이면 null("프레임 밖").
 */
export function cropToFramePx(box: Box, frameRect: Box): Box | null {
  const r = intersectBox(box, frameRect);
  if (!r) return null;
  const x0 = Math.ceil(r.x);
  const y0 = Math.ceil(r.y);
  const x1 = Math.floor(r.x + r.w);
  const y1 = Math.floor(r.y + r.h);
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** inner가 outer 안에 있는지(경계 포함). */
export function containsBox(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}
