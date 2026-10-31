// 트랙 A assertion 스크립트. 실행: npm run check:runtime
// DOM·모델 없이 도는 경계 함수만 본다(AGENTS.md "테스트"). 실기기 확인은 /dev/ 페이지와 05의 V 표.

import assert from 'node:assert/strict';
import { VISION_CONFIG } from '../src/vision/config';
import { area, clampToFrame, classifyScene, expand, fitLongSide, inCenterRegion, intersect, matchTarget, scaleBox, type Found } from '../src/vision/geometry';
import { containsBox, cropToFramePx, frameToPx } from '../src/core/frame';
import { CAPTURE_FRAME_DEFAULT } from '../src/core/constants';
import { SCENE_NONE, stepScene, type SceneState } from '../src/vision/scene';
import { cooldownUntil, decideBranch, headRegion, uncoveredFaces } from '../src/vision/branch';
import { planCapture } from '../src/vision/plan';
import { selectActiveConsents } from '../src/core/selectors';
import { sha256HexSync } from '../src/broker/sha256';
import { blendMasked, dilate, dilateRadius, shapeMask } from '../src/vision/shape';
import { createLensStore } from '../src/core/store';
import { SCRIBE, WIDE_WARP } from '../src/input/config';
import { openWithFallback, type OpenIo } from '../src/input/adapter';
import { runScribe, scribeUrl, type MicPipe, type ScribeDeps, type ScribeError, type SocketLike } from '../src/input/scribe';
import { applyCpuMap, buildCpuMap, sourceBoxToWarped, sourceUv, warpedBoxToSource, warpedXY, warpOutputSize, warpParams, type WarpSettings } from '../src/input/warp';
import { gazeHeld, matchBoxes, pickConsent, pickGazeTarget, stepGaze, stepTracks, type Track } from '../src/vision/track';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`ok  ${name}`);
}

const f = (label: string, x: number, y: number, w: number, h: number, score = 0.9): Found => ({ label, score, box: { x, y, w, h } });

// ── 좌표 ──
check('intersect: 겹침 넓이와 안 겹침 0', () => {
  assert.equal(area(intersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })), 25);
  assert.equal(area(intersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 5, h: 5 })), 0);
});

check('expand: 변마다 10%', () => {
  assert.deepEqual(expand({ x: 100, y: 100, w: 100, h: 50 }, 0.1), { x: 90, y: 95, w: 120, h: 60 });
});

check('clampToFrame: 프레임 밖은 자르고 바깥쪽으로 반올림', () => {
  assert.deepEqual(clampToFrame({ x: -5.5, y: 10.2, w: 50.6, h: 1000 }, 640, 360), { x: 0, y: 10, w: 46, h: 350 });
});

check('fitLongSide: 16:9 → 640×360, 9:16 → 360×640, 4:3 → 640×480, 작으면 그대로', () => {
  assert.deepEqual(fitLongSide(1280, 720, 640), { width: 640, height: 360, scale: 0.5 });
  assert.deepEqual(fitLongSide(720, 1280, 640), { width: 360, height: 640, scale: 0.5 });
  assert.deepEqual(fitLongSide(1280, 960, 640), { width: 640, height: 480, scale: 0.5 });
  assert.deepEqual(fitLongSide(320, 240, 640), { width: 320, height: 240, scale: 1 });
  assert.equal(fitLongSide(100, 50, 256, true).width, 256);
});

check('inCenterRegion: 가운데 60% 경계(중심 기준)', () => {
  // 640×360에서 영역은 x 128..512, y 72..288.
  assert.equal(inCenterRegion({ x: 119, y: 100, w: 20, h: 20 }, 640, 360, 0.6), true); // 중심 x=129
  assert.equal(inCenterRegion({ x: 117, y: 100, w: 20, h: 20 }, 640, 360, 0.6), false); // 중심 x=127
  assert.equal(inCenterRegion({ x: 300, y: 279, w: 20, h: 20 }, 640, 360, 0.6), false); // 중심 y=289
  assert.equal(inCenterRegion({ x: 300, y: 267, w: 20, h: 20 }, 640, 360, 0.6), true); // 중심 y=277
});

// ── 장면 선택(FR-007) ──
check('음식이 사람보다 우선', () => {
  const v = classifyScene([f('person', 200, 50, 240, 300), f('pizza', 280, 160, 80, 60)], 640, 360);
  assert.equal(v.label, 'food');
  assert.equal(v.target?.label, 'pizza');
  assert.equal(v.peopleCount, 1);
});

check('가운데 60% 밖 음식은 none', () => {
  const v = classifyScene([f('pizza', 0, 0, 40, 40)], 640, 360);
  assert.equal(v.label, 'none');
});

check('5% 미만 사람만 있으면 none, N은 센다', () => {
  // 640×360 = 230400, 5% = 11520. 100×110 = 11000.
  const small = classifyScene([f('person', 270, 120, 100, 110)], 640, 360);
  assert.equal(small.label, 'none');
  assert.equal(small.peopleCount, 1);
  const big = classifyScene([f('person', 270, 120, 100, 116)], 640, 360);
  assert.equal(big.label, 'person');
});

check('같은 종류는 중심에 가까운 쪽', () => {
  const v = classifyScene([f('apple', 150, 100, 40, 40), f('donut', 300, 160, 40, 40)], 640, 360);
  assert.equal(v.target?.label, 'donut');
});

check('stage0ScoreMin 아래는 무시', () => {
  const v = classifyScene([f('pizza', 280, 160, 80, 60, VISION_CONFIG.stage0ScoreMin - 0.01)], 640, 360);
  assert.equal(v.label, 'none');
});

check('음식 라벨이 아닌 물체는 none', () => {
  assert.equal(classifyScene([f('laptop', 280, 160, 80, 60)], 640, 360).label, 'none');
});

// ── 장면 상태기계(§4.1) ──
const run = (labels: Array<'food' | 'person' | 'none'>, dt: number) => {
  let s: SceneState = SCENE_NONE;
  const confirms: number[] = [];
  labels.forEach((l, i) => {
    const r = stepScene(s, l, i * dt, VISION_CONFIG.confirmMs);
    s = r.next;
    if (r.confirmed) confirms.push(i);
  });
  return { s, confirms };
};

check('1초 유지면 확정, 0.8초는 확정 안 됨', () => {
  // 200ms 간격: t=0..1000이면 6틱째(i=5)에 확정.
  assert.deepEqual(run(['food', 'food', 'food', 'food', 'food', 'food'], 200).confirms, [5]);
  assert.deepEqual(run(['food', 'food', 'food', 'food', 'food'], 200).confirms, []);
});

check('확정 뒤 같은 라벨은 다시 확정하지 않는다', () => {
  const r = run(['food', 'food', 'food', 'food', 'food', 'food', 'food', 'food'], 200);
  assert.deepEqual(r.confirms, [5]);
  assert.equal(r.s.kind, 'confirmed');
});

check('다른 라벨이 오면 후보부터, none이면 none', () => {
  const r = run(['food', 'food', 'food', 'person'], 400);
  assert.equal(r.s.kind, 'candidate');
  assert.equal(r.s.kind === 'candidate' && r.s.label, 'person');
  assert.equal(run(['food', 'food', 'food', 'food', 'none'], 400).s.kind, 'none');
});

