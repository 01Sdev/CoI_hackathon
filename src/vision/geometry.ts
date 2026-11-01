// 좌표 계산과 장면 선택. DOM·모델 없이 도는 순수 함수라 scripts/check-runtime.ts가 경계를 확인한다.
// 단위는 인자마다 같기만 하면 된다(px 또는 0~1). 함수 설명에 따로 적은 것만 예외다.

import type { Box, SceneLabel } from '../core/types';
import { FOOD_LABELS, VISION_CONFIG, type VisionConfig } from './config';

/** 검출 한 건. box는 그 검출을 돌린 이미지의 px. */
export interface Found {
  label: string;
  score: number;
  box: Box;
}

export const area = (b: Box): number => Math.max(0, b.w) * Math.max(0, b.h);

export function intersect(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const btm = Math.min(a.y + a.h, b.y + b.h);
  return { x, y, w: Math.max(0, r - x), h: Math.max(0, btm - y) };
}

/** 변마다 ratio만큼 넓힌다(K-09 "변마다"). */
export function expand(b: Box, ratio: number): Box {
  const dx = b.w * ratio;
  const dy = b.h * ratio;
  return { x: b.x - dx, y: b.y - dy, w: b.w + 2 * dx, h: b.h + 2 * dy };
}

/** 0,0,width,height 안으로 자르고 정수 px로 맞춘다. 바깥쪽으로 반올림해 덜 자르지 않는다. */
export function clampToFrame(b: Box, width: number, height: number): Box {
  const x0 = Math.max(0, Math.floor(b.x));
  const y0 = Math.max(0, Math.floor(b.y));
  const x1 = Math.min(width, Math.ceil(b.x + b.w));
  const y1 = Math.min(height, Math.ceil(b.y + b.h));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

export const scaleBox = (b: Box, sx: number, sy: number = sx): Box => ({
  x: b.x * sx,
  y: b.y * sy,
  w: b.w * sx,
  h: b.h * sy,
});

export const translate = (b: Box, dx: number, dy: number): Box => ({ ...b, x: b.x + dx, y: b.y + dy });

export const center = (b: Box) => ({ cx: b.x + b.w / 2, cy: b.y + b.h / 2 });

/** 긴 변을 longSide에 맞춘 크기(비율 유지, 정수). 이미 작으면 allowUpscale이 false일 때 그대로 둔다. */
export function fitLongSide(width: number, height: number, longSide: number, allowUpscale = false) {
  const long = Math.max(width, height);
  if (long === 0) return { width: 0, height: 0, scale: 1 };
  const scale = !allowUpscale && long <= longSide ? 1 : longSide / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

/** 박스 중심이 가운데 region(가로·세로 각각) 안에 있는가. */
export function inCenterRegion(b: Box, width: number, height: number, region: number): boolean {
  const { cx, cy } = center(b);
  const mx = (width * (1 - region)) / 2;
  const my = (height * (1 - region)) / 2;
  return cx >= mx && cx <= width - mx && cy >= my && cy <= height - my;
}

export interface SceneView {
  label: SceneLabel;
  /** label이 none이면 null. */
  target: Found | null;
  /** 화면 속 사람 수 N(stage0ScoreMin 이상, 영역 필터 없음). */
  peopleCount: number;
}

/**
 * FR-007: 가운데 60% 안에서 음식이 사람보다 우선, 같은 종류끼리는 중심에 가까운 쪽.
 * 사람은 프레임 면적 personMinArea 이상일 때만 대상. 이 필터는 장면 선택에만 쓴다(안전 검사 아님).
 * wanted가 있으면 그 장면만 고른다(켜진 앱이 받는 장면). 코디 스캔만 켜져 있을 때 가운데 컵·병이 사람 장면을 막지 않게 한다.
 */
export function classifyScene(
  found: readonly Found[],
  width: number,
  height: number,
  cfg: VisionConfig = VISION_CONFIG,
  wanted: ReadonlySet<SceneLabel> | null = null,
): SceneView {
  const frameArea = width * height;
  const fx = width / 2;
  const fy = height / 2;
  const dist = (f: Found) => {
    const { cx, cy } = center(f.box);
    return (cx - fx) ** 2 + (cy - fy) ** 2;
  };
  const closest = (list: Found[]) => list.reduce<Found | null>((best, f) => (!best || dist(f) < dist(best) ? f : best), null);

  const strong = found.filter((f) => f.score >= cfg.stage0ScoreMin);
  const people = strong.filter((f) => f.label === 'person');
  const inRegion = strong.filter((f) => inCenterRegion(f.box, width, height, cfg.centerRegion));

  const food = !wanted || wanted.has('food') ? closest(inRegion.filter((f) => FOOD_LABELS.includes(f.label))) : null;
  if (food) return { label: 'food', target: food, peopleCount: people.length };
  const person =
    !wanted || wanted.has('person')
      ? closest(inRegion.filter((f) => f.label === 'person' && area(f.box) >= cfg.personMinArea * frameArea))
      : null;
  if (person) return { label: 'person', target: person, peopleCount: people.length };
  return { label: 'none', target: null, peopleCount: people.length };
}

/**
 * 동의한 사람 이어 보기(코디 스캔). 이번 틱 장면이 none이고 person 장면을 받는 앱이 켜져 있으면, 살아 있는 동의의 사람이
 * 보일 때 그 사람(가장 가운데)을 person 대상으로 둔다. 사람 점수가 장면 기준(0.4) 근처에서 오르내리면 person 장면이 1초를
 * 잇지 못해, 동의를 받고도 코디 스캔에 조각이 가지 않았다("아직 보낼 사진이 없어요"). 음식 장면과 이미 잡힌 person 대상은 그대로다.
 * consented 박스는 view와 같은 px. 동의 없이 보내는 길은 없다(포착이 동의를 다시 본다).
 */
export function withConsentedPerson(
  view: SceneView,
  consented: readonly Found[],
  width: number,
  height: number,
  wanted: ReadonlySet<SceneLabel> | null = null,
): SceneView {
  if (view.label !== 'none' || consented.length === 0 || (wanted && !wanted.has('person'))) return view;
  const d = (f: Found) => {
    const { cx, cy } = center(f.box);
    return (cx - width / 2) ** 2 + (cy - height / 2) ** 2;
  };
  const target = consented.reduce((best, f) => (d(f) < d(best) ? f : best));
  return { label: 'person', target, peopleCount: view.peopleCount };
}

/** 포착 프레임 재검출 결과에서 0단계 대상과 같은 물체를 고른다. 같은 라벨 중 hint(같은 단위)와 가장 많이 겹치거나 중심이 가까운 것. */
export function matchTarget(found: readonly Found[], objectLabel: string, hint: Box, minScore: number): Found | null {
  const same = found.filter((f) => f.label === objectLabel && f.score >= minScore);
  if (same.length === 0) return null;
  const h = center(hint);
  let best: Found | null = null;
  let bestKey = -Infinity;
  for (const f of same) {
    const inter = area(intersect(f.box, hint));
    const iou = inter / (area(f.box) + area(hint) - inter || 1);
    const c = center(f.box);
    // IoU가 같으면(둘 다 0 등) 중심 거리로 고른다.
    const key = iou * 1e6 - Math.hypot(c.cx - h.cx, c.cy - h.cy);
    if (key > bestKey) {
      bestKey = key;
      best = f;
    }
  }
  return best;
}

