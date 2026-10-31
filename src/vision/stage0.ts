// 0단계 훑어보기(F2). 근거: docs/specs/03-SRS.md FR-006~009, §4.1.
// <video> 프레임을 긴 변 640으로 줄여 5fps로 EfficientDet-Lite0를 돌린다. 추론은 한 번에 하나, 밀린 프레임은 버린다.
// 프레임 콜백(requestVideoFrameCallback)이 있으면 그것으로, 없으면 setInterval로 돈다.

import { lensStore } from '../core/store';
import type { Box, SceneDecision } from '../core/types';
import { getInputEpoch, getVideo } from '../input/adapter';
import { VISION_CONFIG } from './config';
import { classifyScene, fitLongSide, scaleBox, type Found } from './geometry';
import { getModels, type Models } from './models';
import { SCENE_NONE, stepScene, type SceneState } from './scene';

/** 0단계 틱 하나의 결과. 포착 게이트가 틱마다 받는다. */
export interface Stage0Tick {
  at: number;
  scene: SceneState;
  /** 확정 상태일 때 그 확정의 SceneDecision. 아니면 null. */
  decision: SceneDecision | null;
  /** 이번 틱의 대상(소스 프레임 기준 0~1). */
  targetBox: Box | null;
  objectLabel: string | null;
  inputEpoch: number;
}

let scene: SceneState = SCENE_NONE;
let decision: SceneDecision | null = null;
let lastTick: Stage0Tick | null = null;
let running = false;
let inFlight = false;
let lastRunAt = -Infinity;
let lastEpoch = -1;
let lastSessionId = '';
let lastFrameCount: number | null = null;
let canvas: HTMLCanvasElement | null = null;
let stopLoop: (() => void) | null = null;
let warned = false;
const tickListeners = new Set<(t: Stage0Tick) => void>();
/** 최근 틱 시각과 추론 시간(ms). 처리량 확인(V1)용. */
const recentTicks: number[] = [];
const recentInferMs: number[] = [];
const STATS_WINDOW = 25;

export interface Stage0Stats {
  /** 최근 틱 사이 간격으로 잰 fps. 틱이 2개 미만이면 null. */
  fps: number | null;
  /** 최근 추론 평균(ms). */
  meanInferMs: number | null;
  /** 최근 추론 p95(ms). */
  p95InferMs: number | null;
}

export function getStage0Stats(): Stage0Stats {
  const n = recentTicks.length;
  const first = recentTicks[0];
  const last = recentTicks[n - 1];
  const fps = n >= 2 && first !== undefined && last !== undefined && last > first ? ((n - 1) * 1000) / (last - first) : null;
  if (recentInferMs.length === 0) return { fps, meanInferMs: null, p95InferMs: null };
  const sorted = [...recentInferMs].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? null;
  return { fps, meanInferMs: mean, p95InferMs: p95 };
}

const pushRecent = (arr: number[], v: number) => {
  arr.push(v);
  if (arr.length > STATS_WINDOW) arr.shift();
};

/** 틱마다 부른다(포착 게이트용). */
export function onStage0Tick(fn: (t: Stage0Tick) => void): () => void {
  tickListeners.add(fn);
  return () => tickListeners.delete(fn);
}

export function getLastStage0Tick(): Stage0Tick | null {
  return lastTick;
}

function resetScene() {
  scene = SCENE_NONE;
  decision = null;
}

/** 직전 틱 이후 화면에 나온 소스 프레임 수. 알 수 없으면 0(처리량 비율이 null이 된다). */
function takeSourceFrames(v: HTMLVideoElement): number {
  const q = typeof v.getVideoPlaybackQuality === 'function' ? v.getVideoPlaybackQuality() : null;
  if (!q) return 0;
  const total = q.totalVideoFrames;
  const prev = lastFrameCount;
  lastFrameCount = total;
  if (prev === null || total < prev) return 0;
  return total - prev;
}

function detect(m: Models, source: HTMLCanvasElement): Found[] {
  const r = m.object.detect(source);
  const out: Found[] = [];
  for (const d of r.detections) {
    const c = d.categories[0];
    const b = d.boundingBox;
    if (!c || !b) continue;
    out.push({ label: c.categoryName, score: c.score, box: { x: b.originX, y: b.originY, w: b.width, h: b.height } });
  }
  return out;
}