// ── 대상 재검출 ──
check('matchTarget: 같은 라벨 중 hint와 가장 많이 겹치는 것', () => {
  const hint = { x: 100, y: 100, w: 50, h: 50 };
  const m = matchTarget([f('pizza', 400, 400, 50, 50), f('pizza', 110, 105, 50, 50), f('donut', 100, 100, 50, 50)], 'pizza', hint, 0.3);
  assert.equal(m?.box.x, 110);
  assert.equal(matchTarget([f('donut', 100, 100, 50, 50)], 'pizza', hint, 0.3), null);
  assert.equal(matchTarget([f('pizza', 100, 100, 50, 50, 0.2)], 'pizza', hint, 0.3), null);
});

// ── 분기 결정표(§4.2) ──
// 조각 100×100 at (100,100). 면적 10,000. 5% = 500, 50% = 5,000.
const crop = { x: 100, y: 100, w: 100, h: 100 };
const person = (x: number, y: number, w: number, h: number) => f('person', x, y, w, h);
const face = (x: number, y: number, w: number, h: number) => f('face', x, y, w, h);

check('R1 2a: 사람·얼굴 없음', () => {
  const r = decideBranch(crop, [], []);
  assert.equal(r.branch, '2a');
  assert.equal(r.masks.length, 0);
});

check('겹침 5% 경계: 정확히 5%는 O 아님(2a), 넘으면 O(2c)', () => {
  // 사람 박스가 조각과 100×5 = 500(5%) 겹침
  assert.equal(decideBranch(crop, [person(100, 195, 100, 200)], []).branch, '2a');
  // 100×5.1 = 510(5.1%)
  assert.equal(decideBranch(crop, [person(100, 194.9, 100, 200)], []).branch, '2c');
});

check('R2 2b: 겹치는 사람 + 그 사람 얼굴 → 얼굴만 가림', () => {
  const r = decideBranch(crop, [person(80, 80, 140, 300)], [face(130, 110, 30, 30)]);
  assert.equal(r.branch, '2b');
  assert.deepEqual(r.masks.map((m) => m.kind), ['face']);
  // 얼굴 박스 +15%(변마다)
  assert.deepEqual(r.masks[0]?.rect, { x: 125.5, y: 105.5, w: 39, h: 39 });
});

check('R3 2c: 겹침 5% 초과 50% 미만, 얼굴 없음 → 머리 영역 가림', () => {
  const p = person(150, 50, 100, 200); // 조각과 50×100 = 5,000? → 50% 이상이면 2d이므로 폭을 줄인다
  const p2 = person(160, 50, 100, 200); // 40×100 = 4,000(40%)
  assert.equal(decideBranch(crop, [p], []).branch, '2d');
  const r = decideBranch(crop, [p2], []);
  assert.equal(r.branch, '2c');
  assert.deepEqual(r.masks[0]?.rect, headRegion(p2.box));
  assert.deepEqual(headRegion(p2.box), { x: 150, y: 50, w: 120, h: 80 });
});

check('R4 2d: 겹침 50% 이상, 얼굴 없음 → 보류, 아무것도 가리지 않음', () => {
  const r = decideBranch(crop, [person(50, 50, 200, 400)], []);
  assert.equal(r.branch, '2d');
  assert.equal(r.masks.length, 0);
  assert.ok(r.detections.every((d) => d.masked === 'none'));
});

check('R5 2b: 사람과 안 겹친 얼굴도 가린다', () => {
  const r = decideBranch(crop, [], [face(120, 120, 20, 20)]);
  assert.equal(r.branch, '2b');
  assert.equal(r.masks.length, 1);
});

check('여러 사람: 한 명이라도 R4면 전체 2d', () => {
  const r = decideBranch(crop, [person(80, 80, 140, 300), person(0, 0, 400, 400)], [face(130, 110, 30, 30)]);
  // 얼굴 중심이 두 사람 박스 모두에 들어 있음 → 대응 불확실
  assert.equal(r.branch, '2d');
  const r2 = decideBranch(crop, [person(160, 50, 100, 200), person(40, 90, 100, 300)], []);
  // 둘째 사람: 겹침 40×100? (100..140)×(100..200) = 4,000 → 2c, 첫째도 2c
  assert.equal(r2.branch, '2c');
  const r3 = decideBranch(crop, [person(160, 50, 100, 200), person(20, 20, 200, 400)], []);
  assert.equal(r3.branch, '2d');
});

check('얼굴 대응 사람 + 다른 사람 머리 → 2c(둘 다 가림)', () => {
  const r = decideBranch(crop, [person(80, 80, 60, 300), person(170, 40, 100, 200)], [face(95, 110, 30, 30)]);
  assert.equal(r.branch, '2c');
  assert.deepEqual(r.masks.map((m) => m.kind).sort(), ['face', 'head']);
  assert.equal(r.detections.filter((d) => d.masked !== 'none').length, 2);
});

check('머리 영역 밖 얼굴(몸통 앞)은 그 사람 얼굴로 치지 않는다 → 얼굴 가림 + 그 사람 머리 가림', () => {
  // 사람 (160,0,100,400): 조각과 40% 겹침, 머리 영역 y 0..160. 얼굴 중심 (175,180)은 박스 안이지만 머리 영역 밖.
  const r = decideBranch(crop, [person(160, 0, 100, 400)], [face(165, 170, 20, 20)]);
  assert.equal(r.branch, '2c');
  assert.deepEqual(r.masks.map((m) => m.kind).sort(), ['face', 'head']);
  // 같은 얼굴이 머리 영역 안이면 그 사람 얼굴(R2)
  assert.equal(decideBranch(crop, [person(160, 0, 100, 400)], [face(165, 120, 20, 20)]).branch, '2b');
});

check('Detection 박스는 조각 기준 0~1로 자른다', () => {
  const r = decideBranch(crop, [person(160, 50, 100, 200)], []);
  const d = r.detections[0];
  assert.deepEqual(d?.box, { x: 0.6, y: 0, w: 0.4, h: 1 });
  assert.equal(d?.overlap, 0.4);
});

// ── 쿨다운(FR-012) ──
check('쿨다운: maxPerMinute 6 → 10초, 30 → 2초', () => {
  assert.equal(cooldownUntil(1000, 6), 11_000);
  assert.equal(cooldownUntil(0, 30), 2_000);
});

// ── 포착 게이트(§4.1) ──
function readyStore() {
  let t = 0;
  const st = createLensStore({ clock: () => t, revokeUrl: () => undefined, hostOrigin: 'https://h.test' });
  const s = st.getState();
  s.setPluginRuntime('calorie', { status: 'ready', runtimeId: 'rt-1', runtimePolicy: { connect: 'network', manifestVersion: 1 }, gateOpen: true });
  s.setPluginEnabled('hello', true);
  s.setPluginRuntime('hello', { status: 'ready', runtimeId: 'rt-h', runtimePolicy: { connect: 'network', manifestVersion: 1 }, gateOpen: true });
  return { st, setT: (v: number) => (t = v) };
}

check('게이트(F21): food면 calorie(256)·hello 장면 기록(64)이 각자 매니페스트대로, person이면 둘 다 skip', () => {
  const { st } = readyStore();
  const food = planCapture(st.getState(), 'food', 0);
  assert.deepEqual(food.capture.map((c) => [c.pluginId, c.maxSide]), [['calorie', 256], ['hello', 64]]);
  assert.deepEqual(food.undeclared, []);
  const person = planCapture(st.getState(), 'person', 0);
  assert.deepEqual(person.capture, []);
  assert.deepEqual(person.undeclared, ['calorie', 'hello']);
});

