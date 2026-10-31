// Selfie Multiclass 마스크로 가림 모양을 정한다(F23, 03-SRS FR-016a). DOM·모델 없이 도는 순수 함수다.
// 어디를 볼지는 BlazeFace·사람 검출이 정한 사각형(얼굴 박스 +15%, 머리 영역)이고, 이 함수는 그 안에서 가릴 픽셀만 고른다.

import type { Box } from '../core/types';

/**
 * 사각형 rect(조각 px, 정수) 안에서 가릴 픽셀 마스크(rect.w × rect.h, 1 = 가림)를 만든다.
 * - categories: Selfie categoryMask(mw × mh). 조각(cropW × cropH)에 최근접으로 늘려 읽는다.
 * - classes에 든 픽셀을 radius만큼 팽창한다. 사각형 밖 픽셀도 팽창의 출발점이 되지만 결과는 사각형 안만이다.
 * - 사각형 안에 classes 픽셀이 하나도 없으면 null(호출자는 사각형 전체를 가린다).
 */
export function shapeMask(
  categories: Uint8Array,
  mw: number,
  mh: number,
  cropW: number,
  cropH: number,
  rect: Box,
  radius: number,
  classes: readonly number[],
): Uint8Array | null {
  if (categories.length !== mw * mh || mw < 1 || mh < 1 || rect.w < 1 || rect.h < 1) return null;
  const want = new Uint8Array(256);
  for (const c of classes) want[c] = 1;
  const at = (x: number, y: number) => want[categories[Math.floor((y * mh) / cropH) * mw + Math.floor((x * mw) / cropW)] as number] as number;

  // 팽창을 위해 사각형을 radius만큼 넓힌 범위에서 읽는다.
  const x0 = Math.max(0, rect.x - radius);
  const y0 = Math.max(0, rect.y - radius);
  const x1 = Math.min(cropW, rect.x + rect.w + radius);
  const y1 = Math.min(cropH, rect.y + rect.h + radius);
  const w = x1 - x0;
  const h = y1 - y0;
  const src = new Uint8Array(w * h);
  let inside = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = at(x, y);
      src[(y - y0) * w + (x - x0)] = v;
      if (v && x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h) inside += 1;
    }
  }
  if (inside === 0) return null;

  const grown = dilate(src, w, h, radius);
  const out = new Uint8Array(rect.w * rect.h);
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) out[y * rect.w + x] = grown[(y + rect.y - y0) * w + (x + rect.x - x0)] as number;
  }
  return out;
}

/** 정사각형 팽창(반지름 radius). 적분 영상으로 픽셀당 O(1). */
export function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return mask.slice();
  const stride = width + 1;
  const integral = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += mask[y * width + x] ? 1 : 0;
      integral[(y + 1) * stride + x + 1] = (integral[y * stride + x + 1] as number) + row;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    const ya = Math.max(0, y - radius);
    const yb = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const xa = Math.max(0, x - radius);
      const xb = Math.min(width, x + radius + 1);
      const sum =
        (integral[yb * stride + xb] as number) -
        (integral[ya * stride + xb] as number) -
        (integral[yb * stride + xa] as number) +
        (integral[ya * stride + xa] as number);
      out[y * width + x] = sum > 0 ? 1 : 0;
    }
  }
  return out;
}

/** 팽창 반지름: 조각 긴 변 × ratio, 최소 minPx(FR-016a). */
export function dilateRadius(cropW: number, cropH: number, ratio: number, minPx: number): number {
  return Math.max(minPx, Math.round(Math.max(cropW, cropH) * ratio));
}

/** mask가 1인 픽셀만 src(RGBA)에서 dst(RGBA)로 옮긴다. 셋 다 같은 사각형 크기. */
export function blendMasked(dst: Uint8ClampedArray, src: Uint8ClampedArray, mask: Uint8Array): void {
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const p = i * 4;
    dst[p] = src[p] as number;
    dst[p + 1] = src[p + 1] as number;
    dst[p + 2] = src[p + 2] as number;
    dst[p + 3] = src[p + 3] as number;
  }
}
