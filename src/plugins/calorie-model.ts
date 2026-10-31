// 칼로리 기기 안 모델(calorie-lens, ONNX int8). 칼로리 플러그인 Worker가 blob으로 만드는 하위 Worker에서 돈다.
// 설계: docs/designs/plugin-host.md §2.10. 하위 Worker라서 모델을 받고 돌리는 동안에도 플러그인 Worker는 확인(ack)·API를 처리한다.
// calorieModelWorker·parseModelSpec·toTensorData는 toString()으로 옮겨지므로 인자와 Worker 전역만 쓴다.

import { NAME_HELPER_SHIM } from './sdk/source';

/** 하위 Worker에 보내는 설정(registry가 caloriePlugin에 넣는다). */
export interface OnDeviceConfig {
  workerSource: string;
  /** 호스트 origin 뒤에 붙는 경로. */
  ortPath: string;
  modelPath: string;
  /** 핸들러가 전달을 받은 때부터 기기 안 결과까지. 넘으면 /api/calorie로 간다. */
  timeoutMs: number;
}

/** `<modelPath>model.json`. 허브가 ONNX와 함께 준다. */
export interface ModelSpec {
  /** 순서대로 이어 붙이면 ONNX 파일 하나가 되는 조각(각 50MB 아래). */
  files: string[];
  input: {
    name: string;
    width: number;
    height: number;
    /** 0~1 값 기준(mean 0~1, std 0 초과 1 이하). (v/255 - mean) / std, RGB 순서. 그래프 안에서 정규화하면 0과 1. */
    mean: [number, number, number];
    std: [number, number, number];
    /** stretch: 그대로 늘림. letterbox: 비율을 지켜 가운데에 그리고 빈 곳은 fill(RGB 0~255)로 채움. */
    resize: 'stretch' | 'letterbox';
    fill: [number, number, number];
  };
  /** 전체 kcal이 든 출력과 그 안의 위치(평탄화 기준). */
  output: { name: string; index: number };
  /** 모델이 추정한 양(g). 있으면 1g당 kcal을 계산한다(portion.ts). */
  mass: { name: string; index: number } | null;
}

export const CALORIE_MODEL_PATH = '/models/calorie-lens/';
export const ORT_PATH = '/ort/';
/** calorie-lens int8은 wasm 1스레드에서 데스크톱 2.5~4.6초, 휴대폰 5~10초로 예상(허브, 2026-11-01). */
export const ON_DEVICE_TIMEOUT_MS = 8_000;

/** 형식이 맞지 않으면 예외. 파일 이름은 경로 없이 한 단계만 받는다. */
export function parseModelSpec(raw: unknown): ModelSpec {
  const bad = (what: string): never => {
    throw new Error(`model.json ${what}`);
  };
  const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const name = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9_.:/-]{1,128}$/.test(v) ? v : bad('이름'));
  const int = (v: unknown, lo: number, hi: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : bad('정수 범위');
  const triple = (v: unknown, ok: (x: number) => boolean, what: string): [number, number, number] =>
    Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && ok(x)) ? [v[0], v[1], v[2]] : bad(what);
  const tensorRef = (v: unknown) => (isRec(v) ? { name: name(v.name), index: int(v.index ?? 0, 0, 1_000_000) } : bad('출력'));
  if (!isRec(raw) || !isRec(raw.input) || !isRec(raw.output)) return bad('구조');
  const files = raw.files;
  if (!Array.isArray(files) || files.length < 1 || files.length > 8) return bad('files');
  for (const f of files) if (typeof f !== 'string' || !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/.test(f)) bad('files 이름');
  const i = raw.input;
  const resize = i.resize ?? 'stretch';
  if (resize !== 'stretch' && resize !== 'letterbox') return bad('resize');
  return {
    files: files as string[],
    input: {
      name: name(i.name),
      width: int(i.width, 1, 1024),
      height: int(i.height, 1, 1024),
      // 0~255 기준 값을 막는다.
      mean: triple(i.mean, (x) => x >= 0 && x <= 1, 'mean'),
      std: triple(i.std, (x) => x > 0 && x <= 1, 'std'),
      resize,
      fill: triple(i.fill ?? [0, 0, 0], (x) => Number.isInteger(x) && x >= 0 && x <= 255, 'fill'),
    },
    output: tensorRef(raw.output),
    mass: raw.mass === undefined ? null : tensorRef(raw.mass),
  };
}

