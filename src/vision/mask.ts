// 픽셀화(FR-015·016). ctx.filter를 쓰지 않고 grid×grid로 줄였다 키운다(C-1, Safari 호환).
// 대상 캔버스 위에 바로 덮어쓰므로 가리기 전 픽셀은 남지 않는다.

import type { Box } from '../core/types';
import { blendMasked } from './shape';

export function pixelate(ctx: CanvasRenderingContext2D, r: Box, grid: number): void {
  if (r.w < 1 || r.h < 1) return;
  const small = document.createElement('canvas');
  small.width = grid;
  small.height = grid;
  const sctx = small.getContext('2d');
  if (!sctx) throw new Error('픽셀화 캔버스를 만들 수 없음');
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(ctx.canvas, r.x, r.y, r.w, r.h, 0, 0, grid, grid);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, grid, grid, r.x, r.y, r.w, r.h);
  ctx.restore();
  small.width = 0;
  small.height = 0;
}

/**
 * 모양 가림(FR-016a ②③): 사각형을 grid×grid로 픽셀화한 결과를 shape가 1인 픽셀에만 덮는다.
 * shape는 r.w × r.h(r은 정수 px). 픽셀화 사본은 바로 비운다.
 */
export function pixelateShaped(ctx: CanvasRenderingContext2D, r: Box, grid: number, shape: Uint8Array): void {
  if (r.w < 1 || r.h < 1) return;
  const tmp = canvasOf(r.w, r.h);
  try {
    tmp.ctx.drawImage(ctx.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    pixelate(tmp.ctx, { x: 0, y: 0, w: r.w, h: r.h }, grid);
    const pix = tmp.ctx.getImageData(0, 0, r.w, r.h);
    const orig = ctx.getImageData(r.x, r.y, r.w, r.h);
    blendMasked(orig.data, pix.data, shape);
    ctx.putImageData(orig, r.x, r.y);
  } finally {
    release(tmp.canvas);
  }
}

/** 캔버스 픽셀 버퍼를 놓는다. */
export function release(c: HTMLCanvasElement | null | undefined): void {
  if (!c) return;
  c.width = 0;
  c.height = 0;
}

export function canvasOf(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D 캔버스를 만들 수 없음');
  return { canvas, ctx };
}

export function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG 인코딩 실패'))), 'image/jpeg', quality);
  });
}
