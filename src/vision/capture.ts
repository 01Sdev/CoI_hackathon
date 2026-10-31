// 1단계 포착·2단계 가림·분기·출구 재검사(F3·F4). 근거: 03-SRS FR-010~018·FR-055, §4.1·§4.2, 02-SSRD IF-02,
// docs/designs/track-a-runtime.md §2.5~2.7.
// 원본 프레임은 이 파일 안에서만 만들고 조각을 자르자마자 놓는다(비교 모드는 raw 인코딩 직후). 가리기 전 조각은 가림 단계에서
// 덮어쓴다. 작업 캔버스는 모든 경로(보류·예외 포함)에서 finally로 비운다. 플러그인에는 broker의 deliver만 쓴다.

import { cropToFramePx, frameToPx } from '../core/frame';
import { lensStore, type NewDetection } from '../core/store';
import type { Box, FaceCheck, SceneDecision } from '../core/types';
import { deliver, hold, skip } from '../broker/broker';
import { getInputEpoch, getVideo } from '../input/adapter';
import { cooldownUntil, decideBranch, type ProtectedBranch } from './branch';
import { VISION_CONFIG } from './config';
import { clampToFrame, expand, fitLongSide, matchTarget, scaleBox, translate, type Found } from './geometry';
import { canvasOf, pixelate, pixelateShaped, release, toJpeg } from './mask';
import { segmentCategories } from './segmenter';
import { dilateRadius, shapeMask } from './shape';
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
  | { kind: 'hold'; branch: '2d' | null; reason: string; detections?: NewDetection[]; frameRect?: Box }
  | {
      kind: 'ok';
      crop: HTMLCanvasElement;
      cropRect: Box;
      objectLabel: string;
      branch: Exclude<ProtectedBranch, '2d'>;
      detections: NewDetection[];
      facesMasked: number;
      /** Selfie 모양으로 가린 사각형 수(나머지는 사각형 전체). */
      shaped: number;
    };

/**
 * 2b·2c 가림. Selfie가 준비돼 있으면 조각에서 한 번 돌려 사각형마다 머리카락·얼굴 피부 픽셀(팽창)만 가린다(FR-016a).
 * Selfie가 없거나, 실패하거나, 그 사각형에서 픽셀을 못 찾거나, 그 종류의 모양 가림이 꺼져 있으면 사각형 전체(FR-015·016).
 * Selfie는 가리기 전 조각을 보므로 가림보다 먼저 한 번만 돌린다. 2a(가림 없음)에는 돌리지 않는다.
 */
function applyMasks(ctx: CanvasRenderingContext2D, crop: HTMLCanvasElement, cropRect: Box, masks: ReturnType<typeof decideBranch>['masks']): number {
  if (masks.length === 0) return 0;
  const wantShape = masks.some((m) => (m.kind === 'face' ? cfg.selfieShapeFace : cfg.selfieShapeHead));
  const seg = wantShape ? segmentCategories(crop) : null;
  const radius = dilateRadius(cropRect.w, cropRect.h, cfg.selfieDilateRatio, cfg.selfieDilateMinPx);
  let shaped = 0;
  // 모든 모양을 가리기 전 조각에서 먼저 정한다(앞 사각형의 픽셀화가 뒤 사각형 판정에 섞이지 않게).
  const plans = masks.map((mask) => {
    const rect = clampToFrame(translate(mask.rect, -cropRect.x, -cropRect.y), cropRect.w, cropRect.h);
    const on = mask.kind === 'face' ? cfg.selfieShapeFace : cfg.selfieShapeHead;
    const shape = seg && on ? shapeMask(seg.categories, seg.width, seg.height, cropRect.w, cropRect.h, rect, radius, cfg.selfieClasses) : null;
    return { rect, shape };
  });
  for (const { rect, shape } of plans) {
    if (shape) {
      pixelateShaped(ctx, rect, cfg.pixelGrid, shape);
      shaped += 1;
    } else {
      pixelate(ctx, rect, cfg.pixelGrid);
    }
  }
  return shaped;
}

