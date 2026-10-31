// 2단계 분기 결정(03-SRS §4.2, FR-013~018). DOM·모델 없이 도는 순수 함수다.
// 입력 좌표는 모두 원본 프레임 px. 돌려주는 Detection 박스만 조각 기준 0~1이다.

import type { Box } from '../core/types';
import type { NewDetection } from '../core/store';
import { VISION_CONFIG, type VisionConfig } from './config';
import { area, center, expand, intersect, type Found } from './geometry';

export type ProtectedBranch = '2a' | '2b' | '2c' | '2d';

export interface MaskRect {
  /** body = 코디 스캔 조각 안의 동의하지 않은 사람 몸 전체(docs/designs/outfit-pipelines.md). */
  kind: 'face' | 'head' | 'body';
  /** 원본 프레임 px. 조각 밖으로 나갈 수 있다(가릴 때 조각 안으로 자른다). */
  rect: Box;
}

export interface BranchResult {
  branch: ProtectedBranch;
  /** 2d일 때 로그 사유. 아니면 ''. */
  reason: string;
  masks: MaskRect[];
  detections: NewDetection[];
}

/** 사람 박스 위쪽 headTop에 좌우 headSide 여유를 더한 머리 영역(FR-016). */
export function headRegion(person: Box, cfg: VisionConfig = VISION_CONFIG): Box {
  return { x: person.x - person.w * cfg.headSide, y: person.y, w: person.w * (1 + 2 * cfg.headSide), h: person.h * cfg.headTop };
}

const inside = (pt: { cx: number; cy: number }, b: Box) => pt.cx >= b.x && pt.cx <= b.x + b.w && pt.cy >= b.y && pt.cy <= b.y + b.h;

/** 박스를 조각 기준 0~1로 바꾸고 조각 안으로 자른다. */
function toCropUnit(b: Box, crop: Box): Box {
  const c = intersect(b, crop);
  return { x: (c.x - crop.x) / crop.w, y: (c.y - crop.y) / crop.h, w: c.w / crop.w, h: c.h / crop.h };
}

/**
 * 결정표:
 * - O = 사람 ∩ 조각 > 조각 × overlapMin, P = 사람 ∩ 조각 ≥ 조각 × holdOverlap, F = 얼굴(신뢰도는 호출자가 거름)
 * - 얼굴은 중심이 그 사람의 머리 영역(위 headTop + 좌우 headSide) 안에 있을 때만 그 사람에 대응한다.
 *   몸통 앞의 다른 얼굴(옷·사진·뒤 사람)을 그 사람 얼굴로 착각해 옆얼굴을 놓치지 않기 위해서다. 둘 이상에 들어 있으면 대응 불확실 → 2d
 * - O인 사람마다: 대응 얼굴 있음 → 얼굴 가림(R2), 없고 P → 2d(R4), 없고 P 아님 → 머리 영역 가림(R3)
 * - 사람에 대응되지 않은 얼굴도 가린다(R5)
 * - 하나라도 2d면 조각 전체 2d. 아니면 머리 가림 → 2c, 얼굴 가림 → 2b, 없음 → 2a
 * - body(코디 스캔): 이 집합의 사람은 조각과 조금이라도 겹치면 사람 박스 전체를 가린다. 몸 전체를 가리므로 R3·R4를 보지 않는다.
 *   얼굴 가림(R2·R5)과 얼굴-사람 대응 불확실 보류는 그대로다. 몸 가림만 있으면(얼굴·머리 없음) 2b.
 */
export function decideBranch(
  crop: Box,
  persons: readonly Found[],
  faces: readonly Found[],
  cfg: VisionConfig = VISION_CONFIG,
  body: ReadonlySet<Found> = new Set(),
): BranchResult {
  const cropArea = area(crop);
  const masks: MaskRect[] = [];
  const detections: NewDetection[] = [];
  let holdReason = '';

  const faceOwners = faces.map((f) => persons.filter((p) => inside(center(f.box), headRegion(p.box, cfg))));
  if (faceOwners.some((owners) => owners.length > 1)) holdReason = '얼굴-사람 대응 불확실';

  for (const p of persons) {
    const overlap = cropArea > 0 ? area(intersect(p.box, crop)) / cropArea : 0;
    if (overlap <= 0) continue;
    if (body.has(p)) {
      masks.push({ kind: 'body', rect: p.box });
      detections.push({ kind: 'person', box: toCropUnit(p.box, crop), score: p.score, overlap, masked: 'body' });
      continue;
    }
    const hasFace = faceOwners.some((owners) => owners.includes(p));
    let masked: 'none' | 'head' = 'none';
    if (overlap > cfg.overlapMin && !hasFace) {
      if (overlap >= cfg.holdOverlap) {
        if (!holdReason) holdReason = '사람 겹침 50% 이상(얼굴 없음)';
      } else {
        masks.push({ kind: 'head', rect: headRegion(p.box, cfg) });
        masked = 'head';
      }
    }
    detections.push({ kind: 'person', box: toCropUnit(p.box, crop), score: p.score, overlap, masked });
  }

  for (const f of faces) {
    masks.push({ kind: 'face', rect: expand(f.box, cfg.faceExpand) });
    detections.push({ kind: 'face', box: toCropUnit(f.box, crop), score: f.score, overlap: null, masked: 'face' });
  }

  if (holdReason) {
    // 보류면 아무것도 가리지 않고 보내지도 않는다. 기록의 masked도 none.
    return { branch: '2d', reason: holdReason, masks: [], detections: detections.map((d) => ({ ...d, masked: 'none' })) };
  }
  const branch: ProtectedBranch = masks.some((m) => m.kind === 'head') ? '2c' : masks.length > 0 ? '2b' : '2a';
  return { branch, reason: '', masks, detections };
}

/** FR-012: 포착을 시작한 시각부터 60 / maxPerMinute 초. */
export function cooldownUntil(startedAt: number, maxPerMinute: number): number {
  return startedAt + 60_000 / maxPerMinute;
}