check('게이트: 쿨다운·busy·일시 정지·게이트 닫힘이면 포착 안 함', () => {
  const { st } = readyStore();
  st.getState().setPluginBusy('calorie', false, 10_000);
  assert.deepEqual(planCapture(st.getState(), 'food', 9_999).capture.map((c) => c.pluginId), ['hello']);
  assert.deepEqual(planCapture(st.getState(), 'food', 10_000).capture.map((c) => c.pluginId), ['calorie', 'hello']);
  st.getState().setPluginBusy('hello', true);
  assert.deepEqual(planCapture(st.getState(), 'food', 10_000).capture.map((c) => c.pluginId), ['calorie']);
  st.getState().setPaused(true);
  assert.equal(planCapture(st.getState(), 'food', 10_000).capture.length, 0);
  assert.equal(planCapture(st.getState(), 'person', 10_000).undeclared.length, 0); // 보낼 수 없으면 skip도 없음(F22 착용자 일시 정지)
});

check('게이트: 매니페스트 적용 직후(게이트 닫힘·버전 다름) 포착 안 함, 새 iframe ready 뒤 새 maxSide', () => {
  const { st } = readyStore();
  const json = JSON.stringify({ purpose: '음식 칼로리 추정', scenes: ['food'], maxSide: 64, network: ['$ORIGIN'] });
  assert.equal(st.getState().applyManifest('calorie', json).ok, true);
  assert.deepEqual(planCapture(st.getState(), 'food', 0).capture.map((c) => c.pluginId), ['hello']);
  st.getState().setPluginRuntime('calorie', { status: 'ready', runtimeId: 'rt-2', runtimePolicy: { connect: 'network', manifestVersion: 2 }, gateOpen: true });
  const c = planCapture(st.getState(), 'food', 0).capture.find((x) => x.pluginId === 'calorie');
  assert.equal(c?.maxSide, 64);
  assert.equal(c?.runtimeId, 'rt-2');
  assert.equal(c?.manifestVersion, 2);
});

check('게이트: 비교 모드 칼로리는 connect none iframe이 ready일 때만 raw', () => {
  const { st } = readyStore();
  st.getState().setCompareMode(true);
  assert.equal(planCapture(st.getState(), 'food', 0).capture.some((c) => c.pluginId === 'calorie'), false);
  st.getState().setPluginRuntime('calorie', { status: 'ready', runtimeId: 'rt-3', runtimePolicy: { connect: 'none', manifestVersion: 1 }, gateOpen: true });
  const plan = planCapture(st.getState(), 'food', 0);
  assert.equal(plan.capture.find((c) => c.pluginId === 'calorie')?.raw, true);
  assert.equal(plan.capture.find((c) => c.pluginId === 'hello')?.raw, false);
});

