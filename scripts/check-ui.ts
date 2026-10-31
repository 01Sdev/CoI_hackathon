// src/ui assertion 스크립트. 실행: npm run check:ui
// 좌표 변환·시간 창·문구처럼 경계가 있는 함수만 확인한다(AGENTS.md "테스트").

import assert from 'node:assert/strict';
import { coverBox, faceWindowRemaining } from '../src/ui/geometry';
import { formatBytes, josa } from '../src/ui/labels';
import { OUTWARD_STALE_MS, outwardView, parseOutwardMessage } from '../src/ui/outward';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`ok  ${name}`);
}

check('coverBox: 같은 비율이면 그대로 늘린다', () => {
  assert.deepEqual(coverBox({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, { w: 100, h: 200 }, { w: 200, h: 400 }), {
    left: 50,
    top: 200,
    width: 100,
    height: 100,
  });
});

check('coverBox: 가로 영상(1280×720)을 세로 화면(360×640)에 채우면 좌우가 잘린다', () => {
  // scale = max(360/1280, 640/720) = 0.888…, 보이는 폭 1137.7, 왼쪽으로 388.9 밀림
  const r = coverBox({ x: 0.5, y: 0, w: 0, h: 1 }, { w: 1280, h: 720 }, { w: 360, h: 640 });
  assert.ok(Math.abs(r.left - 180) < 1e-9, `가운데 x가 화면 가운데여야 함: ${r.left}`);
  assert.ok(Math.abs(r.height - 640) < 1e-9);
});

check('coverBox: 소스 크기를 모르면 화면 비율로 본다', () => {
  assert.deepEqual(coverBox({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, null, { w: 600, h: 600 }), {
    left: 60,
    top: 60,
    width: 300,
    height: 300,
  });
});

check('faceWindowRemaining: 얼굴 기록이 없으면 0', () => {
  assert.equal(faceWindowRemaining([], 1000), 0);
  assert.equal(faceWindowRemaining([{ at: 900, pluginId: 'calorie', detectedFaces: 0 }], 1000), 0);
});

check('faceWindowRemaining: 마지막 얼굴 기록 + 10초까지 1 → 0, 9,999ms는 남고 10,000ms는 0', () => {
  const recs = [
    { at: 0, pluginId: 'calorie', detectedFaces: 2 },
    { at: 4000, pluginId: 'calorie', detectedFaces: 1 },
    { at: 6000, pluginId: 'calorie', detectedFaces: 0 },
  ];
  assert.equal(faceWindowRemaining(recs, 4000), 1);
  assert.ok(Math.abs(faceWindowRemaining(recs, 9000) - 0.5) < 1e-9);
  assert.ok(faceWindowRemaining(recs, 13_999) > 0);
  assert.equal(faceWindowRemaining(recs, 14_000), 0);
});

check('josa: 받침·ㄹ 받침', () => {
  assert.equal(josa('웹캠', '을/를'), '웹캠을');
  assert.equal(josa('후면 카메라', '을/를'), '후면 카메라를');
  assert.equal(josa('녹화 영상', '으로/로'), '녹화 영상으로');
  assert.equal(josa('후면 카메라', '으로/로'), '후면 카메라로');
  assert.equal(josa('파일', '으로/로'), '파일로');
});

check('formatBytes: 단위 경계', () => {
  assert.equal(formatBytes(512), '512B');
  assert.equal(formatBytes(19_046), '18.6KB');
  assert.equal(formatBytes(212_000), '207KB');
  assert.equal(formatBytes(7_600_000), '7.2MB');
});

check('parseOutwardMessage: 숫자·불리언만 받고 모양이 다르면 버린다', () => {
  const ok = { type: 'outward', apps: 1, compareMode: true, at: 1000 };
  assert.deepEqual(parseOutwardMessage(ok), ok);
  const extra = parseOutwardMessage({ ...ok, extra: 'x' }); // 남는 필드는 받아도 옮겨 담지 않는다
  assert.ok(extra && extra.apps === 1 && !('extra' in extra));
  assert.equal(parseOutwardMessage({ ...ok, type: 'other' }), null);
  assert.equal(parseOutwardMessage({ ...ok, apps: -1 }), null);
  assert.equal(parseOutwardMessage({ ...ok, apps: 1.5 }), null);
  assert.equal(parseOutwardMessage({ ...ok, apps: '1' }), null);
  assert.equal(parseOutwardMessage({ ...ok, compareMode: 1 }), null);
  assert.equal(parseOutwardMessage({ ...ok, at: Number.NaN }), null);
  assert.equal(parseOutwardMessage(null), null);
});

check('outwardView: 메시지 없음 pending, 5,000ms까지 live, 넘으면 stale', () => {
  const m = { type: 'outward' as const, apps: 0, compareMode: false, at: 10_000 };
  assert.equal(outwardView(null, 0).state, 'pending');
  assert.equal(outwardView(m, 10_000 + OUTWARD_STALE_MS).state, 'live');
  assert.equal(outwardView(m, 10_000 + OUTWARD_STALE_MS + 1).state, 'stale');
});

console.log(`\n${passed}개 통과`);