/** RGBA → NCHW float32(RGB). */
export function toTensorData(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  mean: readonly number[],
  std: readonly number[],
): Float32Array {
  const plane = width * height;
  const out = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p++) {
    for (let c = 0; c < 3; c++) out[c * plane + p] = (rgba[p * 4 + c]! / 255 - mean[c]!) / std[c]!;
  }
  return out;
}

interface OrtLike {
  env: { wasm: { numThreads: number; proxy: boolean; wasmPaths: unknown } };
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown;
  InferenceSession: {
    create(model: Uint8Array, options: { executionProviders: string[] }): Promise<{
      run(feeds: Record<string, unknown>): Promise<Record<string, { data: ArrayLike<number | bigint> }>>;
    }>;
  };
}

/** 하위 Worker 몸체. 메시지: load → loaded|failed, run → out(kcal·mass 또는 null). */
export function calorieModelWorker(
  scope: {
    postMessage(m: unknown): void;
    addEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
    importScripts(url: string): void;
    ort?: OrtLike;
  },
  parseSpec: typeof parseModelSpec,
  tensorData: typeof toTensorData,
): void {
  let spec: ModelSpec | null = null;
  let ort: OrtLike | null = null;
  let session: Awaited<ReturnType<OrtLike['InferenceSession']['create']>> | null = null;

  const fetchOk = async (url: string, init?: RequestInit) => {
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res;
  };

  const decode = async (blob: Blob, s: ModelSpec) => {
    const { width: W, height: H, fill } = s.input;
    const bmp = await createImageBitmap(blob);
    const ctx = new OffscreenCanvas(W, H).getContext('2d');
    if (!ctx) throw new Error('2d 없음');
    ctx.imageSmoothingQuality = 'high';
    if (s.input.resize === 'letterbox') {
      // 비율을 지켜 가운데에. 캔버스를 줄이지 않는다(모델이 화면 속 크기로 양을 읽는다).
      const k = Math.min(W / bmp.width, H / bmp.height);
      const w = Math.round(bmp.width * k);
      const h = Math.round(bmp.height * k);
      ctx.fillStyle = `rgb(${fill[0]}, ${fill[1]}, ${fill[2]})`;
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(bmp, Math.floor((W - w) / 2), Math.floor((H - h) / 2), w, h);
    } else {
      ctx.drawImage(bmp, 0, 0, W, H);
    }
    bmp.close();
    return tensorData(ctx.getImageData(0, 0, W, H).data, W, H, s.input.mean, s.input.std);
  };

  const pick = (out: Record<string, { data: ArrayLike<number | bigint> }>, ref: { name: string; index: number } | null) => {
    if (!ref) return null;
    const v = out[ref.name]?.data[ref.index];
    const n = typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : NaN;
    return Number.isFinite(n) ? n : null;
  };

  const infer = async (data: Float32Array) => {
    if (!spec || !ort || !session) throw new Error('세션 없음');
    const out = await session.run({ [spec.input.name]: new ort.Tensor('float32', data, [1, 3, spec.input.height, spec.input.width]) });
    return { kcal: pick(out, spec.output), mass: pick(out, spec.mass) };
  };

  const load = async (ortBase: string, modelBase: string, budgetMs: number) => {
    const t0 = performance.now();
    // /models/*는 1년 immutable 캐시다. 이름이 그대로인 model.json만 매번 다시 확인한다(조각은 이름을 바꿔 교체).
    const s = parseSpec(await (await fetchOk(`${modelBase}model.json`, { cache: 'no-cache' })).json());
    // wasm판만 쓴다: int8 연산(MatMulInteger)은 WebGPU 커널이 없고, Chrome 격리 Worker에는 navigator.gpu도 없다.
    // SharedArrayBuffer가 없으니 단일 스레드, 프록시 없음.
    scope.importScripts(`${ortBase}ort.wasm.min.js`);
    const o = scope.ort;
    if (!o) throw new Error('ort 없음');
    o.env.wasm.numThreads = 1;
    o.env.wasm.proxy = false;
    o.env.wasm.wasmPaths = { mjs: `${ortBase}ort-wasm-simd-threaded.mjs`, wasm: `${ortBase}ort-wasm-simd-threaded.wasm` };
    const parts = await Promise.all(s.files.map(async (f) => new Uint8Array(await (await fetchOk(modelBase + f)).arrayBuffer())));
    const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      bytes.set(p, at);
      at += p.length;
    }
    parts.length = 0;
    session = await o.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    spec = s;
    ort = o;
    // 첫 실행의 준비 비용을 전달 전에 치르고 이 기기의 속도를 본다. 제한의 90%(디코드·전처리 몫)를 넘으면 한 번 더 재고,
    // 그래도 넘는 기기는 처음부터 끈다(전달마다 제한을 다 쓰고 API로 가지 않게).
    const zeros = new Float32Array(3 * s.input.width * s.input.height);
    const t1 = performance.now();
    const first = await infer(zeros);
    const t2 = performance.now();
    let runMs = t2 - t1;
    if (first.kcal === null) throw new Error('준비 실행 출력이 숫자가 아님');
    if (runMs > 0.9 * budgetMs) {
      await infer(zeros);
      runMs = performance.now() - t2;
      if (runMs > 0.9 * budgetMs) throw new Error(`느림: 실행 ${Math.round(runMs)}ms > ${0.9 * budgetMs}ms`);
    }
    scope.postMessage({
      type: 'loaded',
      ep: 'wasm',
      bytes: bytes.length,
      loadMs: Math.round(t1 - t0),
      firstMs: Math.round(t2 - t1),
      warmMs: Math.round(runMs),
    });
  };

  scope.addEventListener('message', (e: MessageEvent) => {
    const m = e.data as Record<string, unknown> | null;
    if (typeof m !== 'object' || m === null) return;
    if (m.type === 'load' && typeof m.ortBase === 'string' && typeof m.modelBase === 'string' && !spec) {
      load(m.ortBase, m.modelBase, typeof m.budgetMs === 'number' ? m.budgetMs : Infinity).catch((err: unknown) => {
        session = null;
        scope.postMessage({ type: 'failed', reason: String(err).slice(0, 200) });
      });
    } else if (m.type === 'run' && typeof m.id === 'number' && m.blob instanceof Blob) {
      const id = m.id;
      const t0 = performance.now();
      (spec ? decode(m.blob, spec) : Promise.reject(new Error('세션 없음')))
        .then(infer)
        .then(
          (r) => scope.postMessage({ type: 'out', id, kcal: r.kcal, mass: r.mass, ms: Math.round(performance.now() - t0) }),
          () => scope.postMessage({ type: 'out', id, kcal: null, mass: null, ms: Math.round(performance.now() - t0) }),
        );
    }
  });
}

export function buildModelWorkerSource(): string {
  return [
    '"use strict";',
    NAME_HELPER_SHIM,
    `(${calorieModelWorker.toString()})(self, (${parseModelSpec.toString()}), (${toTensorData.toString()}));`,
    '',
  ].join('\n');
}

export function calorieOnDevice(modelPath: string = CALORIE_MODEL_PATH): OnDeviceConfig {
  return { workerSource: buildModelWorkerSource(), ortPath: ORT_PATH, modelPath, timeoutMs: ON_DEVICE_TIMEOUT_MS };
}