// ── SHA-256 순수 JS(IF-04 대체 경로) ──
check('sha256HexSync: "abc", 빈 입력, 55·56·64바이트 경계, M0 JPEG', () => {
  const enc = (str: string) => new TextEncoder().encode(str);
  assert.equal(sha256HexSync(enc('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256HexSync(new Uint8Array(0)), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  for (const n of [55, 56, 63, 64, 65, 1000]) {
    const buf = new Uint8Array(n).map((_, i) => (i * 31) & 0xff);
    assert.equal(sha256HexSync(buf), createHash('sha256').update(buf).digest('hex'), `길이 ${n}`);
  }
  const jpg = new Uint8Array(readFileSync(new URL('../dev/fixtures/m0-test.jpg', import.meta.url)));
  assert.equal(sha256HexSync(jpg), '358dbf25d013fc82e1a6e8fdeca1f735cf1b8aad35a445c63f01aa39033605e8');
});

// ── Selfie 모양 가림(FR-016a) ──
// 조각 10×10, 카테고리 마스크도 10×10. 3 = 얼굴 피부, 1 = 머리카락, 5 = 기타.
const grid = (fill: (x: number, y: number) => number, w = 10, h = 10) => {
  const a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = fill(x, y);
  return a;
};
const ones = (m: Uint8Array | null) => (m ? m.reduce((n, v) => n + v, 0) : -1);

check('shapeMask: 사각형 안에 머리카락·피부가 없으면 null(사각형 전체로 대체)', () => {
  const cats = grid((x) => (x < 3 ? 3 : 5));
  assert.equal(shapeMask(cats, 10, 10, 10, 10, { x: 5, y: 0, w: 5, h: 10 }, 0, [1, 3]), null);
  // 몸 피부(2)·옷(4)은 가릴 클래스가 아니다
  assert.equal(shapeMask(grid(() => 2), 10, 10, 10, 10, { x: 0, y: 0, w: 10, h: 10 }, 0, [1, 3]), null);
});

check('shapeMask: 팽창 0이면 클래스 픽셀만, 사각형 밖은 결과에 없음', () => {
  const cats = grid((x, y) => (x >= 4 && x < 6 && y >= 4 && y < 6 ? 3 : 5));
  const m = shapeMask(cats, 10, 10, 10, 10, { x: 0, y: 0, w: 10, h: 10 }, 0, [1, 3]);
  assert.equal(ones(m), 4);
  const part = shapeMask(cats, 10, 10, 10, 10, { x: 5, y: 5, w: 5, h: 5 }, 0, [1, 3]);
  assert.equal(ones(part), 1);
});

check('shapeMask: 팽창은 사각형 밖 픽셀에서도 번져 들어오고 결과는 사각형 크기', () => {
  // 피부는 x=4 한 줄. 사각형은 x 5..9. 팽창 1이면 x=5 줄이 덮인다(사각형 안 피부가 0이면 null이므로 x=5에도 피부 1픽셀).
  const cats = grid((x, y) => (x === 4 || (x === 5 && y === 0) ? 3 : 5));
  const m = shapeMask(cats, 10, 10, 10, 10, { x: 5, y: 0, w: 5, h: 10 }, 1, [1, 3]);
  assert.equal(m?.length, 50);
  // x=5(사각형 안 0열) 10칸 + x=6 y=0,1 두 칸(x=5,y=0 피부에서 번짐)
  assert.equal(ones(m), 12);
});

check('shapeMask: 마스크 해상도가 조각과 달라도 최근접으로 읽는다', () => {
  // 마스크 2×2(왼쪽 위만 피부)를 조각 10×10에 늘림 → 왼쪽 위 5×5
  const cats = new Uint8Array([3, 5, 5, 5]);
  assert.equal(ones(shapeMask(cats, 2, 2, 10, 10, { x: 0, y: 0, w: 10, h: 10 }, 0, [1, 3])), 25);
});

check('dilate·dilateRadius: 정사각형 팽창, 반지름은 긴 변 2%·최소 3px', () => {
  const m = grid((x, y) => (x === 5 && y === 5 ? 1 : 0));
  assert.equal(ones(dilate(m, 10, 10, 1)), 9);
  assert.equal(ones(dilate(m, 10, 10, 0)), 1);
  assert.equal(dilateRadius(100, 80, 0.02, 3), 3);
  assert.equal(dilateRadius(700, 650, 0.02, 3), 14);
});

check('blendMasked: 마스크 1인 픽셀만 픽셀화 결과로 바뀐다', () => {
  const dst = new Uint8ClampedArray([1, 1, 1, 255, 2, 2, 2, 255]);
  const src = new Uint8ClampedArray([9, 9, 9, 255, 8, 8, 8, 255]);
  blendMasked(dst, src, new Uint8Array([0, 1]));
  assert.deepEqual([...dst], [1, 1, 1, 255, 8, 8, 8, 255]);
});

// ── F24 전송 범위 프레임(TC-065·066의 경계 부분) ──
// capture.protect와 같은 계산: core cropToFramePx(넓힌 박스, frameRect), 한 변 2px 미만이면 "프레임 밖".
const cropInFrame = (target: { x: number; y: number; w: number; h: number }, frameRect: { x: number; y: number; w: number; h: number }, ratio: number) => {
  const c = cropToFramePx(expand(target, ratio), frameRect);
  return c && c.w >= 2 && c.h >= 2 ? c : null;
};
const within = containsBox;

check('frameToPx: 기본 프레임(가운데 60%)을 720×1280 원본 px로', () => {
  assert.deepEqual(frameToPx(CAPTURE_FRAME_DEFAULT, 720, 1280), { x: 144, y: 256, w: 432, h: 768 });
});

check('TC-065: 프레임 왼쪽 경계가 피자 박스 가운데면 조각은 프레임 경계에서 시작하고 cropRect ⊆ frameRect', () => {
  const frameRect = { x: 300, y: 0, w: 420, h: 1280 };
  const pizza = { x: 200, y: 500, w: 200, h: 200 }; // 가운데 x=300
  const c = cropInFrame(pizza, frameRect, 0.1);
  assert.ok(c);
  assert.equal(c.x, 300); // 프레임 밖(왼쪽 절반과 +10% 여유)은 들어가지 않는다
  assert.equal(c.x + c.w, 420); // 오른쪽은 +10%(20px)
  assert.deepEqual([c.y, c.h], [480, 240]);
  assert.ok(within(frameRect, c));
  // 소수 좌표는 안쪽으로 맞춘다(프레임 경계 안)
  const f = cropInFrame({ x: 200.4, y: 500.6, w: 199.3, h: 199.1 }, frameRect, 0.1);
  assert.ok(f && Number.isInteger(f.x) && Number.isInteger(f.w) && within(frameRect, f));
});

check('TC-066: 프레임과 겹치지 않으면 null("프레임 밖"), 2px 미만 띠도 null', () => {
  const frameRect = { x: 0, y: 0, w: 200, h: 200 };
  assert.equal(cropInFrame({ x: 400, y: 400, w: 100, h: 100 }, frameRect, 0.1), null);
  // +10% 넓혀도 x 210부터라 안 겹친다
  assert.equal(cropInFrame({ x: 220, y: 50, w: 100, h: 100 }, frameRect, 0.1), null);
  // 넓힌 박스가 1px만 걸침(x 199~200)
  assert.equal(cropInFrame({ x: 209, y: 50, w: 100, h: 100 }, frameRect, 0.1), null);
});

check('cropToFramePx: 무작위 500회 모두 cropRect ⊆ frameRect이고 넓힌 박스 안(정수 px)', () => {
  let rnd = 12345;
  const r = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 500; i++) {
    const W = 720, H = 1280;
    const frameRect = frameToPx({ x: r() * 0.9, y: r() * 0.9, w: 0.1 + r() * 0.9, h: 0.1 + r() * 0.9 }, W, H);
    frameRect.w = Math.min(frameRect.w, W - frameRect.x);
    frameRect.h = Math.min(frameRect.h, H - frameRect.y);
    const t = { x: r() * W, y: r() * H, w: 1 + r() * 300, h: 1 + r() * 300 };
    const c = cropInFrame(t, frameRect, 0.1);
    if (!c) continue;
    assert.ok(within(frameRect, c), `반복 ${i}`);
    assert.ok(within(expand(t, 0.1), c), `반복 ${i}`);
    assert.ok(Number.isInteger(c.x) && Number.isInteger(c.w));
  }
});

check('프레임 밖 보류도 쿨다운: 포착 시작 기준 간격(maxPerMinute 6 → 10초에 1건)', () => {
  // runCapture는 "프레임 밖"을 cooled에 넣어 끝난 시각 + 간격으로 쿨다운을 확정한다. 간격 계산은 같은 함수다.
  assert.equal(Math.max(cooldownUntil(0, 6), cooldownUntil(120, 6)), 10_120);
});

// ── 코디 스캔 응시 동의(docs/designs/outfit-pipelines.md) ──
const b = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

check('추적: 조금 움직인 사람은 같은 trackId, 새 사람은 새 trackId', () => {
  let n = 0;
  const id = () => `p${++n}`;
  const t1 = stepTracks([], [{ box: b(0.1, 0.1, 0.2, 0.5), score: 0.9 }], 0, id);
  assert.deepEqual(t1.visible.map((t) => t.id), ['p1']);
  const t2 = stepTracks(t1.tracks, [{ box: b(0.12, 0.1, 0.2, 0.5), score: 0.9 }, { box: b(0.6, 0.1, 0.2, 0.5), score: 0.8 }], 200, id);
  assert.deepEqual(t2.visible.map((t) => t.id), ['p1', 'p2']);
});

check('추적: 안 보인 사람은 trackKeepMs(2초)까지 남고 그 뒤 버린다', () => {
  let n = 0;
  const id = () => `p${++n}`;
  const t1 = stepTracks([], [{ box: b(0.1, 0.1, 0.2, 0.5), score: 0.9 }], 0, id);
  const gone = stepTracks(t1.tracks, [], 2000, id);
  assert.deepEqual(gone.tracks.map((t) => t.id), ['p1']);
  const back = stepTracks(gone.tracks, [{ box: b(0.11, 0.1, 0.2, 0.5), score: 0.9 }], 2000, id);
  assert.deepEqual(back.visible.map((t) => t.id), ['p1']);
  assert.deepEqual(stepTracks(t1.tracks, [], 2001, id).tracks, []);
});

check('추적: 두 사람이 엇갈려 한 상자가 둘과 겹치면 잇지 않는다(동의가 옮겨 가지 않게)', () => {
  const prev: Track[] = [
    { id: 'p1', box: b(0.3, 0.1, 0.2, 0.6), score: 0.9, lastSeenAt: 0 },
    { id: 'p2', box: b(0.36, 0.1, 0.2, 0.6), score: 0.9, lastSeenAt: 0 },
  ];
  let n = 10;
  const t = stepTracks(prev, [{ box: b(0.33, 0.1, 0.2, 0.6), score: 0.9 }], 200, () => `p${++n}`);
  assert.deepEqual(t.visible.map((x) => x.id), ['p11']);
  assert.equal(matchBoxes([b(0, 0, 10, 10)], [b(1, 0, 10, 10), b(2, 0, 10, 10)], 0.3).size, 0);
});

check('응시 대상: 짧은 변 × 0.18 원 안 ∧ 흰 틀과 겹침, 그중 가장 가운데', () => {
  // 640×360: 반지름 = 360 × 0.18 = 64.8px. 중심 (320,180).
  const full = b(0, 0, 1, 1);
  const at = (cxPx: number, id: string): Track => ({ id, box: b((cxPx - 32) / 640, 0.3, 64 / 640, 0.4), score: 0.9, lastSeenAt: 0 });
  assert.equal(pickGazeTarget([at(320 + 64, 'a')], full, 640, 360, 0.18)?.id, 'a');
  assert.equal(pickGazeTarget([at(320 + 66, 'a')], full, 640, 360, 0.18), null);
  assert.equal(pickGazeTarget([at(360, 'a'), at(330, 'b')], full, 640, 360, 0.18)?.id, 'b');
  // 흰 틀이 왼쪽 절반이면 가운데 사람(x 288..352)과 겹치므로 대상, 오른쪽 끝 0.1이면 안 겹침
  assert.equal(pickGazeTarget([at(320, 'a')], b(0, 0, 0.5, 1), 640, 360, 0.18)?.id, 'a');
  assert.equal(pickGazeTarget([at(320, 'a')], b(0.9, 0, 0.1, 1), 640, 360, 0.18), null);
});

check('응시 유지: 3초 이어지면 후보, 400ms 안의 빈틈은 이어 보고 다른 사람이면 처음부터', () => {
  const tr = (id: string): Track => ({ id, box: b(0.4, 0.2, 0.2, 0.6), score: 0.9, lastSeenAt: 0 });
  let g = stepGaze(null, tr('p1'), 0, 400);
  g = stepGaze(g, null, 400, 400); // 빈틈 400ms: 이어 봄
  assert.equal(g?.since, 0);
  g = stepGaze(g, tr('p1'), 2999, 400);
  assert.equal(gazeHeld(g, 2999, 3000), false);
  assert.equal(gazeHeld(g, 3000, 3000), true);
  g = stepGaze(g, tr('p1'), 3000, 400);
  assert.equal(stepGaze(g, null, 3400, 400), g);
  assert.equal(stepGaze(g, null, 3401, 400), null);
  const other = stepGaze(g, tr('p2'), 3100, 400);
  assert.equal(other?.trackId, 'p2');
  assert.equal(other?.since, 3100);
});

check('코디 스캔 조각 주인: 살아 있는 동의(만료 전 ∧ 2초 안에 봄) 중 가장 가운데', () => {
  const c = (trackId: string, cx: number, lastSeenAt: number, expiresAt: number) => ({ trackId, box: b(cx - 0.1, 0.2, 0.2, 0.6), grantedAt: 0, lastSeenAt, expiresAt });
  const consents = { a: c('a', 0.3, 1000, 60_000), z: c('z', 0.52, 1000, 60_000), old: c('old', 0.5, 0, 60_000), exp: c('exp', 0.5, 2900, 3000) };
  const live = selectActiveConsents({ consents }, 3000);
  assert.deepEqual(live.map((x) => x.trackId).sort(), ['a', 'z']);
  assert.equal(pickConsent(live, 640, 360)?.trackId, 'z');
  assert.equal(pickConsent([], 640, 360), null);
});

check('코디 스캔 분기: 동의한 사람 얼굴 가림(2b), 동의 안 한 사람은 겹침 50% 이상이어도 몸 전체 가림(R4 아님)', () => {
  // 조각 = 동의한 사람 박스(100,100,100,100). 다른 사람(150,90,100,200)은 조각과 50×100 = 50% 겹침.
  // 얼굴 중심 (130,115)은 동의한 사람 머리 영역(x 90..210, y 100..140) 안, 다른 사람 머리 영역(x 140..260) 밖.
  const me = person(100, 100, 100, 100);
  const other = person(150, 90, 100, 200);
  const r = decideBranch(crop, [me, other], [face(120, 105, 20, 20)], VISION_CONFIG, new Set([other]));
  assert.equal(r.branch, '2b');
  assert.deepEqual(r.masks.map((m) => m.kind).sort(), ['body', 'face']);
  assert.deepEqual(r.masks.find((m) => m.kind === 'body')?.rect, other.box);
  assert.equal(r.detections.find((d) => d.kind === 'person' && d.overlap === 0.5)?.masked, 'body');
  // 같은 사람이 동의 안 한 사람 집합에 없으면 R4(겹침 50%, 얼굴 없음)로 보류된다
  assert.equal(decideBranch(crop, [me, other], [face(120, 105, 20, 20)]).branch, '2d');
});

check('코디 스캔 분기: 동의한 사람 얼굴이 없으면 그대로 R4 보류, 얼굴 대응 불확실도 보류', () => {
  const me = person(100, 100, 100, 100);
  const other = person(120, 90, 120, 200);
  assert.equal(decideBranch(crop, [me, other], [], VISION_CONFIG, new Set([other])).branch, '2d');
  // 얼굴 중심 (140,115)이 두 사람 머리 영역(x 90..210·108..252, y 100..140·90..170) 모두에 든다
  const r = decideBranch(crop, [me, other], [face(130, 105, 20, 20)], VISION_CONFIG, new Set([other]));
  assert.equal(r.branch, '2d');
  assert.equal(r.reason, '얼굴-사람 대응 불확실');
});

check('게이트: 코디 스캔(outfit)은 켜면 person 장면에서만 포착 대상(maxSide 512), food면 skip', () => {
  const { st } = readyStore();
  st.getState().setPluginEnabled('outfit', true);
  st.getState().setPluginRuntime('outfit', { status: 'ready', runtimeId: 'rt-o', runtimePolicy: { connect: 'network', manifestVersion: 1 }, gateOpen: true });
  const person = planCapture(st.getState(), 'person', 0);
  assert.deepEqual(person.capture.map((c) => [c.pluginId, c.kind, c.maxSide, c.raw]), [['outfit', 'outfit', 512, false]]);
  assert.ok(planCapture(st.getState(), 'food', 0).undeclared.includes('outfit'));
});

// ── 광각(양옆 휘어짐, docs/designs/input-wide-warp.md). 인계 landscape-wrap.cjs의 핵심 검사를 CPU 수식으로 옮겼다 ──
const warpSet = (o: Partial<WarpSettings> = {}): WarpSettings => ({ periphery: 0, strength: 0, framing: 1, lookX: 0, lookY: 0, fit: 'cover', ...o });
/** 640×360 시험 그림(landscape-wrap.cjs paint): 바탕 (64,96,128), 40px마다 세로선, y=90·270 노란 가로선(두께 4), 위 모서리 빨강·초록. */
function warpFixture(): Uint8ClampedArray {
  const W = 640, H = 360;
  const px = new Uint8ClampedArray(W * H * 4);
  const put = (x: number, y: number, r: number, g: number, b: number) => {
    const i = 4 * (y * W + x);
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, 64, 96, 128);
  for (let x = 40; x < W; x += 40) for (let y = 0; y < H; y++) put(x, y, 0x8d, 0xac, 0xc9);
  for (const ly of [90, 270]) for (let y = ly - 2; y < ly + 2; y++) for (let x = 0; x < W; x++) put(x, y, 255, 255, 0);
  for (let y = 10; y < 34; y++) for (let x = 10; x < 34; x++) put(x, y, 0xff, 0x33, 0x33);
  for (let y = 10; y < 34; y++) for (let x = W - 34; x < W - 10; x++) put(x, y, 0x33, 0xff, 0x33);
  return px;
}
function warpRender(src: Uint8ClampedArray, w: number, h: number, s: WarpSettings): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  applyCpuMap(buildCpuMap(w, h, 640, 360, warpParams(640 / 360, w / h, s)), src, out);
  return out;
}

