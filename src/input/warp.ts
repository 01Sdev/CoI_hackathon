// 광각(양옆 휘어짐) 재투영 수식. 출력 위치 → 원본 위치 역매핑. DOM 없이 도는 순수 함수라 scripts/check-runtime.ts가 확인한다.
// 출처: Codex 에이전트(donggyun/x20-codex-23)가 넘긴 pov-warp-lab.html(sha256 1d39d488…92bf)의 fragment shader(97~117행),
// renderCPU(156행~), render()의 경계 계산(196~205행). 수식은 바꾸지 않고 옮겼다. 설계: docs/designs/input-wide-warp.md.
// 원통형 역투영의 가로 tan 항과 세로 cos 항을 쓰는 2D 재투영이다. 실제 화각(°)이나 초광각 렌즈가 아니고, 없는 픽셀을 만들지 않는다.

export interface WarpSettings {
  /** 양옆 휘어짐 조절값. 화각이 아니다. 0(0.0001 이하)이면 휘지 않는다. */
  periphery: number;
  /** 추가 방사형 왜곡 k(0 이상). */
  strength: number;
  /** 프레이밍 확대(1 이상). 1이면 입력을 최대한 쓴다. */
  framing: number;
  /** 시선 중심(-1~1). 확대해 남는 영역 안에서만 움직인다. */
  lookX: number;
  lookY: number;
  /** cover = 여백 없이 채우기(가장자리 잘림), contain = 원본 전체 보존(검은 여백). */
  fit: 'cover' | 'contain';
}

export interface WarpParams {
  /** 원본·출력 가로/세로 비. */
  As: number;
  Ao: number;
  k: number;
  /** 확대(경계 계산 결과 × framing). */
  z: number;
  /** 원본 좌표 이동(아래가 +). */
  ox: number;
  oy: number;
  periphery: number;
}

const on = (periphery: number) => periphery > 0.0001;

/** render()의 cover/contain·cornerScale·zoom·pan 경계(196~205행). cover면 출력 어디서도 원본 밖을 읽지 않는다. */
export function warpParams(As: number, Ao: number, s: WarpSettings): WarpParams {
  const k = s.strength;
  const D = 1 + Ao * Ao;
  const centerY = on(s.periphery) ? s.periphery / Math.tan(s.periphery) : 1;
  const edgeY = on(s.periphery) ? s.periphery / Math.sin(s.periphery) : 1;
  // 원통 좌표와 k ≥ 0 방사형 배율은 모두 모서리에서 가장 크다.
  const cornerScale = 1 + (k * (Ao * Ao + edgeY * edgeY)) / D;
  const base =
    s.fit === 'cover'
      ? Math.max(Ao / As, edgeY) * cornerScale
      : Math.min((Ao / As) * (1 + (k * Ao * Ao) / D), centerY * (1 + (k * centerY * centerY) / D));
  const z = base * s.framing;
  const ox = s.lookX * Math.max(0, 1 - (Ao * cornerScale) / (As * z));
  const oy = s.lookY * Math.max(0, 1 - (edgeY * cornerScale) / z);
  return { As, Ao, k, z, ox, oy, periphery: s.periphery };
}

/** 출력 위치(0~1, 위가 0) → 원본 위치(0~1, 위가 0). 원본 밖이면 null(검은 픽셀). renderCPU 168~176행. */
export function sourceUv(x01: number, y01: number, p: WarpParams): { u: number; v: number } | null {
  let px = (2 * x01 - 1) * p.Ao;
  let py = 2 * y01 - 1;
  if (on(p.periphery)) {
    const angle = (px / p.Ao) * p.periphery;
    px = (p.Ao * Math.tan(angle)) / Math.tan(p.periphery);
    py *= p.periphery / (Math.tan(p.periphery) * Math.cos(angle));
  }
  const f = (1 + (p.k * (px * px + py * py)) / (1 + p.Ao * p.Ao)) / p.z;
  const u = 0.5 + 0.5 * ((px * f) / p.As + p.ox);
  const v = 0.5 + 0.5 * (py * f + p.oy);
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { u, v };
}

