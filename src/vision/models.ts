// MediaPipe 모델 로더. 모델·WASM은 같은 출처 /public에서만 받는다(NFR-010).
// GPU로 먼저 만들고 실패하면 CPU로 만든다(NFR-022). 파일이 없으면 'missing'으로 멈추고, 파일을 넣고 다시 부르면 붙는다.

import { FaceDetector, FilesetResolver, ObjectDetector } from '@mediapipe/tasks-vision';
import { MODEL_PATHS, VISION_CONFIG, WASM_BASE } from './config';

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

class MissingModel extends Error {
  constructor(readonly path: string) {
    super(`모델 파일 없음: ${path}`);
  }
}

/** 개발 서버는 없는 파일에 index.html(200)을 돌려주므로 응답 형식까지 본다. */
async function fetchModel(path: string): Promise<Uint8Array> {
  const res = await fetch(path);
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || type.includes('text/html')) throw new MissingModel(path);
  return new Uint8Array(await res.arrayBuffer());
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

/** 한 번만 만든다. 실패(missing·error) 뒤 다시 부르면 다시 시도한다. */
export function loadModels(): Promise<Models | null> {
  if (models) return Promise.resolve(models);
  if (loading) return loading;
  loading = (async () => {
    setState({ status: 'loading' });
    const t0 = performance.now();
    try {
      const [objectBuf, faceBuf] = await Promise.all([fetchModel(MODEL_PATHS.object), fetchModel(MODEL_PATHS.face)]);
      let made: Models;
      try {
        made = await create('GPU', objectBuf, faceBuf);
      } catch (gpuErr) {
        console.warn('[vision] GPU 모델 생성 실패, CPU로 전환', gpuErr);
        made = await create('CPU', objectBuf, faceBuf);
      }
      models = made;
      setState({ status: 'ready', delegate: made.delegate, loadMs: Math.round(performance.now() - t0) });
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