check('광각 기본값: cover·strength 0·framing 1·시선 0/0·periphery 0.82(인계 기본 0.80과 구분), 켜짐', () => {
  assert.deepEqual(
    [WIDE_WARP.enabled, WIDE_WARP.fit, WIDE_WARP.strength, WIDE_WARP.framing, WIDE_WARP.lookX, WIDE_WARP.lookY, WIDE_WARP.periphery],
    [true, 'cover', 0, 1, 0, 0, 0.82],
  );
});

check('광각 출력 크기: 원본 비율·긴 변 1280 이하·키우지 않음·세로 입력은 세로 그대로(자동 회전 없음)', () => {
  assert.deepEqual(warpOutputSize(1280, 720, 1280), { width: 1280, height: 720 });
  assert.deepEqual(warpOutputSize(1920, 1080, 1280), { width: 1280, height: 720 });
  assert.deepEqual(warpOutputSize(720, 1280, 1280), { width: 720, height: 1280 });
  assert.deepEqual(warpOutputSize(640, 480, 1280), { width: 640, height: 480 });
  assert.deepEqual(warpOutputSize(1280, 720, 640), { width: 640, height: 360 });
});

check('광각 0 효과(periphery 0): 확대 1·이동 0, 같은 RGBA 입력과 픽셀 오차 0', () => {
  const p = warpParams(640 / 360, 640 / 360, warpSet());
  assert.deepEqual([p.z, p.ox, p.oy], [1, 0, 0]);
  const src = warpFixture();
  const out = warpRender(src, 640, 360, warpSet());
  let max = 0;
  for (let i = 0; i < src.length; i++) max = Math.max(max, Math.abs((out[i] ?? 0) - (src[i] ?? 0)));
  assert.equal(max, 0);
});

