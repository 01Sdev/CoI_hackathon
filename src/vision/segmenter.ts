// Selfie Multiclass 로더(F23, 03-SRS FR-016a ⑥). 16.4MB라 0단계 첫 판정 뒤에 받고, 받은 직후 빈 캔버스로 한 번 돌려
// 첫 추론 지연(iPhone 11.6초)을 포착 전에 치른다. 없거나 실패하면 'missing'·'error'로 두고 가림은 박스·사각형 전체로 한다.

import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import { MODEL_PATHS, WASM_BASE } from './config';
import { fetchModel, MissingModel } from './models';

export type SegmenterState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; delegate: 'GPU' | 'CPU'; loadMs: number; warmMs: number }
  | { status: 'missing'; path: string }
  | { status: 'error'; message: string };

let state: SegmenterState = { status: 'idle' };
let segmenter: ImageSegmenter | null = null;
let loading: Promise<ImageSegmenter | null> | null = null;
const listeners = new Set<(s: SegmenterState) => void>();

function setState(next: SegmenterState) {
  state = next;
  for (const fn of listeners) fn(next);
}

export function getSegmenterState(): SegmenterState {
  return state;
}

export function subscribeSegmenterState(fn: (s: SegmenterState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

export function getSegmenter(): ImageSegmenter | null {
  return segmenter;
}

async function create(delegate: 'GPU' | 'CPU', buf: Uint8Array): Promise<ImageSegmenter> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  return ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: buf.slice(), delegate },
    runningMode: 'IMAGE',
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  });
}

/** 한 번만 만든다. 실패 뒤 다시 부르면 다시 시도한다. */
export function loadSegmenter(): Promise<ImageSegmenter | null> {
  if (segmenter) return Promise.resolve(segmenter);
  if (loading) return loading;
  loading = (async () => {
    setState({ status: 'loading' });
    const t0 = performance.now();
    try {
      const buf = await fetchModel(MODEL_PATHS.selfie);
      let made: ImageSegmenter;
      let delegate: 'GPU' | 'CPU' = 'GPU';
      try {
        made = await create('GPU', buf);
      } catch (gpuErr) {
        console.warn('[vision] Selfie GPU 생성 실패, CPU로 전환', gpuErr);
        delegate = 'CPU';
        made = await create('CPU', buf);
      }
      const loadMs = Math.round(performance.now() - t0);
      // 예열: 첫 추론의 셰이더 준비를 포착 전에 끝낸다. 결과는 버린다.
      const w0 = performance.now();
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 256;
      try {
        made.segment(c, () => undefined);
      } finally {
        c.width = 0;
        c.height = 0;
      }
      segmenter = made;
      setState({ status: 'ready', delegate, loadMs, warmMs: Math.round(performance.now() - w0) });
      return made;
    } catch (e) {
      if (e instanceof MissingModel) setState({ status: 'missing', path: e.path });
      else setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      return null;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/**
 * 조각 캔버스의 Selfie 클래스 마스크를 복사해 돌려준다(콜백이 끝나면 MediaPipe가 마스크를 놓으므로 그 안에서 복사).
 * 준비 전이거나 실패하면 null.
 */
export function segmentCategories(source: HTMLCanvasElement): { categories: Uint8Array; width: number; height: number } | null {
  const s = segmenter;
  if (!s) return null;
  let out: { categories: Uint8Array; width: number; height: number } | null = null;
  try {
    s.segment(source, (r) => {
      const m = r.categoryMask;
      if (!m) return;
      out = { categories: m.getAsUint8Array().slice(), width: m.width, height: m.height };
    });
  } catch (e) {
    console.warn('[vision] Selfie 추론 실패, 박스 가림으로', e);
    return null;
  }
  return out;
}