/**
 * 원본 프레임 전체에서 이번 틱의 대상과 사람을 다시 찾고(FR-013), 대상 박스를 +10% 넓혀 전송 범위 프레임과 겹치는 부분만
 * 원본 해상도로 잘라(FR-011·060) 얼굴 검출·분기·가림까지(FR-014~017). 프레임 밖 픽셀은 조각 캔버스에 그리지 않는다.
 * 'ok'의 crop은 이미 가린 조각이고 호출자가 비운다. 그 밖의 경로에서는 여기서 비운다.
 */
function protect(m: Models, frame: HTMLCanvasElement, objectLabel: string, targetBox: Box, frameRect: Box): Protected {
  const W = frame.width;
  const H = frame.height;
  const found = detectObjects(m, frame);
  lensStore.getState().recordRuns({ stage0Runs: 1 });
  const target = matchTarget(found, objectLabel, scaleBox(targetBox, W, H), cfg.recheckTargetScoreMin);
  if (!target) return { kind: 'hold', branch: null, reason: '대상 재검출 실패' };
  // core cropToFramePx: 넓힌 박스 ∩ frameRect를 안쪽 정수 px로(늘 frameRect 안, prepareDelivery도 같은 조건을 본다).
  // frameRect는 원본 안이므로(clampFrame) cropRect도 원본 안이다. 한 변 2px 미만의 띠는 보낼 조각이 아니라서 "프레임 밖"으로 친다.
  const cropRect = cropToFramePx(expand(target.box, cfg.targetExpand), frameRect);
  if (!cropRect || cropRect.w < 2 || cropRect.h < 2) return { kind: 'hold', branch: null, reason: '프레임 밖', frameRect };
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
    const shaped = applyMasks(ctx, crop, cropRect, r.masks);
    keep = true;
    const facesMasked = r.detections.filter((d) => d.masked !== 'none').length;
    return { kind: 'ok', crop, cropRect, objectLabel: target.label, branch: r.branch, detections: r.detections, facesMasked, shaped };
  } finally {
    if (!keep) release(crop);
  }
}

/** 긴 변 maxSide로 줄여(크면) JPEG. 줄인 캔버스는 바로 비운다. */
async function encode(source: HTMLCanvasElement, maxSide: number, quality: number) {
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

/** 원본 프레임에서 region(정수 px)만 원본 해상도로 JPEG. 사본 캔버스는 바로 비운다. */
async function encodeRegion(source: HTMLCanvasElement, region: Box, quality: number) {
  const { canvas, ctx } = canvasOf(region.w, region.h);
  try {
    ctx.drawImage(source, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
    return { blob: await toJpeg(canvas, quality), width: region.w, height: region.h };
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

  /** F24: 포착을 시작할 때 한 번 읽고 이 포착 끝까지 쓴다(0~1, 원본 px는 크기를 안 뒤에). */
  const captureFrame = store.session.captureFrame;

  /** 지금도 같은 세대일 때만 보류 로그를 쓰고 쿨다운을 확정한다. */
  const holdIfCurrent = (c: CaptureTarget, branch: '2d' | null, reason: string, detections?: readonly NewDetection[], frameRect?: Box) => {
    if (!stillCurrent(token, c)) return;
    hold(c.pluginId, decision.id, branch, reason, detections, frameRect);
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
    const frameRect = frameToPx(captureFrame, W, H);

    const raws = targets.filter((c) => c.raw);
    const prots = targets.filter((c) => !c.raw);
    const p = prots.length > 0 ? protect(m, frame, objectLabel, targetBox, frameRect) : null;
    if (p?.kind === 'ok') crop = p.crop;
    // 비교 모드(F17, 05 결정 30, F24): 프레임 안 전체를 원본 해상도로, 가리지 않고 한 번 인코딩한 뒤 원본 프레임을 놓는다.
    const rawBlob = raws.length > 0 ? await encodeRegion(frame, frameRect, cfg.rawQuality) : null;
    release(frame);
    frame = null;

    if (p?.kind === 'hold') {
      for (const c of prots) holdIfCurrent(c, p.branch, p.reason, p.detections, p.frameRect);
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
            frameRect,
            facesMasked: p.facesMasked,
            faceCheck: check,
            blob: out.blob,
          },
          { sceneDecisionId: decision.id, reason: p.shaped > 0 ? `Selfie 모양 가림 ${p.shaped}/${p.facesMasked}` : '' },
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
            areaRatio: (frameRect.w * frameRect.h) / (W * H),
            cropRect: frameRect,
            frameRect,
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