check('광각 0.82·0.80: 위쪽 노란 가로선이 양옆에서 안쪽으로 15px 넘게 휘고 좌우 대칭(2px 미만)', () => {
  const src = warpFixture();
  for (const periphery of [0.82, 0.8]) {
    const out = warpRender(src, 640, 360, warpSet({ periphery }));
    const lineY = (x: number) => {
      let total = 0, n = 0;
      for (let y = 15; y < 150; y++) {
        const i = 4 * (y * 640 + x);
        if ((out[i] ?? 0) > 180 && (out[i + 1] ?? 0) > 180 && (out[i + 2] ?? 0) < 70) { total += y; n++; }
      }
      return total / n;
    };
    const [l, c, r] = [lineY(64), lineY(320), lineY(575)];
    assert.ok(l - c > 15 && r - c > 15, `${periphery}: ${l} ${c} ${r}`);
    assert.ok(Math.abs(l - r) < 2, `${periphery}: ${l} ${r}`);
  }
});

check('광각 cover 극값 5조합: 검은(원본 밖) 픽셀 0', () => {
  const src = warpFixture();
  const cases: [number, number, number, number, number, number][] = [
    [0, 0, 16 / 9, 1, 0, 0],
    [0.9, 0.5, 4 / 3, 1, 0, 0],
    [0.9, 0.5, 7 / 3, 1, 0, 0],
    [0.9, 0.5, 16 / 9, 2, 1, -1],
    [0.9, 0.5, 16 / 9, 2, -1, 1],
  ];
  for (const [periphery, strength, aspect, framing, lookX, lookY] of cases) {
    const w = 640;
    const h = Math.max(2, Math.round(640 / aspect / 2) * 2);
    const out = warpRender(src, w, h, warpSet({ periphery, strength, framing, lookX, lookY }));
    let black = 0;
    for (let i = 0; i < out.length; i += 4) if ((out[i] ?? 0) + (out[i + 1] ?? 0) + (out[i + 2] ?? 0) < 10) black++;
    assert.equal(black, 0, JSON.stringify({ periphery, strength, aspect, framing, lookX, lookY }));
  }
});

check('광각 기본값(cover 0.82)은 출력 어디서도 원본 밖을 읽지 않는다(16:9·9:16, 모서리·가장자리 표본)', () => {
  for (const [sw, sh] of [[1280, 720], [720, 1280]] as const) {
    const { width: w, height: h } = warpOutputSize(sw, sh, 1280);
    const p = warpParams(sw / sh, w / h, { ...WIDE_WARP });
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0], [0, 0.5], [1, 0.5], [0.5, 1], [0.5, 0.5]] as const) {
      assert.ok(sourceUv(x, y, p), `${sw}×${sh} (${x},${y})`);
    }
  }
});

check('광각 정방향 사상: warpedXY ∘ sourceUv = 항등(k 0·0.5, 16:9·9:16·출력 비율 다름)', () => {
  for (const strength of [0, 0.5]) {
    for (const [As, Ao] of [[16 / 9, 16 / 9], [9 / 16, 9 / 16], [16 / 9, 4 / 3]] as const) {
      const p = warpParams(As, Ao, warpSet({ periphery: 0.82, strength }));
      for (let i = 0; i <= 20; i++) {
        for (let j = 0; j <= 20; j++) {
          const uv = sourceUv(i / 20, j / 20, p);
          assert.ok(uv);
          const q = warpedXY(uv.u, uv.v, p);
          assert.ok(Math.abs(q.x - i / 20) < 1e-9 && Math.abs(q.y - j / 20) < 1e-9);
        }
      }
    }
  }
});

check('광각 박스 옮기기: 원본 얼굴 박스를 옮긴 사각형이 휜 프레임에서 그 얼굴 픽셀을 모두 덮는다(가운데·가장자리), 역사상은 조각을 덮는다', () => {
  const W = 1280, H = 720;
  const p = warpParams(W / H, W / H, warpSet({ periphery: 0.82 }));
  for (const face of [{ x: 0.45, y: 0.3, w: 0.1, h: 0.18 }, { x: 0.88, y: 0.3, w: 0.09, h: 0.16 }, { x: 0.02, y: 0.6, w: 0.08, h: 0.15 }]) {
    const m = sourceBoxToWarped(face, p, 0);
    assert.ok(m);
    for (let y = 0; y < H; y += 2) {
      for (let x = 0; x < W; x += 2) {
        const uv = sourceUv((x + 0.5) / W, (y + 0.5) / H, p);
        if (!uv || uv.u < face.x || uv.u > face.x + face.w || uv.v < face.y || uv.v > face.y + face.h) continue;
        const px = (x + 0.5) / W, py = (y + 0.5) / H;
        assert.ok(px >= m.x - 1e-9 && px <= m.x + m.w + 1e-9 && py >= m.y - 1e-9 && py <= m.y + m.h + 1e-9, JSON.stringify({ face, x, y }));
      }
    }
  }
  // 역사상: 휜 조각 둘레를 원본으로 옮긴 사각형 안에 조각 안 모든 점의 원본 위치가 든다
  const crop01 = { x: 0.7, y: 0.1, w: 0.3, h: 0.6 };
  const back = warpedBoxToSource(crop01, p);
  assert.ok(back);
  for (let i = 0; i <= 30; i++) {
    for (let j = 0; j <= 30; j++) {
      const uv = sourceUv(crop01.x + (crop01.w * i) / 30, crop01.y + (crop01.h * j) / 30, p);
      assert.ok(uv && uv.u >= back.x - 1e-9 && uv.u <= back.x + back.w + 1e-9 && uv.v >= back.y - 1e-9 && uv.v <= back.y + back.h + 1e-9);
    }
  }
});

