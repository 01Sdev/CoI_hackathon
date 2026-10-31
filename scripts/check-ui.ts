// src/ui assertion 스크립트. 실행: npm run check:ui
// 좌표 변환·시간 창·문구처럼 경계가 있는 함수만 확인한다(AGENTS.md "테스트").

import assert from 'node:assert/strict';
import { APP_NAME, CAPTURE_FRAME_DEFAULT, CAPTURE_FRAME_MIN_SIDE, ORIGIN_TOKEN } from '../src/core/constants';
import type { Box } from '../src/core/types';
import { entryMeta, frameText, logReason, usageMeta, wallClock } from '../src/proof/format';
import { GUARANTEES, OUTFIT_REGION, protocolRows, receiverText, SERVER_UPSTREAM } from '../src/proof/protocol';
import {
  boxCenter,
  coverBox,
  coverPointToSource,
  cornerPoint,
  dragCornerFromScreen,
  faceWindowRemaining,
  gazeChipPoint,
  nudgeCorner,
  PANEL_MIN_H,
  talkPanelPlacement,
  talkPanelWidth,
  sameBox as sameFrame,
  sourceToView,
  viewToSource,
} from '../src/ui/geometry';
import { cameraFor, enabledKind, glassReduce, HOME_CENTER, HOME_ROWS, homeApps, homeRows, type GlassScreen } from '../src/ui/glassHome';
import { isGlassButtonKey } from '../src/ui/glassKeys';
import { calorieView, formatBytes, josa, parseCalorieLine } from '../src/ui/labels';
import { OUTWARD_STALE_MS, outwardView, parseOutwardMessage } from '../src/ui/outward';
import { ANSWER_TEXT_MAX, APP_TEXT_MAX, sanitizeAnswerText, sanitizeAppText } from '../src/ui/sanitize';
import { joinSpeech, transcriptOf } from '../src/ui/useSpeechInput';

let passed = 0;
/** ASCII 숫자를 전각 숫자로(NFKC 확인용). */
const cpw = (digits: string) => Array.from(digits, (d) => String.fromCodePoint(0xff10 + Number(d))).join('');
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

