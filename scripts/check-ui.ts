// src/ui assertion 스크립트. 실행: npm run check:ui
// 좌표 변환·시간 창·문구처럼 경계가 있는 함수만 확인한다(AGENTS.md "테스트").

import assert from 'node:assert/strict';
import { APP_NAME, CAPTURE_FRAME_DEFAULT, CAPTURE_FRAME_MIN_SIDE } from '../src/core/constants';
import type { Box } from '../src/core/types';
import { entryMeta, frameText, logReason, usageMeta, wallClock } from '../src/proof/format';
import { coverBox, coverPointToSource, cornerPoint, dragCornerFromScreen, faceWindowRemaining, nudgeCorner } from '../src/ui/geometry';
import { appResultLine, deliverySignalLines, formatBytes, josa } from '../src/ui/labels';
import { OUTWARD_STALE_MS, outwardView, parseOutwardMessage } from '../src/ui/outward';
import { APP_TEXT_MAX, sanitizeAppText } from '../src/ui/sanitize';

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

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const frame0 = { ...CAPTURE_FRAME_DEFAULT };

check('coverPointToSource: coverBox의 역(잘린 가로 영상에서도 같은 점으로 돌아온다)', () => {
  const src = { w: 1280, h: 720 };
  const dst = { w: 360, h: 640 };
  for (const p of [{ x: 0.5, y: 0.5 }, { x: 0.31, y: 0.12 }, { x: 0.7, y: 0.95 }]) {
    const r = coverBox({ x: p.x, y: p.y, w: 0, h: 0 }, src, dst);
    const back = coverPointToSource({ x: r.left, y: r.top }, src, dst);
    assert.ok(near(back.x, p.x) && near(back.y, p.y), `${p.x},${p.y} → ${back.x},${back.y}`);
  }
});

// 꼭짓점 끌기 규칙(맞은편 고정·0~1·최소 0.1)은 core dragCorner이고 check-core가 본다. 여기는 화면 좌표·키보드 쪽만 본다.
const srcV = { w: 720, h: 1280 }; // 세로 영상
const dstP = { w: 375, h: 812 }; // 휴대폰 화면(좌우가 잘린다)
const screenOf = (x: number, y: number) => {
  const r = coverBox({ x, y, w: 0, h: 0 }, srcV, dstP);
  return { x: r.left, y: r.top };
};
const sameBox = (a: Box, b: Box) => near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h);

check('dragCornerFromScreen: 화면에서 끈 점이 소스 좌표의 꼭짓점이 된다(잘린 cover 화면)', () => {
  const f = dragCornerFromScreen(frame0, 'br', screenOf(0.9, 0.7), srcV, dstP);
  assert.ok(sameBox(f, { x: 0.2, y: 0.2, w: 0.7, h: 0.5 }), JSON.stringify(f));
  const g = dragCornerFromScreen(frame0, 'tl', screenOf(0.1, 0.3), srcV, dstP);
  assert.ok(sameBox(g, { x: 0.1, y: 0.3, w: 0.7, h: 0.5 }), JSON.stringify(g));
});

check('dragCornerFromScreen: 맞은편 너머로 끌어도 최소 크기에서 멈추고, 화면 밖으로 끌면 0~1에서 멈춘다', () => {
  const f = dragCornerFromScreen(frame0, 'tl', screenOf(0.95, 0.95), srcV, dstP);
  assert.ok(sameBox(f, { x: 0.8 - CAPTURE_FRAME_MIN_SIDE, y: 0.8 - CAPTURE_FRAME_MIN_SIDE, w: CAPTURE_FRAME_MIN_SIDE, h: CAPTURE_FRAME_MIN_SIDE }), JSON.stringify(f));
  const g = dragCornerFromScreen(frame0, 'bl', { x: -500, y: 5000 }, srcV, dstP);
  assert.ok(sameBox(g, { x: 0, y: 0.2, w: 0.8, h: 0.8 }), JSON.stringify(g));
});

check('nudgeCorner·cornerPoint: 화살표 키 한 번이 그 꼭짓점만 옮기고 1에서 멈춘다', () => {
  assert.deepEqual(cornerPoint(frame0, 'tr'), { x: 0.8, y: 0.2 });
  const f = nudgeCorner(frame0, 'tr', 0.02, 0);
  assert.ok(sameBox(f, { x: 0.2, y: 0.2, w: 0.62, h: 0.6 }), JSON.stringify(f));
  const g = nudgeCorner({ x: 0.2, y: 0.2, w: 0.79, h: 0.6 }, 'br', 0.05, 0);
  assert.ok(near(g.x + g.w, 1), '오른쪽 끝 1에서 멈춤');
});

check('frameText·entryMeta: deliver와 "프레임 밖" 줄에 프레임 W×H, 없으면 생략', () => {
  assert.equal(frameText({ x: 0, y: 0, w: 120, h: 60 }), '프레임 120×60');
  assert.equal(frameText(null), '');
  const base = { id: 'l', sessionId: 's', pluginId: 'calorie', sceneDecisionId: null, deliveryId: null, branch: null, enforcedBy: null, at: 0 } as const;
  assert.equal(
    entryMeta({ ...base, kind: 'hold', reason: '프레임 밖', frameRect: { x: 10, y: 20, w: 60, h: 30 } }, null),
    '프레임 밖 · 전달 0 · 프레임 60×30',
  );
  assert.equal(entryMeta({ ...base, kind: 'skip', reason: '선언하지 않은 장면(person)' }, null), '선언하지 않은 장면(person) · 전달 0');
});