check('광각 보강: 휜 프레임에서 놓친 가장자리 얼굴이 원본 검출로 잡혀 가려지고, 원본 쪽 출구 재검사에서 덮인 것으로 나온다', () => {
  // 휜 1280×720 프레임, 조각 = 오른쪽 절반. 얼굴은 원본 (0.88~0.97, 0.3~0.46) → 휜 프레임 오른쪽 끝.
  const W = 1280, H = 720;
  const p = warpParams(W / H, W / H, warpSet({ periphery: 0.82 }));
  const cropPx = { x: 640, y: 0, w: 640, h: 720 };
  const srcFace = { x: 0.88, y: 0.3, w: 0.09, h: 0.16 };
  const trueWarped = sourceBoxToWarped(srcFace, p, 0);
  assert.ok(trueWarped);
  const truePx = scaleBox(trueWarped, W, H);
  // 휜 쪽 검출: 얼굴은 놓치고 피자 위를 잘못 잡았다(/dev local-face-pizza에서 본 경우)
  const wrong = face(800, 150, 120, 120);
  const onlyWarped = decideBranch(cropPx, [], [wrong]);
  assert.equal(uncoveredFaces([truePx], onlyWarped.masks.map((x) => x.rect), cropPx).length, 1); // 원본 쪽 재검사가 잡아 보류한다
  // 원본 쪽 검출을 더하면 그 얼굴 자리가 가려진다
  const mapped = sourceBoxToWarped(srcFace, p, VISION_CONFIG.warpFaceMargin);
  assert.ok(mapped);
  const mappedPx = scaleBox(mapped, W, H);
  const both = decideBranch(cropPx, [], [wrong, face(mappedPx.x, mappedPx.y, mappedPx.w, mappedPx.h)]);
  assert.equal(both.branch, '2b');
  assert.deepEqual(uncoveredFaces([truePx], both.masks.map((x) => x.rect), cropPx), []);
});

check('uncoveredFaces: 조각 밖 얼굴은 무시, 사각형 하나로 50% 이상 덮여야 덮인 것', () => {
  const crop2 = { x: 0, y: 0, w: 100, h: 100 };
  const fc = { x: 40, y: 40, w: 20, h: 20 };
  assert.deepEqual(uncoveredFaces([{ x: 200, y: 0, w: 10, h: 10 }], [], crop2), []);
  assert.equal(uncoveredFaces([fc], [], crop2).length, 1);
  assert.deepEqual(uncoveredFaces([fc], [{ x: 35, y: 35, w: 30, h: 30 }], crop2), []);
  // 둘로 나뉘어 40%씩만 덮이면 덮이지 않은 것
  assert.equal(uncoveredFaces([fc], [{ x: 40, y: 40, w: 8, h: 20 }, { x: 52, y: 40, w: 8, h: 20 }], crop2).length, 1);
});

async function checkAsync(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`ok  ${name}`);
}

// ── 입력 열기 실패(session.inputError). 카메라 → 대체 녹화 영상까지 실패하면 C가 받을 신호가 남아야 한다 ──
const io = (o: { camera?: boolean; file?: boolean; current?: () => boolean } = {}): OpenIo & { cleaned: number } => {
  const x = {
    cleaned: 0,
    camera: async () => {
      if (!o.camera) throw new Error('NotReadableError');
      return 30;
    },
    file: async () => {
      if (!o.file) throw new Error('영상 오류 4');
      return 0;
    },
    current: o.current ?? (() => true),
    cleanup: () => {
      x.cleaned += 1;
    },
  };
  return x;
};
const warnOff = console.warn;

await checkAsync('입력 열기: 카메라 실패 → 대체 영상도 실패면 failed { kind: video, fallbackFrom: 카메라 }, 성공·대체 성공·영상 요청 실패도 구분', async () => {
  console.warn = () => undefined;
  try {
    assert.deepEqual(await openWithFallback('rear', io({ camera: true })), { status: 'opened', kind: 'rear', fps: 30, fallbackFrom: null });
    const fb = io({ file: true });
    assert.deepEqual(await openWithFallback('webcam', fb), { status: 'opened', kind: 'video', fps: 0, fallbackFrom: 'webcam' });
    assert.equal(fb.cleaned, 1);
    assert.deepEqual(await openWithFallback('rear', io()), { status: 'failed', error: { kind: 'video', fallbackFrom: 'rear' } });
    assert.deepEqual(await openWithFallback('video', io()), { status: 'failed', error: { kind: 'video', fallbackFrom: null } });
    // 그 사이 다른 요청이 왔으면 실패를 남기지 않는다
    assert.deepEqual(await openWithFallback('rear', io({ current: () => false })), { status: 'superseded' });
  } finally {
    console.warn = warnOff;
  }
});

check('session.inputError: setInput(null, 오류)로 남고, 열기 시작(setInput(null))·열림이면 null, 새 세션에도 유지', () => {
  let t = 5;
  const st = createLensStore({ clock: () => t, revokeUrl: () => undefined, hostOrigin: 'https://h.test' });
  assert.equal(st.getState().session.inputError, null);
  st.getState().setInput(null, { kind: 'video', fallbackFrom: 'rear' });
  assert.deepEqual(st.getState().session.inputError, { kind: 'video', fallbackFrom: 'rear', at: 5 });
  assert.equal(st.getState().session.input, null);
  t = 9;
  st.getState().startNewSession();
  assert.deepEqual(st.getState().session.inputError, { kind: 'video', fallbackFrom: 'rear', at: 5 });
  st.getState().setInput(null);
  assert.equal(st.getState().session.inputError, null);
  st.getState().setInput(null, { kind: 'video', fallbackFrom: 'webcam' });
  st.getState().setInput({ kind: 'webcam', width: 1280, height: 720, fps: 30, fallbackFrom: null }, { kind: 'video', fallbackFrom: 'webcam' });
  assert.equal(st.getState().session.inputError, null); // 입력이 열리면 오류는 없다
});

