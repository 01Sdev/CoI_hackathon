// MediaPipe 모델 로더. 모델·WASM은 같은 출처 /public에서만 받는다(NFR-010).
// GPU로 먼저 만들고 실패하면 CPU로 만든다(NFR-022). 파일이 없으면 'missing'으로 멈추고, 파일을 넣고 다시 부르면 붙는다.

import { FaceDetector, FilesetResolver, ObjectDetector, type ObjectDetectorResult } from '@mediapipe/tasks-vision';
import { lensStore } from '../core/store';
import { MODEL_PATHS, VISION_CONFIG, WASM_BASE } from './config';
import type { Found } from './geometry';

export type ModelState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; delegate: 'GPU' | 'CPU'; loadMs: number }
  | { status: 'missing'; path: string }
  | { status: 'error'; message: string };

export interface Models {
  object: ObjectDetector;
  face: FaceDetector;
  delegate: 'GPU' | 'CPU';
}

let state: ModelState = { status: 'idle' };
let models: Models | null = null;
let loading: Promise<Models | null> | null = null;
const listeners = new Set<(s: ModelState) => void>();

function setState(next: ModelState) {
  state = next;
  for (const fn of listeners) fn(next);
}

export function getModelState(): ModelState {
  return state;
}

/** 상태가 바뀔 때마다 부른다. 등록할 때 지금 상태로 한 번 부른다. */
export function subscribeModelState(fn: (s: ModelState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

export function getModels(): Models | null {
  return models;
}

/** C가 보는 엔진 상태(track-c/screens가 core에 더하는 engine·setEngine). core에 아직 없으면 부르지 않는다. */
type EnginePatch = {
  status?: 'idle' | 'loading' | 'ready' | 'failed';
  loadedBytes?: number | null;
  totalBytes?: number | null;
  detail?: string | null;
};

export function reportEngine(patch: EnginePatch): void {
  const s = lensStore.getState() as unknown as { setEngine?: (p: EnginePatch) => void };
  s.setEngine?.(patch);
}

export class MissingModel extends Error {
  constructor(readonly path: string) {
    super(`모델 파일 없음: ${path}`);
  }
}

/** 개발 서버는 없는 파일에 index.html(200)을 돌려주므로 응답 형식까지 본다. */
export async function fetchModel(path: string, progress: (loaded: number, total: number | null) => void = () => undefined): Promise<Uint8Array> {
  const res = await fetch(path);
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || type.includes('text/html')) throw new MissingModel(path);
  const total = Number(res.headers.get('content-length')) || null;
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = new Uint8Array(await res.arrayBuffer());
    progress(buf.length, buf.length);
    return buf;
  }
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    progress(loaded, total);
  }
  const buf = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  return buf;
}

async function create(delegate: 'GPU' | 'CPU', objectBuf: Uint8Array, faceBuf: Uint8Array): Promise<Models> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  // 같은 버퍼를 두 번 넘기면 GPU 실패 뒤 CPU 시도에서 비어 있을 수 있어 복사본을 넘긴다.
  const object = await ObjectDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: objectBuf.slice(), delegate },
    runningMode: 'IMAGE',
    scoreThreshold: VISION_CONFIG.detectorScoreFloor,
    maxResults: 20,
  });
  try {
    const face = await FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: faceBuf.slice(), delegate },
      runningMode: 'IMAGE',
      minDetectionConfidence: VISION_CONFIG.faceScoreMin,
    });
    return { object, face, delegate };
  } catch (e) {
    object.close();
    throw e;
  }
}

/** 빈 캔버스로 한 번씩 돌려 GPU 셰이더 준비를 미리 끝낸다. 첫 포착이 느려 쿨다운 간격이 흔들리지 않게 한다. */
function warmUp(m: Models) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  try {
    m.object.detect(c);
    m.face.detect(c);
  } catch (e) {
    console.warn('[vision] 예열 실패(무시)', e);
  } finally {
    c.width = 0;
    c.height = 0;
  }
}

/** 한 번만 만든다. 실패(missing·error) 뒤 다시 부르면 다시 시도한다. */
export function loadModels(): Promise<Models | null> {
  if (models) return Promise.resolve(models);
  if (loading) return loading;
  loading = (async () => {
    setState({ status: 'loading' });
    reportEngine({ status: 'loading', loadedBytes: 0, totalBytes: null, detail: null });
    const t0 = performance.now();
    // 두 파일의 받은 바이트를 합쳐 C에 알린다. 전체 크기는 두 파일 모두 content-length를 알 때만.
    const parts = { object: { loaded: 0, total: null as number | null }, face: { loaded: 0, total: null as number | null } };
    const onProgress = (key: keyof typeof parts) => (loaded: number, total: number | null) => {
      parts[key] = { loaded, total };
      const totalBytes = parts.object.total !== null && parts.face.total !== null ? parts.object.total + parts.face.total : null;
      reportEngine({ loadedBytes: parts.object.loaded + parts.face.loaded, totalBytes });
    };
    try {
      const [objectBuf, faceBuf] = await Promise.all([
        fetchModel(MODEL_PATHS.object, onProgress('object')),
        fetchModel(MODEL_PATHS.face, onProgress('face')),
      ]);
      let made: Models;
      try {
        made = await create('GPU', objectBuf, faceBuf);
      } catch (gpuErr) {
        console.warn('[vision] GPU 모델 생성 실패, CPU로 전환', gpuErr);
        try {
          made = await create('CPU', objectBuf, faceBuf);
        } catch (cpuErr) {
          throw new Error(`GPU 실패 → CPU 재시도 실패: ${cpuErr instanceof Error ? cpuErr.message : String(cpuErr)}`);
        }
      }
      warmUp(made);
      models = made;
      setState({ status: 'ready', delegate: made.delegate, loadMs: Math.round(performance.now() - t0) });
      return made;
    } catch (e) {
      if (e instanceof MissingModel) setState({ status: 'missing', path: e.path });
      else setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      // 로컬 분석 불가(NFR-022): 판정이 돌지 않으므로 전달도 없다. 사유 한 줄을 C에 넘긴다.
      reportEngine({ status: 'failed', detail: e instanceof Error ? e.message : String(e) });
      return null;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

function toFound(r: ObjectDetectorResult, fallbackLabel: string): Found[] {
  const out: Found[] = [];
  for (const d of r.detections) {
    const c = d.categories[0];
    const b = d.boundingBox;
    if (!c || !b) continue;
    out.push({ label: c.categoryName || fallbackLabel, score: c.score, box: { x: b.originX, y: b.originY, w: b.width, h: b.height } });
  }
  return out;
}

/** 물체 검출. 박스는 source의 px. */
export function detectObjects(m: Models, source: HTMLCanvasElement): Found[] {
  return toFound(m.object.detect(source), '');
}

/** 얼굴 검출. 박스는 source의 px. label은 'face'. */
export function detectFaces(m: Models, source: HTMLCanvasElement): Found[] {
  return toFound(m.face.detect(source), 'face').map((f) => ({ ...f, label: 'face' }));
}