check('usageMeta: 시각 · 대상 · 바이트 · 프레임, 프레임이 null이면 생략', () => {
  const r = { at: 0, pluginId: 'calorie', deliveryId: 'd', objectLabel: 'pizza', bytes: 19_046, frameW: 432, frameH: 768 };
  assert.equal(usageMeta(r, '21:43:05'), '21:43:05 · 피자 · 18.6KB · 프레임 432×768');
  assert.equal(usageMeta({ ...r, frameW: null, frameH: null }, '21:43:05'), '21:43:05 · 피자 · 18.6KB');
});

check('wallClock: performance 시각을 같은 순간의 벽시계로 바꾼다', () => {
  const dateNow = new Date(2026, 9, 31, 21, 43, 10).getTime();
  assert.equal(wallClock(5_000, 10_000, dateNow), '21:43:05');
  assert.equal(wallClock(10_000, 10_000, dateNow), '21:43:10');
});

check('appResultLine: /hud 앱 결과 줄은 앱 이름으로 시작하고, 고정표면 꼬리를 붙인다', () => {
  assert.equal(appResultLine('칼로리', '피자 약 285kcal', false), '칼로리 · 피자 약 285kcal');
  assert.equal(appResultLine('칼로리', '피자 약 285kcal', true), '칼로리 · 피자 약 285kcal · 고정표');
});

check('deliverySignalLines: 첫 줄은 "{APP_NAME} → 앱 이름", 둘째 줄은 사진·바이트·가림·시간', () => {
  const d = { branch: '2b', bytes: 19_046, facesMasked: 2 } as const;
  assert.deepEqual(deliverySignalLines('칼로리', d, '방금'), [`${APP_NAME} → 칼로리`, '사진 1장 · 18.6KB · 얼굴 2개 가림 · 방금']);
  assert.equal(deliverySignalLines('칼로리', { ...d, branch: '2a', facesMasked: 0 }, '방금')[1], '사진 1장 · 18.6KB · 가릴 사람 없음 · 방금');
  assert.equal(deliverySignalLines('칼로리', { ...d, branch: 'raw', facesMasked: 0 }, '3초 전')[1], '원본 전체 · 18.6KB · 비교 모드라 가리지 않음 · 3초 전');
  assert.ok(!deliverySignalLines('장면 기록', d, '방금')[0].endsWith('앱'), '이름 뒤에 "앱"을 붙이지 않는다');
});

// 보이지 않는 문자는 소스에 그대로 쓰지 않고 코드 포인트로 만든다.
const cp = (...n: number[]) => String.fromCodePoint(...n);

check('sanitizeAppText: 그림 문자·방향·제어 문자를 지우고 줄바꿈은 공백으로', () => {
  assert.equal(sanitizeAppText('피자 약 285kcal'), '피자 약 285kcal');
  assert.equal(sanitizeAppText(`${cp(0x1f7e2)} 피자 ${cp(0x1f355)}`), '피자');
  assert.equal(sanitizeAppText(`${cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467)} 가족 ${cp(0x1f1f0, 0x1f1f7)}`), '가족');
  assert.equal(sanitizeAppText(`${cp(0x202e)}evil${cp(0x202c)} ${cp(0x2066)}x${cp(0x2069)}${cp(0x200f)}`), 'evil x');
  assert.equal(sanitizeAppText(`a${cp(0)}b${cp(0x1b)}[31mc${cp(0x85)}d`), 'ab[31mc d');
  assert.equal(sanitizeAppText('한 줄\n두 줄\r\n세 줄\t끝'), '한 줄 두 줄 세 줄 끝');
});

check('sanitizeAppText: APP_NAME과 보호 카운터 문구를 지운다(대소문자·전각·사이 공백·겹침 포함)', () => {
  assert.equal(sanitizeAppText(`${cp(0x1f7e2)} 보호됨 · 앱에 반영된 사람 0명`), '0명');
  assert.equal(sanitizeAppText(`${APP_NAME} 공식 결과`), '공식 결과');
  assert.equal(sanitizeAppText(`${APP_NAME.toUpperCase()} 확인`), '확인');
  assert.equal(sanitizeAppText(Array.from(APP_NAME).map((c) => String.fromCodePoint(c.codePointAt(0)! + 0xfee0)).join('')), '');
  assert.equal(sanitizeAppText('보 호 됨 ok'), 'ok');
  assert.equal(sanitizeAppText(`${APP_NAME.slice(0, 3)}${APP_NAME}${APP_NAME.slice(3)} x`), 'x');
});

check('sanitizeAppText: 60자에서 자른다(코드 포인트 기준, 마지막은 …)', () => {
  assert.equal(APP_TEXT_MAX, 60);
  const long = sanitizeAppText('가'.repeat(80));
  assert.equal(Array.from(long).length, 60);
  assert.ok(long.endsWith('…'));
  assert.equal(sanitizeAppText('가'.repeat(60)), '가'.repeat(60));
});

check('logReason: 위반 자기 보고는 앱이 보낸 target만 거르고 앞뒤 문구는 둔다', () => {
  const v = { kind: 'violation', enforcedBy: 'plugin-report' } as const;
  assert.equal(
    logReason({ ...v, reason: `외부 요청(fetch) https://evil.example/${cp(0x1f7e2)}보호됨 · 허용 목록 밖` }),
    '외부 요청(fetch) https://evil.example/ · 허용 목록 밖',
  );
  assert.equal(logReason({ ...v, reason: `카메라 접근(camera) ${cp(0x202e)}${APP_NAME}` }), '카메라 접근(camera) (빈 값)');
  assert.equal(logReason({ kind: 'hold', enforcedBy: null, reason: '프레임 밖' }), '프레임 밖');
  assert.equal(logReason({ kind: 'violation', enforcedBy: 'host', reason: `형식 오류: ${cp(0x1f7e2)}x` }), '형식 오류: x');
});

console.log(`\n${passed}개 통과`);