function runTick(v: HTMLVideoElement) {
  const m = getModels();
  if (!m || inFlight) return;
  if (v.readyState < 2 || v.videoWidth === 0 || v.paused) return;
  const store = lensStore.getState();
  const epochNow = getInputEpoch();
  if (epochNow !== lastEpoch || store.session.id !== lastSessionId) {
    lastEpoch = epochNow;
    lastSessionId = store.session.id;
    lastFrameCount = null;
    recentTicks.length = 0;
    resetScene();
  }

  inFlight = true;
  try {
    const now = performance.now();
    lastRunAt = now;
    const { width, height } = fitLongSide(v.videoWidth, v.videoHeight, VISION_CONFIG.stage0LongSide);
    if (!canvas) canvas = document.createElement('canvas');
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, width, height);

    let found: Found[];
    try {
      const t0 = performance.now();
      found = detect(m, canvas);
      pushRecent(recentInferMs, performance.now() - t0);
      pushRecent(recentTicks, now);
    } catch (e) {
      if (!warned) console.warn('[vision] 0단계 추론 실패', e);
      warned = true;
      return;
    }
    store.recordRuns({ stage0Runs: 1, sourceFrames: takeSourceFrames(v) });

    const view = classifyScene(found, width, height);
    const step = stepScene(scene, view.label, now, VISION_CONFIG.confirmMs);
    scene = step.next;
    const targetBox = view.target ? scaleBox(view.target.box, 1 / width, 1 / height) : null;
    if (scene.kind !== 'confirmed') decision = null;
    if (step.confirmed && view.target && targetBox && scene.kind === 'confirmed') {
      decision = store.addSceneDecision({
        label: scene.label,
        objectLabel: view.target.label,
        targetBox,
        score: view.target.score,
      });
    }

    store.setLiveObservation({
      label: scene.kind === 'confirmed' ? scene.label : 'none',
      objectLabel: view.target?.label ?? null,
      targetBox,
      peopleCount: view.peopleCount,
      at: now,
    });

    const tick: Stage0Tick = {
      at: now,
      scene,
      decision,
      targetBox,
      objectLabel: view.target?.label ?? null,
      inputEpoch: epochNow,
    };
    lastTick = tick;
    for (const fn of tickListeners) {
      try {
        fn(tick);
      } catch (e) {
        console.error('[vision] 틱 처리 오류', e);
      }
    }
  } finally {
    inFlight = false;
  }
}

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/** 0단계 반복을 시작한다. 여러 번 불러도 하나만 돈다. */
export function startStage0(): () => void {
  if (running) return stopStage0;
  running = true;

  // 프레임 콜백은 <video>가 바뀌지 않는 한 계속 걸어 둔다. 콜백이 없는 브라우저는 setInterval.
  const interval = VISION_CONFIG.stage0IntervalMs;
  const tolerance = 16;
  let timer: ReturnType<typeof setInterval> | null = null;
  let handle: number | null = null;
  let boundVideo: FrameCallbackVideo | null = null;
  let lastCallbackAt = -Infinity;

  const onFrame = () => {
    handle = null;
    lastCallbackAt = performance.now();
    if (!running || !boundVideo) return;
    if (performance.now() - lastRunAt >= interval - tolerance) runTick(boundVideo);
    handle = boundVideo.requestVideoFrameCallback?.(onFrame) ?? null;
  };

  // <video>는 입력 어댑터가 처음 열 때 생기므로 짧게 확인하며 붙는다. 콜백이 멈춘(일시 정지 등) 경우의 보조 역할도 한다.
  timer = setInterval(() => {
    const v = getVideo() as FrameCallbackVideo | null;
    if (!v) return;
    if (typeof v.requestVideoFrameCallback === 'function') {
      if (boundVideo !== v || handle === null) {
        if (boundVideo && handle !== null) boundVideo.cancelVideoFrameCallback?.(handle);
        boundVideo = v;
        handle = v.requestVideoFrameCallback(onFrame);
      }
      // 화면에 그려지지 않는 <video>(DOM 밖, 숨은 탭)는 프레임 콜백이 멈춘다. 두 간격 넘게 콜백이 없으면 이 타이머가 대신 돈다.
      const now = performance.now();
      if (now - lastCallbackAt > interval * 2 && now - lastRunAt >= interval - tolerance) runTick(v);
      return;
    }
    if (performance.now() - lastRunAt >= interval - tolerance) runTick(v);
  }, interval);

  stopLoop = () => {
    if (timer) clearInterval(timer);
    if (boundVideo && handle !== null) boundVideo.cancelVideoFrameCallback?.(handle);
    timer = null;
    handle = null;
    boundVideo = null;
  };
  return stopStage0;
}

function stopStage0() {
  running = false;
  stopLoop?.();
  stopLoop = null;
  resetScene();
  lastTick = null;
  lensStore.getState().setLiveObservation(null);
}