// ── 실시간 받아쓰기(src/input/scribe.ts). 토큰·마이크·소켓·타이머를 가짜로 바꿔 상태 전환·자동 정지·실패 경로를 본다 ──
const tick = () => new Promise((r) => setTimeout(r, 0));
function fakeScribe(opts: { token?: boolean; mic?: boolean } = {}) {
  let t = 0;
  const timers: { fn: () => void; at: number; id: number }[] = [];
  let nextId = 1;
  const log = { partial: [] as string[], committed: [] as string[], errors: [] as ScribeError[], recording: [] as boolean[], micClosed: 0, flushes: 0 };
  const sent: { message_type: string; audio_base_64: string; commit: boolean; sample_rate: number }[] = [];
  let url = '';
  const socket: SocketLike & { emit(m: object): void; readyState: number } = {
    readyState: 1,
    bufferedAmount: 0,
    send: (d) => sent.push(JSON.parse(d)),
    close: () => {
      socket.readyState = 3;
    },
    onmessage: null,
    onerror: null,
    onclose: null,
    emit: (m) => socket.onmessage?.({ data: JSON.stringify(m) }),
  };
  const mic: MicPipe = {
    onChunk: null,
    flush: async () => {
      log.flushes += 1;
      mic.onChunk?.(new ArrayBuffer(100)); // 워크릿에 남아 있던 꼬리
    },
    close: () => {
      log.micClosed += 1;
    },
  };
  const deps: ScribeDeps = {
    fetchToken: async () => {
      if (opts.token === false) throw new Error('HTTP 500');
      return 'tok-1';
    },
    openMic: async () => {
      if (opts.mic === false) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
      return mic;
    },
    connect: (u) => {
      url = u;
      return socket;
    },
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.push({ fn, at: t + ms, id });
      return id;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((x) => x.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
    onRecording: (on) => log.recording.push(on),
  };
  const handlers = {
    onPartial: (x: string) => log.partial.push(x),
    onCommitted: (x: string) => log.committed.push(x),
    onError: (e: ScribeError) => log.errors.push(e),
  };
  const advance = async (ms: number) => {
    t += ms;
    for (const x of timers.filter((y) => y.at <= t)) {
      timers.splice(timers.indexOf(x), 1);
      x.fn();
    }
    await tick();
  };
  return { start: () => runScribe(handlers, deps), log, sent, socket, mic, advance, url: () => url, timers };
}
const audioBytes = (b64: string) => Buffer.from(b64, 'base64').length;

check('받아쓰기 연결 주소: 토큰 쿼리 + scribe_v2_realtime·pcm_16000·ko·vad(SAI 검증값)', () => {
  const u = new URL(scribeUrl('tok-1'));
  assert.equal(`${u.protocol}//${u.host}${u.pathname}`, 'wss://api.elevenlabs.io/v1/speech-to-text/realtime');
  assert.equal(u.searchParams.get('token'), 'tok-1');
  assert.equal(u.searchParams.get('model_id'), 'scribe_v2_realtime');
  assert.equal(u.searchParams.get('audio_format'), 'pcm_16000');
  assert.equal(u.searchParams.get('language_code'), 'ko');
  assert.equal(u.searchParams.get('commit_strategy'), 'vad');
  assert.equal(u.searchParams.get('vad_silence_threshold_secs'), '2');
});

await checkAsync('받아쓰기 상태: 시작 전 오디오는 쌓았다가 session_started 뒤 보내고, 부분·확정 글자를 넘기고, stop()이 꼬리·commit 뒤 확정 글자 전체를 준다', async () => {
  const f = fakeScribe();
  const s = await f.start();
  assert.deepEqual(f.log.recording, [true]);
  assert.match(f.url(), /token=tok-1/);
  f.mic.onChunk?.(new ArrayBuffer(8192));
  assert.equal(f.sent.length, 0); // 아직 session_started 전
  f.socket.emit({ message_type: 'session_started', session_id: 's', config: {} });
  assert.equal(f.sent.length, 1);
  assert.deepEqual({ ...f.sent[0], audio_base_64: audioBytes(f.sent[0]?.audio_base_64 ?? '') }, { message_type: 'input_audio_chunk', audio_base_64: 8192, commit: false, sample_rate: 16000 });
  f.socket.emit({ message_type: 'partial_transcript', text: '이 옷' });
  f.socket.emit({ message_type: 'committed_transcript', text: '이 옷 어디 거야' });
  assert.deepEqual(f.log.partial, ['이 옷', '']);
  assert.deepEqual(f.log.committed, ['이 옷 어디 거야']);
  const done = s.stop();
  await tick();
  assert.equal(f.log.flushes, 1);
  const last = f.sent.at(-1);
  assert.equal(last?.commit, true);
  // 꼬리 100B까지 8,292B를 보냈으므로 2.1초(67,200B)가 되도록 무음으로 채운다
  assert.equal(audioBytes(last?.audio_base_64 ?? ''), SCRIBE.minCommitBytes - 8192 - 100);
  f.socket.emit({ message_type: 'committed_transcript', text: '색은 뭐야' });
  assert.equal(await done, '이 옷 어디 거야 색은 뭐야');
  assert.equal(f.socket.readyState, 3);
  assert.ok(f.log.micClosed >= 1);
  assert.deepEqual(f.log.recording, [true, false]);
  assert.equal(f.log.errors.length, 0);
  assert.equal(await s.stop(), '이 옷 어디 거야 색은 뭐야');
});

await checkAsync('받아쓰기 stop(): 마지막 확정 응답이 없으면 1.5초 뒤 그때까지의 글자로 끝낸다', async () => {
  const f = fakeScribe();
  const s = await f.start();
  f.socket.emit({ message_type: 'session_started' });
  f.socket.emit({ message_type: 'committed_transcript', text: '하나' });
  const done = s.stop();
  await tick();
  await f.advance(SCRIBE.finalWaitMs - 1);
  assert.equal(f.socket.readyState, 1);
  await f.advance(1);
  assert.equal(await done, '하나');
  assert.equal(f.socket.readyState, 3);
});

await checkAsync('받아쓰기 자동 정지: 30초 직전에는 받아쓰는 중, 30초에 스스로 commit하고 닫는다(onError 없음)', async () => {
  const f = fakeScribe();
  const s = await f.start();
  f.socket.emit({ message_type: 'session_started' });
  await f.advance(SCRIBE.maxMs - 1);
  assert.deepEqual(f.log.recording, [true]);
  await f.advance(1);
  assert.equal(f.sent.at(-1)?.commit, true);
  f.socket.emit({ message_type: 'committed_transcript', text: '끝' });
  await tick();
  assert.deepEqual(f.log.recording, [true, false]);
  assert.equal(await s.stop(), '끝');
  assert.equal(f.log.errors.length, 0);
});

await checkAsync('받아쓰기 실패 경로: 토큰·마이크·제공사 오류·연결 끊김·연결 지연이면 onError 한 번, 마이크·소켓은 닫힘', async () => {
  const noToken = fakeScribe({ token: false });
  await noToken.start();
  assert.deepEqual(noToken.log.errors.map((e) => e.kind), ['token']);
  assert.equal(noToken.url(), ''); // 연결하지 않음
  assert.deepEqual(noToken.log.recording, [false]);

  const noMic = fakeScribe({ mic: false });
  await noMic.start();
  assert.deepEqual(noMic.log.errors.map((e) => e.kind), ['microphone']);

  const auth = fakeScribe();
  await auth.start();
  auth.socket.emit({ message_type: 'auth_error', error: 'bad token' });
  auth.socket.emit({ message_type: 'quota_exceeded' });
  assert.deepEqual(auth.log.errors.map((e) => e.kind), ['provider:auth_error']);
  assert.equal(auth.socket.readyState, 3);
  assert.ok(auth.log.micClosed >= 1);
  assert.deepEqual(auth.log.recording, [true, false]);

  const drop = fakeScribe();
  await drop.start();
  drop.socket.onclose?.({});
  assert.deepEqual(drop.log.errors.map((e) => e.kind), ['connection']);

  const slow = fakeScribe();
  await slow.start();
  for (let i = 0; i < 40; i++) slow.mic.onChunk?.(new ArrayBuffer(8192)); // session_started 없이 5초 넘게 쌓임
  assert.deepEqual(slow.log.errors.map((e) => e.kind), ['timeout']);
});

await checkAsync('받아쓰기 취소: 바로 닫고 그 뒤 메시지·콜백은 없다', async () => {
  const f = fakeScribe();
  const s = await f.start();
  f.socket.emit({ message_type: 'session_started' });
  s.cancel();
  assert.equal(f.socket.readyState, 3);
  assert.equal(f.socket.onmessage, null);
  assert.deepEqual(f.log.recording, [true, false]);
  assert.equal(f.timers.length, 0);
  assert.equal(await s.stop(), '');
  assert.equal(f.log.errors.length, 0);
});

console.log(`\n${passed}개 통과`);
