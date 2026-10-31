// 트랙 A assertion 스크립트. 실행: npm run check:runtime
// DOM·모델 없이 도는 경계 함수만 본다(AGENTS.md "테스트"). 실기기 확인은 /dev/ 페이지와 05의 V 표.

import assert from 'node:assert/strict';
import { VISION_CONFIG } from '../src/vision/config';
import { area, clampToFrame, classifyScene, expand, fitLongSide, inCenterRegion, intersect, matchTarget, type Found } from '../src/vision/geometry';
import { SCENE_NONE, stepScene, type SceneState } from '../src/vision/scene';

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

console.log(`\n${passed}개 통과`);
