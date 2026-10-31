// 트랙 A assertion 스크립트. 실행: npm run check:runtime
// DOM·모델 없이 도는 경계 함수만 본다(AGENTS.md "테스트"). 실기기 확인은 /dev/ 페이지와 05의 V 표.

import assert from 'node:assert/strict';
import { VISION_CONFIG } from '../src/vision/config';
import { area, clampToFrame, classifyScene, expand, fitLongSide, inCenterRegion, intersect, matchTarget, type Found } from '../src/vision/geometry';
import { SCENE_NONE, stepScene, type SceneState } from '../src/vision/scene';
import { cooldownUntil, decideBranch, headRegion } from '../src/vision/branch';
import { planCapture } from '../src/vision/plan';
import { sha256HexSync } from '../src/broker/sha256';
import { createLensStore } from '../src/core/store';
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

check('게이트: food는 calorie·hello 포착, person은 calorie skip·hello 포착', () => {
  const { st } = readyStore();
  const food = planCapture(st.getState(), 'food', 0);
  assert.deepEqual(food.capture.map((c) => c.pluginId), ['calorie', 'hello']);
  assert.deepEqual(food.undeclared, []);
  const person = planCapture(st.getState(), 'person', 0);
  assert.deepEqual(person.capture.map((c) => c.pluginId), ['hello']);
  assert.deepEqual(person.undeclared, ['calorie']);
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
  assert.equal(planCapture(st.getState(), 'person', 10_000).undeclared.length, 0); // 보낼 수 없으면 skip도 없음
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

console.log(`\n${passed}개 통과`);
