// 1단계 포착·2단계 가림·분기·출구 재검사(F3·F4). 근거: 03-SRS FR-010~018·FR-055, §4.1·§4.2, 02-SSRD IF-02,
// docs/designs/track-a-runtime.md §2.5~2.7.
// 원본 프레임은 이 파일 안에서만 만들고 조각을 자르자마자 놓는다(비교 모드는 raw 인코딩 직후). 가리기 전 조각은 가림 단계에서
// 덮어쓴다. 작업 캔버스는 모든 경로(보류·예외 포함)에서 finally로 비운다. 플러그인에는 broker의 deliver만 쓴다.

import { lensStore, type NewDetection } from '../core/store';
import type { Box, FaceCheck, SceneDecision } from '../core/types';
import { deliver, hold, skip } from '../broker/broker';
import { getInputEpoch, getVideo } from '../input/adapter';
import { cooldownUntil, decideBranch, type ProtectedBranch } from './branch';
import { VISION_CONFIG } from './config';
import { clampToFrame, expand, fitLongSide, matchTarget, scaleBox, translate, type Found } from './geometry';
import { canvasOf, pixelate, release, toJpeg } from './mask';
import { detectFaces, detectObjects, getModels, type Models } from './models';
import { planCapture, type CaptureTarget } from './plan';
import { onStage0Tick, type Stage0Tick } from './stage0';

const cfg = VISION_CONFIG;
/** 포착은 한 번에 하나(모듈 잠금). 스토어 busy는 화면 표시·게이트용이고 새 세션이 false로 되돌리므로 잠금으로 쓰지 않는다. */
let inFlight = false;
let stop: (() => void) | null = null;

/** 0단계 틱마다 포착 게이트를 본다. 여러 번 불러도 하나다. */
export function startCapture(): () => void {
  if (stop) return stop;
  const off = onStage0Tick(onTick);
  stop = () => {
    off();
    stop = null;
  };
  return stop;
}

function onTick(t: Stage0Tick) {
  if (inFlight) return;
  if (t.scene.kind !== 'confirmed' || !t.decision || !t.targetBox || !t.objectLabel) return;
  const plan = planCapture(lensStore.getState(), t.scene.label, t.at);
  for (const id of plan.undeclared) skip(id, t.decision.id, '선언하지 않은 장면');
  if (plan.capture.length === 0) return;
  inFlight = true;
  runCapture(t, t.decision, t.objectLabel, t.targetBox, plan.capture)
    .catch((e) => console.error('[vision] 포착 오류', e))
    .finally(() => {
      inFlight = false;
    });
}

/**
 * 포착을 시작할 때의 세대. 마지막 await 뒤 스토어에 쓰기 직전마다 대조해, 그 사이 새 세션·입력 전환·iframe 교체가
 * 있었으면 그 플러그인에 아무것도 쓰지 않는다(로그·쿨다운 포함). prepareDelivery도 runtimeId·버전을 다시 본다.
 */
interface Token {
  sessionId: string;
  inputEpoch: number;
}

function stillCurrent(token: Token, c: CaptureTarget): boolean {
  const s = lensStore.getState();
  const p = s.plugins[c.pluginId];
  return s.session.id === token.sessionId && getInputEpoch() === token.inputEpoch && !!p && p.runtimeId === c.runtimeId;
}

/** 얼굴 검출. 긴 변이 faceMinSide보다 작으면 키운 사본으로 돌리고 사본은 바로 비운다(FR-014). 박스는 source px. */
function facesOn(m: Models, source: HTMLCanvasElement): Found[] {
  const { width, height } = source;
  if (Math.max(width, height) >= cfg.faceMinSide) {
    return detectFaces(m, source).filter((f) => f.score >= cfg.faceScoreMin);
  }
  const fit = fitLongSide(width, height, cfg.faceMinSide, true);
  let scaled: HTMLCanvasElement | null = null;
  try {
    const c = canvasOf(fit.width, fit.height);
    scaled = c.canvas;
    c.ctx.drawImage(source, 0, 0, fit.width, fit.height);
    return detectFaces(m, scaled)
      .filter((f) => f.score >= cfg.faceScoreMin)
      .map((f) => ({ ...f, box: scaleBox(f.box, 1 / fit.scale) }));
  } finally {
    release(scaled);
  }
}

/** 출구 재검사(FR-055): 보낼 JPEG를 디코딩해 BlazeFace 1회. 오류는 error로(0으로 두지 않는다). */
async function exitCheck(m: Models, blob: Blob): Promise<FaceCheck> {
  let bitmap: ImageBitmap | null = null;
  let c: HTMLCanvasElement | null = null;
  try {
    bitmap = await createImageBitmap(blob);
    const made = canvasOf(bitmap.width, bitmap.height);
    c = made.canvas;
    made.ctx.drawImage(bitmap, 0, 0);
    return { status: 'checked', detectedFaces: facesOn(m, c).length };
  } catch (e) {
    console.warn('[vision] 출구 재검사 실패', e);
    return { status: 'error', detectedFaces: null };
  } finally {
    lensStore.getState().recordRuns({ faceDetectRuns: 1 });
    bitmap?.close();
    release(c);
  }
}