/** 출력 크기: 원본 비율 그대로, 긴 변 maxLong 이하(원본보다 키우지 않음), 짝수 px. layout() 147~149행에서 비율을 원본으로 둔 것. */
export function warpOutputSize(sw: number, sh: number, maxLong: number): { width: number; height: number } {
  const As = sw / sh;
  const edge = Math.min(maxLong, Math.max(sw, sh));
  return {
    width: Math.max(2, Math.round((As >= 1 ? edge : edge * As) / 2) * 2),
    height: Math.max(2, Math.round((As >= 1 ? edge / As : edge) / 2) * 2),
  };
}

/** CPU 경로의 표본 크기: 긴 변 640(renderCPU 158~159행). */
export function cpuSampleSize(As: number, longSide = 640): { width: number; height: number } {
  return As >= 1 ? { width: longSide, height: Math.max(2, Math.round(longSide / As)) } : { width: Math.max(2, Math.round(longSide * As)), height: longSide };
}

export interface CpuMap {
  /** 출력 픽셀마다 원본 네 이웃의 RGBA 시작 위치. 원본 밖이면 -1. */
  ix: Int32Array;
  weights: Float32Array;
}

/** 출력 w×h → 원본 sw×sh 쌍선형 표본 지도(renderCPU 165~182행). 설정·크기가 같으면 다시 만들지 않는다. */
export function buildCpuMap(w: number, h: number, sw: number, sh: number, p: WarpParams): CpuMap {
  const ix = new Int32Array(w * h * 4).fill(-1);
  const weights = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const uv = sourceUv((x + 0.5) / w, (y + 0.5) / h, p);
      if (!uv) continue;
      const sx = Math.max(0, Math.min(sw - 1, uv.u * sw - 0.5));
      const sy = Math.max(0, Math.min(sh - 1, uv.v * sh - 0.5));
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, sw - 1);
      const y1 = Math.min(y0 + 1, sh - 1);
      const tx = sx - x0;
      const ty = sy - y0;
      const j = 4 * (y * w + x);
      ix[j] = 4 * (y0 * sw + x0);
      ix[j + 1] = 4 * (y0 * sw + x1);
      ix[j + 2] = 4 * (y1 * sw + x0);
      ix[j + 3] = 4 * (y1 * sw + x1);
      weights[j] = (1 - tx) * (1 - ty);
      weights[j + 1] = tx * (1 - ty);
      weights[j + 2] = (1 - tx) * ty;
      weights[j + 3] = tx * ty;
    }
  }
  return { ix, weights };
}

/** 지도대로 원본 RGBA를 출력 RGBA에 옮긴다(renderCPU 185~190행). 원본 밖은 검정, 알파는 255. */
export function applyCpuMap(map: CpuMap, src: Uint8ClampedArray, out: Uint8ClampedArray): void {
  const { ix, weights: wt } = map;
  for (let j = 0; j < out.length; j += 4) {
    out[j + 3] = 255;
    const a = ix[j] ?? -1;
    if (a < 0) {
      out[j] = out[j + 1] = out[j + 2] = 0;
      continue;
    }
    const b = ix[j + 1] ?? 0;
    const c = ix[j + 2] ?? 0;
    const d = ix[j + 3] ?? 0;
    const w0 = wt[j] ?? 0;
    const w1 = wt[j + 1] ?? 0;
    const w2 = wt[j + 2] ?? 0;
    const w3 = wt[j + 3] ?? 0;
    for (let ch = 0; ch < 3; ch++) {
      out[j + ch] = (src[a + ch] ?? 0) * w0 + (src[b + ch] ?? 0) * w1 + (src[c + ch] ?? 0) * w2 + (src[d + ch] ?? 0) * w3;
    }
  }
}