check('boxCenter: 박스 중심을 화면 비율로, 박스가 없거나 화면 크기가 0이면 NaN', () => {
  assert.deepEqual(boxCenter({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, { w: 100, h: 200 }, { w: 200, h: 400 }), { x: 0.5, y: 0.625 });
  // 가로 영상을 세로 화면에 채우면 가운데 대상은 화면 가운데에 남는다.
  const c = boxCenter({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, { w: 1280, h: 720 }, { w: 360, h: 640 });
  assert.ok(Math.abs(c.x - 0.5) < 1e-9 && Math.abs(c.y - 0.5) < 1e-9, `가운데여야 함: ${c.x}, ${c.y}`);
  assert.ok(Number.isNaN(boxCenter(null, null, { w: 360, h: 640 }).x));
  assert.ok(Number.isNaN(boxCenter({ x: 0, y: 0, w: 1, h: 1 }, null, { w: 0, h: 0 }).y));
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

check('parseCalorieLine: "피자 약 285kcal"을 이름과 숫자로, 형식이 다르면 줄 전체가 이름이고 열량은 null', () => {
  assert.deepEqual(parseCalorieLine('피자 약 285kcal'), { name: '피자', kcal: 285 });
  assert.deepEqual(parseCalorieLine('  치즈 피자 두 조각 약 1,140 kcal '), { name: '치즈 피자 두 조각', kcal: 1140 });
  // 전각 숫자(NFKC)도 읽는다.
  assert.deepEqual(parseCalorieLine(`피자 약 ${cpw('285')}kcal`), { name: '피자', kcal: 285 });
  assert.deepEqual(parseCalorieLine('음식(칼로리 정보 없음)'), { name: '음식(칼로리 정보 없음)', kcal: null });
  assert.deepEqual(parseCalorieLine('약 300kcal'), { name: '약 300kcal', kcal: null });
});

check('calorieView: 결과가 없는 최신 전달은 "— kcal"(kcal null), 결과가 오면 같은 id에서 숫자, 고정표는 이름 뒤 표시', () => {
  const latest = { id: 'd2', objectLabel: 'pizza' };
  // 첫 결과 전 계산 중
  assert.deepEqual(calorieView(null, latest), { id: 'd2', name: '피자', kcal: null });
  // 직전 결과(d1)가 남아 있어도 새 전달(d2)이 계산 중이면 옛 숫자를 붙이지 않는다
  assert.deepEqual(calorieView({ deliveryId: 'd1', text: '피자 약 300kcal', source: 'api' }, latest), { id: 'd2', name: '피자', kcal: null });
  // 같은 전달의 결과가 오면 같은 id에서 숫자로('fallback'이 아닌 출처는 모두 보통 결과. B가 더하는 'on-device'도 같다)
  assert.deepEqual(calorieView({ deliveryId: 'd2', text: '피자 약 300kcal', source: 'api' }, latest), { id: 'd2', name: '피자', kcal: 300 });
  assert.deepEqual(calorieView({ deliveryId: 'd2', text: '피자 약 285kcal', source: 'fallback' }, latest), { id: 'd2', name: '피자 (고정표)', kcal: 285 });
  // 전달도 결과도 없으면 창이 없다. 이름이 지워져 비면 창이 없다
  assert.equal(calorieView(null, null), null);
  assert.equal(calorieView({ deliveryId: 'd2', text: `${APP_NAME} 약 300kcal`, source: 'api' }, latest), null);
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

check('receiverText: $ORIGIN은 "{APP_NAME} 서버", 다른 주소는 호스트 이름, 빈 목록은 "밖으로 안 보냄"', () => {
  const self = 'https://framelet-demo.vercel.app';
  assert.deepEqual(receiverText([ORIGIN_TOKEN], [self], self, false), {
    requested: `${APP_NAME} 서버`,
    allowed: `${APP_NAME} 서버만`,
    viaServer: true,
  });
  assert.deepEqual(receiverText([], [], self, false), { requested: '밖으로 안 보냄', allowed: '밖으로 안 보냄', viaServer: false });
  assert.deepEqual(receiverText(['https://evil.example:8443'], [], self, false), {
    requested: 'evil.example',
    allowed: 'evil.example 허용 안 함',
    viaServer: false,
  });
  assert.equal(receiverText([ORIGIN_TOKEN, 'https://x.com'], [self], self, false).allowed, `${APP_NAME} 서버, x.com 허용 안 함`);
  assert.equal(receiverText([ORIGIN_TOKEN], [], self, true).allowed, '지금은 막음 · 비교 모드');
});

check('protocolRows: 칼로리 시드 값이면 설계 §3.2 표 문구가 나온다', () => {
  const rows = protocolRows({ scenes: ['food'], maxSide: 256, maxPerMinute: 6 }, receiverText([ORIGIN_TOKEN], ['o'], 'o', false));
  assert.deepEqual(rows, [
    ['장면', '음식', '음식 앞에 있을 때만'],
    ['영역', '대상 하나', '흰 틀 안의 대상 하나'],
    ['크기', '긴 변 256px', '긴 변 256px까지'],
    ['빈도', '분당 6장', '분당 6장까지'],
    ['받는 곳', `${APP_NAME} 서버`, `${APP_NAME} 서버만`],
  ]);
  assert.equal(GUARANTEES.length, 5);
  assert.ok(GUARANTEES.includes('사람 조각은 동의한 사람만 보내요. 얼굴은 늘 가려요'));
  assert.ok(!GUARANTEES.some((g) => g.includes('모든 얼굴')), '얼굴 검출은 놓칠 수 있어 "모든 얼굴"이라고 쓰지 않는다');
});

check('receiverText·protocolRows: 코디 스캔은 "framelet 서버 → Google Gemini", 영역은 동의한 사람만', () => {
  const self = 'https://framelet-demo.vercel.app';
  const r = receiverText([ORIGIN_TOKEN], [self], self, false, SERVER_UPSTREAM.outfit);
  assert.deepEqual(r, { requested: `${APP_NAME} 서버 → Google Gemini`, allowed: `${APP_NAME} 서버 → Google Gemini만`, viaServer: true });
  assert.equal(SERVER_UPSTREAM.calorie, undefined, '칼로리 문구는 그대로');
  const rows = protocolRows({ scenes: ['person'], maxSide: 512, maxPerMinute: 6 }, r, 'outfit');
  assert.deepEqual(rows[0], ['장면', '사람', '사람 앞에 있을 때만']);
  assert.deepEqual(rows[1], ['영역', '사람 하나', OUTFIT_REGION]);
});

check('sourceToView·viewToSource: 흰 틀 값이 잘린 cover 화면에서도 왕복하고, 같은 값은 다시 쓰지 않는다', () => {
  const src = { w: 1280, h: 720 };
  const dst = { w: 390, h: 844 };
  const f: Box = { x: 0.4, y: 0.25, w: 0.2, h: 0.5 };
  const v = sourceToView(f, src, dst);
  const r = coverBox(f, src, dst);
  assert.ok(Math.abs(v.x * dst.w - r.left) < 1e-9 && Math.abs(v.w * dst.w - r.width) < 1e-9);
  assert.ok(sameFrame(viewToSource(v, src, dst), f));
  assert.ok(!sameFrame(viewToSource({ ...v, x: v.x + 0.01 }, src, dst), f));
  assert.deepEqual(sourceToView(f, src, { w: 0, h: 0 }), f, '크기 0이면 그대로');
});

check('gazeChipPoint: 칩은 상자 위쪽 가운데, 화면 가장자리·위쪽 줄 밖으로 나가지 않는다', () => {
  const dst = { w: 400, h: 800 };
  assert.deepEqual(gazeChipPoint({ x: 0.25, y: 0.5, w: 0.5, h: 0.4 }, null, dst), { x: 200, y: 392 });
  const edge = gazeChipPoint({ x: 0, y: 0, w: 0.1, h: 0.2 }, null, dst);
  assert.equal(edge.x, 72);
  assert.equal(edge.y, 56);
  assert.equal(gazeChipPoint({ x: 0.9, y: 0.99, w: 0.1, h: 0.01 }, null, dst).x, 328);
});

check('isGlassButtonKey: Enter·Space만, 입력창·버튼 초점·조합 중·단축키·이미 받은 키는 넘긴다', () => {
  const key = (k: string, extra: Partial<Parameters<typeof isGlassButtonKey>[0]> = {}) => ({
    key: k,
    defaultPrevented: false,
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    isComposing: false,
    target: null,
    ...extra,
  });
  assert.equal(isGlassButtonKey(key('Enter'), ['Enter']), true);
  assert.equal(isGlassButtonKey(key(' '), ['Enter']), false);
  assert.equal(isGlassButtonKey(key(' '), ['Enter', ' ']), true);
  assert.equal(isGlassButtonKey(key('Enter', { isComposing: true }), ['Enter']), false);
  assert.equal(isGlassButtonKey(key('Enter', { repeat: true }), ['Enter']), false);
  assert.equal(isGlassButtonKey(key('Enter', { metaKey: true }), ['Enter']), false);
  assert.equal(isGlassButtonKey(key('Enter', { defaultPrevented: true }), ['Enter']), false);
  const inInput = { closest: (sel: string) => (sel.includes('input') ? {} : null) } as unknown as EventTarget;
  assert.equal(isGlassButtonKey(key('Enter', { target: inInput }), ['Enter']), false);
  const onBody = { closest: () => null } as unknown as EventTarget;
  assert.equal(isGlassButtonKey(key('Enter', { target: onBody }), ['Enter']), true);
});

check('transcriptOf·joinSpeech: 확정·중간 결과를 이어 붙이고, 다시 켠 인식은 앞 글자 뒤에 붙는다', () => {
  const r = (t: string, isFinal: boolean) => ({ isFinal, 0: { transcript: t } });
  assert.equal(transcriptOf({ length: 2, 0: r('저 사람 ', true), 1: r(' 무슨 옷이야', false) }), '저 사람 무슨 옷이야');
  assert.equal(transcriptOf({ length: 0 }), '');
  assert.equal(joinSpeech('저 사람', '브랜드 알려줘'), '저 사람 브랜드 알려줘');
  assert.equal(joinSpeech('', '브랜드'), '브랜드');
  assert.equal(joinSpeech('브랜드', ''), '브랜드');
});

check('sanitizeAnswerText: 줄바꿈은 남기고 제어·방향 문자와 보호 표시 문구는 지우며 1,000자로 줄인다', () => {
  assert.equal(sanitizeAnswerText('상의: 니트\r\n하의: 데님'), '상의: 니트\n하의: 데님');
  assert.equal(sanitizeAnswerText('a\n\n\n\nb'), 'a\n\nb');
  assert.equal(sanitizeAnswerText(`\u202E반대\u200B로 ${APP_NAME} 보호됨 캐주얼`), '반대로 캐주얼');
  assert.equal(sanitizeAnswerText('  \t 앞뒤  공백 \n '), '앞뒤 공백');
  const long = sanitizeAnswerText('가'.repeat(ANSWER_TEXT_MAX + 5));
  assert.equal(Array.from(long).length, ANSWER_TEXT_MAX);
  assert.ok(long.endsWith('…'));
});

check('talkPanelPlacement: 답 패널은 흰 틀의 사람 수를 덮지 않는다(위 공간이 넉넉하면 위, 아니면 숫자 아래)', () => {
  const phone = { w: 390, h: 844 };
  assert.equal(talkPanelWidth(phone), 260);
  // 틀 위쪽 169px: 숫자(177~201) 위에 154px이 남아 그 높이로 줄인다.
  assert.deepEqual(talkPanelPlacement({ top: 169, right: 337 }, phone), { top: 16, maxHeight: 153 });
  // 틀이 위에 붙으면 숫자 아래(60 + 8 + 24 + 8 = 100)로 내린다.
  const low = talkPanelPlacement({ top: 60, right: 337 }, phone);
  assert.equal(low.top, 100);
  assert.ok(low.maxHeight >= PANEL_MIN_H);
  // 숫자가 패널 왼쪽 밖이면(넓은 화면, 좁은 틀) 그대로 위에 둔다.
  const wide = { w: 1280, h: 800 };
  assert.deepEqual(talkPanelPlacement({ top: 100, right: 700 }, wide), { top: 16, maxHeight: 400 });
  // 숫자가 패널보다 아래에 있어 세로로 안 겹치면 그대로.
  assert.equal(talkPanelPlacement({ top: 900, right: 337 }, { w: 390, h: 1400 }).top, 16);
});

check('glassReduce: 허용 → 홈 → 런처 → 앱, 홈 알약은 앱 → 런처 → 홈, 거부·오류는 안내, 다른 이벤트는 그대로', () => {
  const p: GlassScreen = { name: 'permission' };
  const home = glassReduce(p, { type: 'allow' });
  assert.deepEqual(home, { name: 'home' });
  assert.equal(glassReduce(p, { type: 'open-framelet' }), p, '허용 전에는 홈을 건너뛰지 않는다');
  const launcher = glassReduce(home, { type: 'open-framelet' });
  assert.deepEqual(launcher, { name: 'launcher' });
  assert.equal(glassReduce(home, { type: 'open-app', app: 'calorie' }), home, '홈에서 바로 앱을 열지 않는다');
  const app = glassReduce(launcher, { type: 'open-app', app: 'outfit' });
  assert.deepEqual(app, { name: 'app', app: 'outfit' });
  assert.deepEqual(glassReduce(app, { type: 'home-pill' }), { name: 'launcher' });
  assert.deepEqual(glassReduce(launcher, { type: 'home-pill' }), { name: 'home' });
  assert.equal(glassReduce(home, { type: 'home-pill' }), home);
  assert.equal(glassReduce(app, { type: 'allow' }), app);
  // 거부·오류는 어느 화면에서든 안내로, 안내에서는 새로고침 말고는 나가지 않는다.
  for (const from of [p, home, launcher, app]) assert.deepEqual(glassReduce(from, { type: 'camera-off' }), { name: 'no-camera' });
  const off: GlassScreen = { name: 'no-camera' };
  for (const e of [{ type: 'allow' }, { type: 'open-framelet' }, { type: 'home-pill' }, { type: 'open-app', app: 'calorie' }] as const)
    assert.equal(glassReduce(off, e), off);
  assert.equal(enabledKind(off), null);
});

check('enabledKind·cameraFor: 플러그인은 앱 화면에서 그 하나만, 터치 기기는 가로여도 후면 카메라', () => {
  assert.equal(enabledKind({ name: 'app', app: 'tamper' }), 'tamper');
  for (const name of ['permission', 'home', 'launcher'] as const) assert.equal(enabledKind({ name }), null);
  assert.equal(cameraFor('desktop', true), 'rear', '아이폰 가로 874px는 폭으로는 데스크톱');
  assert.equal(cameraFor('phone', false), 'rear');
  assert.equal(cameraFor('desktop', false), 'webcam');
});

check('homeApps·homeRows: 4/5/4 열세 칸, 정가운데(둘째 줄 3번째)가 framelet', () => {
  assert.deepEqual([...HOME_ROWS], [4, 5, 4]);
  const apps = homeApps(APP_NAME);
  assert.equal(apps.length, 13);
  assert.equal(new Set(apps.map((a) => a.id)).size, 13, '같은 앱이 두 번 나오지 않는다');
  const rows = homeRows(apps);
  assert.deepEqual(rows.map((r) => r.length), [4, 5, 4]);
  assert.equal(rows[1]![2]!.id, 'framelet');
  assert.equal(rows[1]![2]!.label, APP_NAME);
  assert.equal(apps[HOME_CENTER]!.id, 'framelet');
  assert.equal(apps.filter((a) => a.id === 'framelet').length, 1);
});

console.log(`\n${passed}개 통과`);