type Protected =
  | { kind: 'hold'; branch: '2d' | null; reason: string; detections?: NewDetection[] }
  | {
      kind: 'ok';
      crop: HTMLCanvasElement;
      cropRect: Box;
      objectLabel: string;
      branch: Exclude<ProtectedBranch, '2d'>;
      detections: NewDetection[];
      facesMasked: number;
    };

/**
 * 원본 프레임에서 이번 틱의 대상을 다시 찾고(FR-013) +10% 원본 해상도로 잘라(FR-011) 얼굴 검출·분기·가림까지(FR-014~017).
 * 'ok'의 crop은 이미 가린 조각이고 호출자가 비운다. 그 밖의 경로에서는 여기서 비운다.
 */
function protect(m: Models, frame: HTMLCanvasElement, objectLabel: string, targetBox: Box): Protected {
  const W = frame.width;
  const H = frame.height;
  const found = detectObjects(m, frame);
  lensStore.getState().recordRuns({ stage0Runs: 1 });
  const target = matchTarget(found, objectLabel, scaleBox(targetBox, W, H), cfg.recheckTargetScoreMin);
  if (!target) return { kind: 'hold', branch: null, reason: '대상 재검출 실패' };
  const cropRect = clampToFrame(expand(target.box, cfg.targetExpand), W, H);
  if (cropRect.w < 2 || cropRect.h < 2) return { kind: 'hold', branch: null, reason: '대상 재검출 실패' };
  const persons = found.filter((f) => f.label === 'person' && f.score >= cfg.safetyPersonScoreMin);

  const { canvas: crop, ctx } = canvasOf(cropRect.w, cropRect.h);
  let keep = false;
  try {
    ctx.drawImage(frame, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, cropRect.w, cropRect.h);
    let faces: Found[];
    try {
      faces = facesOn(m, crop).map((f) => ({ ...f, box: translate(f.box, cropRect.x, cropRect.y) }));
    } catch (e) {
      console.warn('[vision] 가림용 얼굴 검출 실패', e);
      return { kind: 'hold', branch: '2d', reason: '검사 실패' };
    } finally {
      lensStore.getState().recordRuns({ faceDetectRuns: 1 });
    }
    const r = decideBranch(cropRect, persons, faces);
    if (r.branch === '2d') return { kind: 'hold', branch: '2d', reason: r.reason, detections: r.detections };
    for (const mask of r.masks) {
      pixelate(ctx, clampToFrame(translate(mask.rect, -cropRect.x, -cropRect.y), cropRect.w, cropRect.h), cfg.pixelGrid);
    }
    keep = true;
    const facesMasked = r.detections.filter((d) => d.masked !== 'none').length;
    return { kind: 'ok', crop, cropRect, objectLabel: target.label, branch: r.branch, detections: r.detections, facesMasked };
  } finally {
    if (!keep) release(crop);
  }
}

/** 긴 변 maxSide로 줄여(크면) JPEG. 줄인 캔버스는 바로 비운다. maxSide가 null이면 원본 크기 그대로. */
async function encode(source: HTMLCanvasElement, maxSide: number | null, quality: number) {
  if (maxSide === null) return { blob: await toJpeg(source, quality), width: source.width, height: source.height };
  const fit = fitLongSide(source.width, source.height, maxSide);
  if (fit.scale === 1) return { blob: await toJpeg(source, quality), width: source.width, height: source.height };
  const { canvas, ctx } = canvasOf(fit.width, fit.height);
  try {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, fit.width, fit.height);
    return { blob: await toJpeg(canvas, quality), width: fit.width, height: fit.height };
  } finally {
    release(canvas);
  }
}

async function runCapture(t: Stage0Tick, decision: SceneDecision, objectLabel: string, targetBox: Box, targets: CaptureTarget[]) {
  const startedAt = performance.now();
  const store = lensStore.getState();
  const token: Token = { sessionId: store.session.id, inputEpoch: t.inputEpoch };
  const scene = decision.label;
  /** 시작 때 쿨다운을 예약하고(05 결정 17), 버린 포착이면 원래 값으로 되돌린다. */
  const previousCooldown = new Map<string, number>();
  /** 쿨다운을 확정할 플러그인(전달·보류·재검출 실패). */
  const cooled = new Set<string>();
  for (const c of targets) {
    previousCooldown.set(c.pluginId, store.plugins[c.pluginId]?.cooldownUntil ?? 0);
    store.setPluginBusy(c.pluginId, true, cooldownUntil(startedAt, c.maxPerMinute));
  }

  /** 지금도 같은 세대일 때만 보류 로그를 쓰고 쿨다운을 확정한다. */
  const holdIfCurrent = (c: CaptureTarget, branch: '2d' | null, reason: string, detections?: readonly NewDetection[]) => {
    if (!stillCurrent(token, c)) return;
    hold(c.pluginId, decision.id, branch, reason, detections);
    cooled.add(c.pluginId);
  };

  let frame: HTMLCanvasElement | null = null;
  let crop: HTMLCanvasElement | null = null;
  try {
    const v = getVideo();
    const m = getModels();
    if (!v || !m || v.videoWidth === 0 || getInputEpoch() !== token.inputEpoch) return;
    const W = v.videoWidth;
    const H = v.videoHeight;
    const f = canvasOf(W, H);
    frame = f.canvas;
    f.ctx.drawImage(v, 0, 0, W, H);

    const raws = targets.filter((c) => c.raw);
    const prots = targets.filter((c) => !c.raw);
    const p = prots.length > 0 ? protect(m, frame, objectLabel, targetBox) : null;
    if (p?.kind === 'ok') crop = p.crop;
    // 비교 모드(F17, 05 결정 30): 원본 해상도 그대로 한 번 인코딩한 뒤 원본 프레임을 놓는다.
    const rawBlob = raws.length > 0 ? await encode(frame, null, cfg.rawQuality) : null;
    release(frame);
    frame = null;

    if (p?.kind === 'hold') {
      for (const c of prots) holdIfCurrent(c, p.branch, p.reason, p.detections);
    } else if (p?.kind === 'ok') {
      for (const c of prots) {
        const out = await encode(p.crop, c.maxSide, c.quality);
        const check = await exitCheck(m, out.blob);
        if (check.status === 'error') {
          holdIfCurrent(c, '2d', '검사 실패', p.detections);
          continue;
        }
        if (check.detectedFaces > 0) {
          holdIfCurrent(c, '2d', '출구 재검사', p.detections);
          continue;
        }
        if (!stillCurrent(token, c)) continue;
        const d = await deliver(
          {
            pluginId: c.pluginId,
            manifestVersion: c.manifestVersion,
            runtimeId: c.runtimeId,
            scene,
            objectLabel: p.objectLabel,
            branch: p.branch,
            width: out.width,
            height: out.height,
            areaRatio: (p.cropRect.w * p.cropRect.h) / (W * H),
            cropRect: p.cropRect,
            facesMasked: p.facesMasked,
            faceCheck: check,
            blob: out.blob,
          },
          { sceneDecisionId: decision.id },
          p.detections,
        );
        if (d) cooled.add(c.pluginId);
      }
      release(crop);
      crop = null;
    }

    if (rawBlob) {
      const check = await exitCheck(m, rawBlob.blob);
      for (const c of raws) {
        if (check.status === 'error') {
          holdIfCurrent(c, '2d', '검사 실패');
          continue;
        }
        if (!stillCurrent(token, c)) continue;
        // 비교 모드는 얼굴이 있어도 보내고 센다(M·K 측정). raw 조건은 prepareDelivery가 마지막으로 본다(G1).
        const d = await deliver(
          {
            pluginId: c.pluginId,
            manifestVersion: c.manifestVersion,
            runtimeId: c.runtimeId,
            scene,
            objectLabel,
            branch: 'raw',
            width: rawBlob.width,
            height: rawBlob.height,
            areaRatio: 1,
            cropRect: { x: 0, y: 0, w: W, h: H },
            facesMasked: 0,
            faceCheck: check,
            blob: rawBlob.blob,
          },
          { sceneDecisionId: decision.id },
        );
        if (d) cooled.add(c.pluginId);
      }
    }
  } finally {
    release(frame);
    release(crop);
    const s = lensStore.getState();
    const endedAt = performance.now();
    for (const c of targets) {
      // 새 세션이면 스토어가 이미 busy·쿨다운을 되돌렸다. 그 세대의 쿨다운은 건드리지 않고 busy만 확실히 내린다.
      if (s.session.id !== token.sessionId) {
        s.setPluginBusy(c.pluginId, false);
        continue;
      }
      // FR-012: 전달은 끝날 때 일어나므로 간격은 끝난 시각부터 센다. 시작 때 예약한 값보다 앞당기지 않는다.
      // 전환으로 버린 포착(cooled 아님)은 예약 전 값으로 되돌린다.
      const next = cooled.has(c.pluginId) ? Math.max(cooldownUntil(startedAt, c.maxPerMinute), cooldownUntil(endedAt, c.maxPerMinute)) : (previousCooldown.get(c.pluginId) ?? 0);
      s.setPluginBusy(c.pluginId, false, next);
    }
  }
}
