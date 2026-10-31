// src/core assertion 스크립트. 실행: npm run check:core
// 테스트 프레임워크 없이 경계 조건만 확인한다(AGENTS.md "테스트").

import assert from 'node:assert/strict';
import { validateManifest, resolveAllowedOrigins, MANIFEST_DEFAULTS } from '../src/core/manifest';
import { createLensStore, type NewDelivery } from '../src/core/store';
import {
  selectCanSend,
  selectDesiredRuntime,
  selectEvictedCount,
  selectFaceM,
  selectOutwardApps,
  selectThroughput,
} from '../src/core/selectors';
import type { DeliveryBranch, FaceCheck } from '../src/core/types';
import { adjustKcal, fallbackText, isValidLabel } from '../src/core/calorie';
import { CAPTURE_FRAME_DEFAULT, CAPTURE_FRAME_MIN_SIDE } from '../src/core/constants';
import { clampFrame, containsBox, cropToFramePx, dragCorner, frameToPx, intersectBox } from '../src/core/frame';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`ok  ${name}`);
}

const calorie = {
  purpose: '음식 칼로리 추정',
  scenes: ['food'],
  region: 'target',
  maxSide: 256,
  quality: 0.8,
  maxPerMinute: 6,
  network: ['$ORIGIN'],
};
const json = (o: unknown) => JSON.stringify(o);

// validateManifest
check('정상 매니페스트 통과', () => {
  const r = validateManifest(json(calorie), 'calorie');
  assert.equal(r.ok, true);
});

check('빠진 region·maxSide·quality·maxPerMinute는 기본값', () => {
  const r = validateManifest(json({ purpose: 'x', scenes: ['food'], network: [] }), 'calorie');
  if (!r.ok) assert.fail(r.errors.join(', '));
  assert.equal(r.manifest.maxSide, MANIFEST_DEFAULTS.maxSide);
  assert.equal(r.manifest.quality, MANIFEST_DEFAULTS.quality);
  assert.equal(r.manifest.maxPerMinute, MANIFEST_DEFAULTS.maxPerMinute);
  assert.equal(r.manifest.region, 'target');
});

check('잘못된 JSON 거부', () => {
  const r = validateManifest('{ "purpose": ', 'calorie');
  assert.equal(r.ok, false);
});

check('모르는 필드 거부', () => {
  const r = validateManifest(json({ ...calorie, extra: 1 }), 'calorie');
  if (r.ok) assert.fail('통과하면 안 됨');
  assert.ok(r.errors.some((e) => e.includes('extra')));
});

check('maxSide 1000 거부(TC-037)', () => {
  assert.equal(validateManifest(json({ ...calorie, maxSide: 1000 }), 'calorie').ok, false);
});

check('maxSide 64 통과(데모 6단계)', () => {
  assert.equal(validateManifest(json({ ...calorie, maxSide: 64 }), 'calorie').ok, true);
});

check('정수가 아닌 maxSide·maxPerMinute 거부', () => {
  assert.equal(validateManifest(json({ ...calorie, maxSide: 100.5 }), 'calorie').ok, false);
  assert.equal(validateManifest(json({ ...calorie, maxPerMinute: 0 }), 'calorie').ok, false);
  assert.equal(validateManifest(json({ ...calorie, maxPerMinute: 31 }), 'calorie').ok, false);
});

check('quality 범위 밖 거부', () => {
  assert.equal(validateManifest(json({ ...calorie, quality: 0.95 }), 'calorie').ok, false);
  assert.equal(validateManifest(json({ ...calorie, quality: 0.49 }), 'calorie').ok, false);
});

check('http origin 거부(TC-037)', () => {
  assert.equal(validateManifest(json({ ...calorie, network: ['http://a.com'] }), 'calorie').ok, false);
});

check('CSP 주입 문자열 거부', () => {
  for (const bad of ['https://a.com; script-src *', 'https://a.com"', '*', "'self'", 'https://a.com/path', 'https://A.com']) {
    assert.equal(validateManifest(json({ ...calorie, network: [bad] }), 'calorie').ok, false, bad);
  }
});

check('포트가 있는 https origin 통과', () => {
  assert.equal(validateManifest(json({ ...calorie, network: ['https://api.example.com:8443'] }), 'calorie').ok, true);
});

check('scenes 빈 배열·모르는 값·중복 거부', () => {
  assert.equal(validateManifest(json({ ...calorie, scenes: [] }), 'calorie').ok, false);
  assert.equal(validateManifest(json({ ...calorie, scenes: ['car'] }), 'calorie').ok, false);
  assert.equal(validateManifest(json({ ...calorie, scenes: ['food', 'food'] }), 'calorie').ok, false);
});

check('purpose 41자 거부, 40자 통과', () => {
  assert.equal(validateManifest(json({ ...calorie, purpose: '가'.repeat(41) }), 'calorie').ok, false);
  assert.equal(validateManifest(json({ ...calorie, purpose: '가'.repeat(40) }), 'calorie').ok, true);
});

check('region은 target만', () => {
  assert.equal(validateManifest(json({ ...calorie, region: 'full' }), 'calorie').ok, false);
});

check('배열·null 최상위 거부', () => {
  assert.equal(validateManifest('[]', 'calorie').ok, false);
  assert.equal(validateManifest('null', 'calorie').ok, false);
});

// resolveAllowedOrigins
check('$ORIGIN은 호스트 origin으로 치환', () => {
  assert.deepEqual(resolveAllowedOrigins(['$ORIGIN'], 'https://app.test'), ['https://app.test']);
});

check('호스트 허용 목록 밖 주소는 빠진다', () => {
  assert.deepEqual(resolveAllowedOrigins(['https://evil.example', '$ORIGIN'], 'https://app.test'), ['https://app.test']);
  assert.deepEqual(resolveAllowedOrigins(['https://evil.example'], 'https://app.test'), []);
});

check('호스트 origin을 직접 적어도 허용', () => {
  assert.deepEqual(resolveAllowedOrigins(['https://app.test'], 'https://app.test'), ['https://app.test']);
});

// ── 칼로리 표·라벨 ──
check('x-label 정규식: COCO 이름은 통과, 주입·변형은 거름', () => {
  for (const ok of ['pizza', 'hot dog', 'broccoli']) assert.ok(isValidLabel(ok), ok);
  for (const bad of ['Pizza', 'hot  dog', 'pizza\n', 'pizza, pizza', ' pizza', 'pizza ', '', 'a'.repeat(33), null, undefined]) {
    assert.equal(isValidLabel(bad), false, JSON.stringify(bad));
  }
});

check('고정표 문장: 표에 있으면 "<이름> 약 <kcal>kcal", 없으면 "음식(종류 미상)"', () => {
  assert.equal(fallbackText('pizza'), '피자 약 285kcal');
  assert.equal(fallbackText('bowl'), '음식(종류 미상)');
  assert.equal(fallbackText('Pizza'), '음식(종류 미상)');
});

check('kcal 보정: 한 판은 8조각 기준이라 2,400은 그대로', () => {
  assert.deepEqual(adjustKcal(2400, '피자', '한 판', 'pizza'), { kcal: 2400, name: '피자', clamped: false });
});

check('kcal 보정: 한 조각인데 터무니없으면 표 값과 표 이름으로', () => {
  assert.deepEqual(adjustKcal(5000, '샌드위치', '한 조각', 'pizza'), { kcal: 285, name: '피자', clamped: true });
  assert.deepEqual(adjustKcal(30, '피자', '한 조각', 'pizza'), { kcal: 285, name: '피자', clamped: true });
});

check('kcal 보정: 비율 비교 뒤에 10~3000으로 자른다', () => {
  assert.deepEqual(adjustKcal(5, '당근', '한 조각', 'carrot'), { kcal: 25, name: '당근', clamped: true });
  assert.deepEqual(adjustKcal(5, '이상한 것', '알 수 없음', null), { kcal: 10, name: '이상한 것', clamped: false });
  assert.deepEqual(adjustKcal(9000, '음식', '알 수 없음', 'bowl'), { kcal: 3000, name: '음식', clamped: false });
});

// ── 스토어 ──
// 시계와 revoke를 바꿔 끼운 스토어를 케이스마다 새로 만든다.
function setup() {
  let t = 1_000;
  const revoked: string[] = [];
  const store = createLensStore({ clock: () => t, revokeUrl: (u) => revoked.push(u), hostOrigin: 'https://app.test' });
  const advance = (ms: number) => {
    t += ms;
  };
  const now = () => t;
  /** B가 iframe을 다 만든 상태로 둔다. */
  const ready = (pluginId = 'calorie', runtimeId = 'r1', connect: 'none' | 'network' = 'network') => {
    const v = store.getState().plugins[pluginId]!.manifest.version;
    store.getState().setPluginRuntime(pluginId, {
      status: 'ready',
      runtimeId,
      runtimePolicy: { connect, manifestVersion: v },
      gateOpen: true,
    });
  };
  let n = 0;
  const delivery = (
    over: Partial<NewDelivery> & { faces?: number; branch?: DeliveryBranch; faceCheck?: FaceCheck } = {},
  ): NewDelivery => {
    n += 1;
    const p = store.getState().plugins[over.pluginId ?? 'calorie']!;
    const { faces = 0, ...rest } = over;
    const base: NewDelivery = {
      pluginId: 'calorie',
      manifestVersion: p.manifest.version,
      runtimeId: p.runtimeId ?? 'none',
      scene: 'food',
      objectLabel: 'pizza',
      branch: '2a',
      bytes: 3,
      width: 256,
      height: 200,
      areaRatio: 0.1,
      cropRect: { x: 0, y: 0, w: 10, h: 10 },
      facesMasked: 0,
      faceCheck: { status: 'checked', detectedFaces: faces },
      location: 'browser',
      sha256: 'abc',
      thumbnailRef: `blob:thumb-${n}`,
      blob: new Blob(['abc']),
      ...rest,
    };
    // raw(비교 모드)는 프레임 전체를 보낸다(F24). 따로 주지 않으면 cropRect를 그 프레임으로 쓴다.
    return base.branch === 'raw' && !base.frameRect ? { ...base, frameRect: base.cropRect } : base;
  };
  /** prepare + dispatched. */
  const send = (over: Parameters<typeof delivery>[0] = {}) => {
    const r = store.getState().prepareDelivery(delivery(over), { sceneDecisionId: null });
    assert.ok(r, 'prepareDelivery가 거부됨');
    assert.equal(store.getState().markDelivery(r.delivery.id, 'dispatched'), true);
    return r;
  };
  return { store, revoked, advance, now, ready, delivery, send };
}

check('시작할 때 플러그인 3개가 시드로 채워진다', () => {
  const { store } = setup();
  const s = store.getState();
  assert.deepEqual(s.pluginOrder, ['calorie', 'tamper', 'hello']);
  assert.equal(s.plugins.calorie!.enabled, true);
  assert.equal(s.plugins.tamper!.enabled, false);
  assert.deepEqual(s.plugins.calorie!.allowedOrigins, ['https://app.test']);
});

check('applyManifest: 통과하면 version+1·게이트 닫힘, 실패하면 그대로', () => {
  const { store, ready } = setup();
  ready();
  const bad = store.getState().applyManifest('calorie', json({ ...calorie, maxSide: 1000 }));
  assert.equal(bad.ok, false);
  assert.equal(store.getState().plugins.calorie!.manifest.version, 1);
  assert.equal(store.getState().plugins.calorie!.gateOpen, true);
  const good = store.getState().applyManifest('calorie', json({ ...calorie, maxSide: 64 }));
  assert.equal(good.ok, true);
  const p = store.getState().plugins.calorie!;
  assert.equal(p.manifest.version, 2);
  assert.equal(p.manifest.maxSide, 64);
  assert.equal(p.gateOpen, false);
  assert.equal(store.getState().applyManifest('nope', json(calorie)).ok, false);
});

check('dispatched만 Counter에 들어가고 두 번 불러도 한 번만 센다', () => {
  const { store, ready, delivery } = setup();
  ready();
  const a = store.getState().prepareDelivery(delivery({ faces: 2 }), { sceneDecisionId: null })!;
  const b = store.getState().prepareDelivery(delivery(), { sceneDecisionId: null })!;
  assert.equal(store.getState().markDelivery(a.delivery.id, 'dispatched'), true);
  assert.equal(store.getState().markDelivery(a.delivery.id, 'dispatched'), false);
  assert.equal(store.getState().markDelivery(a.delivery.id, 'failed'), false);
  assert.equal(store.getState().markDelivery(b.delivery.id, 'failed'), true);
  const s = store.getState();
  assert.deepEqual(s.counter.perPlugin.calorie, { deliveries: 1, faceDeliveries: 1 });
  assert.equal(s.counter.recent10s.length, 1);
  assert.equal(s.deliveries[a.delivery.id]!.blob, null, '전송 뒤 Blob 참조를 놓는다');
});

check('로그 100건 상한: 밀려난 Delivery·Detection 삭제, 썸네일 revoke, Counter는 줄지 않음', () => {
  const { store, ready, delivery, revoked } = setup();
  ready();
  const first = store
    .getState()
    .prepareDelivery(delivery(), { sceneDecisionId: null }, [
      { kind: 'person', box: { x: 0, y: 0, w: 1, h: 1 }, score: 0.9, overlap: 0.1, masked: 'none' },
    ])!;
  store.getState().markDelivery(first.delivery.id, 'dispatched');
  for (let i = 0; i < 100; i += 1) {
    const r = store.getState().prepareDelivery(delivery(), { sceneDecisionId: null })!;
    store.getState().markDelivery(r.delivery.id, 'dispatched');
  }
  const s = store.getState();
  assert.equal(s.logs.length, 100);
  assert.equal(s.deliveries[first.delivery.id], undefined);
  assert.equal(s.detections[first.log.id], undefined);
  assert.deepEqual(revoked, [first.delivery.thumbnailRef]);
  assert.equal(s.counter.perPlugin.calorie!.deliveries, 101);
  assert.equal(selectEvictedCount(s, 'calorie'), 1);
});

check('skip은 같은 플러그인·같은 사유 10초에 1번(9,999ms 버림, 10,000ms 받음)', () => {
  const { store, advance } = setup();
  const skip = (pluginId = 'calorie') =>
    store.getState().addLog({
      pluginId,
      sceneDecisionId: null,
      kind: 'skip',
      branch: null,
      reason: '선언하지 않은 장면',
      enforcedBy: null,
    });
  assert.ok(skip());
  advance(9_999);
  assert.equal(skip(), null);
  assert.ok(skip('hello'), '다른 플러그인은 따로 센다');
  advance(1);
  assert.ok(skip());
  assert.equal(store.getState().logs.length, 3);
});

check('hold 로그는 window60s.holds를 올린다', () => {
  const { store } = setup();
  store.getState().addLog({ pluginId: 'calorie', sceneDecisionId: null, kind: 'hold', branch: '2d', reason: '', enforcedBy: null });
  assert.equal(selectThroughput(store.getState(), 1_000).holds, 1);
});

check('setAck: match·mismatch(violation 1줄)·timeout, 늦은 ack와 보내기 전 ack는 무시', () => {
  const { store, ready, delivery, send } = setup();
  ready();
  const a = send();
  assert.equal(store.getState().setAck(a.delivery.id, 'ABC'), true);
  assert.equal(store.getState().deliveries[a.delivery.id]!.ackStatus, 'match');

  const b = send();
  assert.equal(store.getState().setAck(b.delivery.id, 'zzz'), true);
  assert.equal(store.getState().setAck(b.delivery.id, 'zzz'), false);
  assert.equal(store.getState().deliveries[b.delivery.id]!.ackStatus, 'mismatch');
  const violations = store.getState().logs.filter((l) => l.kind === 'violation');
  assert.equal(violations.length, 1);
  assert.equal(violations[0]!.enforcedBy, 'host');

  const c = send();
  assert.equal(store.getState().setAck(c.delivery.id, null), true);
  assert.equal(store.getState().setAck(c.delivery.id, 'abc'), false, 'timeout 뒤 ack 무시');
  assert.equal(store.getState().deliveries[c.delivery.id]!.ackStatus, 'timeout');

  const d = store.getState().prepareDelivery(delivery(), { sceneDecisionId: null })!;
  assert.equal(store.getState().setAck(d.delivery.id, 'abc'), false, 'prepared 상태 ack 무시');
});

check('M·바깥 표시: 최근 10초 기준, tick은 지난 기록을 지운다', () => {
  const { store, ready, send, advance, now } = setup();
  ready();
  ready('hello', 'h1');
  assert.equal(selectFaceM(store.getState(), now()), 0);
  send({ faces: 2 });
  advance(1_000);
  send({ faces: 1, pluginId: 'hello' });
  assert.equal(selectFaceM(store.getState(), now()), 2);
  assert.equal(selectOutwardApps(store.getState(), now()), 2);
  advance(9_000); // 첫 기록이 정확히 10초 지남
  assert.equal(selectFaceM(store.getState(), now()), 1);
  assert.equal(selectOutwardApps(store.getState(), now()), 1);
  store.getState().tick();
  assert.equal(store.getState().counter.recent10s.length, 1);
  assert.equal(store.getState().counter.perPlugin.calorie!.faceDeliveries, 1, '누적은 줄지 않는다');
});

check('처리량 비율: 프레임이 없으면 null, 있으면 (stage0 + face) / (2 × frames)', () => {
  const { store } = setup();
  assert.equal(selectThroughput(store.getState(), 1_000).ratio, null);
  store.getState().recordRuns({ stage0Runs: 5, faceDetectRuns: 1, sourceFrames: 30 });
  assert.equal(selectThroughput(store.getState(), 1_000).ratio, 6 / 60);
  assert.equal(selectThroughput(store.getState(), 61_000).ratio, null);
});

check('포착 중 전환: runtimeId·manifestVersion이 바뀌면 prepareDelivery 거부', () => {
  const { store, ready, delivery } = setup();
  ready('calorie', 'r1');
  const started = delivery(); // r1, version 1에서 포착 시작
  ready('calorie', 'r2');
  assert.equal(store.getState().prepareDelivery(started, { sceneDecisionId: null }), null);
  const started2 = delivery(); // r2
  store.getState().applyManifest('calorie', json({ ...calorie, maxSide: 64 }));
  ready('calorie', 'r3');
  assert.equal(store.getState().prepareDelivery({ ...started2, runtimeId: 'r3' }, { sceneDecisionId: null }), null);
  assert.equal(store.getState().logs.length, 0);
});

check('raw는 비교 모드 + 칼로리 + connect none iframe일 때만 받는다(G1)', () => {
  const { store, ready, delivery } = setup();
  ready('calorie', 'r1', 'network');
  assert.equal(store.getState().prepareDelivery(delivery({ branch: 'raw' }), { sceneDecisionId: null }), null);
  store.getState().setCompareMode(true);
  assert.equal(store.getState().plugins.calorie!.gateOpen, false, '켜는 즉시 게이트 닫힘');
  ready('calorie', 'r2', 'network'); // 낡은 정책으로 열린 경우
  assert.equal(store.getState().prepareDelivery(delivery({ branch: 'raw' }), { sceneDecisionId: null }), null);
  ready('calorie', 'r3', 'none');
  assert.ok(store.getState().prepareDelivery(delivery({ branch: 'raw' }), { sceneDecisionId: null }));
});

check('비교 모드를 끄면 raw 썸네일·Blob 해제, Counter 기록은 남김', () => {
  const { store, ready, delivery, revoked } = setup();
  store.getState().setCompareMode(true);
  ready('calorie', 'r1', 'none');
  const r = store.getState().prepareDelivery(delivery({ branch: 'raw', faces: 3 }), { sceneDecisionId: null })!;
  store.getState().setCompareMode(false);
  const d = store.getState().deliveries[r.delivery.id]!;
  assert.equal(d.thumbnailRef, null);
  assert.equal(d.blob, null);
  assert.deepEqual(revoked, [r.delivery.thumbnailRef]);
});

check('일시 정지는 게이트와 따로: canSend false, prepareDelivery 거부', () => {
  const { store, ready, delivery } = setup();
  ready();
  store.getState().setPaused(true);
  assert.equal(store.getState().plugins.calorie!.gateOpen, true);
  assert.equal(selectCanSend(store.getState(), 'calorie'), false);
  assert.equal(store.getState().prepareDelivery(delivery(), { sceneDecisionId: null }), null);
  store.getState().setPaused(false);
  assert.equal(selectCanSend(store.getState(), 'calorie'), true);
});

check('stopped·terminated가 되면 enabled = false, 다시 켜면 desiredRuntime이 바뀐다', () => {
  const { store, ready } = setup();
  ready();
  const before = selectDesiredRuntime(store.getState(), 'calorie')!;
  store.getState().setPluginRuntime('calorie', { status: 'stopped' });
  const p = store.getState().plugins.calorie!;
  assert.equal(p.enabled, false);
  assert.equal(p.gateOpen, false);
  store.getState().setPluginEnabled('calorie', true);
  const after = selectDesiredRuntime(store.getState(), 'calorie')!;
  assert.equal(after.enabled, true);
  assert.deepEqual(before, after, '값은 같아도 중간에 false를 거쳐 구독이 두 번 불린다');
});

check('selectInput은 같은 입력도 seq가 오른다', () => {
  const { store } = setup();
  store.getState().selectInput('rear');
  store.getState().selectInput('rear');
  assert.deepEqual(store.getState().session.inputRequest, { kind: 'rear', seq: 2 });
});

check('startNewSession: 새 id, 비교 모드·일시 정지 해제, 로그·Counter 초기화, 매니페스트 유지, 썸네일 revoke', () => {
  const { store, ready, send, revoked } = setup();
  ready();
  store.getState().applyManifest('calorie', json({ ...calorie, maxSide: 64 }));
  ready('calorie', 'r2');
  const r = send({ faces: 1 });
  store.getState().setResult('calorie', { deliveryId: r.delivery.id, text: '피자 약 285kcal', source: 'api', at: 0 });
  store.getState().setPaused(true);
  const oldId = store.getState().session.id;
  store.getState().startNewSession();
  const s = store.getState();
  assert.notEqual(s.session.id, oldId);
  assert.equal(s.session.compareMode, false);
  assert.equal(s.session.paused, false);
  assert.equal(s.logs.length, 0);
  assert.deepEqual(s.deliveries, {});
  assert.deepEqual(s.results, {});
  assert.equal(s.counter.apiSends, 0);
  assert.equal(s.counter.sessionId, s.session.id);
  assert.equal(s.plugins.calorie!.manifest.version, 2);
  assert.equal(s.plugins.calorie!.sessionId, s.session.id);
  assert.equal(s.plugins.calorie!.gateOpen, false);
  assert.deepEqual(revoked, [r.delivery.thumbnailRef]);
});

check('setEngine: 넘긴 필드만 바뀌고 새 세션에도 유지', () => {
  const { store } = setup();
  assert.equal(store.getState().engine.status, 'idle');
  store.getState().setEngine({ status: 'loading', loadedBytes: 10, totalBytes: 100 });
  store.getState().setEngine({ loadedBytes: 100 });
  store.getState().setEngine({ status: 'ready' });
  store.getState().startNewSession();
  assert.deepEqual(store.getState().engine, { status: 'ready', loadedBytes: 100, totalBytes: 100, detail: null });
});

check('setResult: 보낸 전달의 첫 결과만 받고, source api일 때만 apiSends +1', () => {
  const { store, ready, send } = setup();
  ready();
  const a = send();
  const b = send();
  const line = (deliveryId: string, source: 'api' | 'fallback') => ({ deliveryId, text: '피자 약 285kcal', source, at: 0 });
  assert.equal(store.getState().setResult('calorie', line(a.delivery.id, 'fallback')), true);
  assert.equal(store.getState().setResult('calorie', line(b.delivery.id, 'api')), true);
  assert.equal(store.getState().counter.apiSends, 1);
  assert.equal(store.getState().setResult('calorie', line(b.delivery.id, 'api')), false, '두 번째 결과는 버린다');
  assert.equal(store.getState().counter.apiSends, 1);
});

check('setResult: 없는·보내지 않은·다른 플러그인·새 세션 전 전달의 결과는 버린다', () => {
  const { store, ready, delivery, send } = setup();
  ready();
  const line = (deliveryId: string) => ({ deliveryId, text: 'x', source: 'api' as const, at: 0 });
  assert.equal(store.getState().setResult('calorie', line('dlv-none')), false);
  const prepared = store.getState().prepareDelivery(delivery(), { sceneDecisionId: null })!;
  assert.equal(store.getState().setResult('calorie', line(prepared.delivery.id)), false, 'prepared는 아직 보내지 않음');
  const sent = send();
  assert.equal(store.getState().setResult('hello', line(sent.delivery.id)), false, '다른 플러그인');
  store.getState().startNewSession();
  assert.equal(store.getState().setResult('calorie', line(sent.delivery.id)), false, '새 세션 전 전달');
  assert.deepEqual(store.getState().results, {});
  assert.equal(store.getState().counter.apiSends, 0);
});

check('게이트: desired가 지금 값과 다르면 gateOpen: true를 받아도 닫아 둔다', () => {
  const { store } = setup();
  const before = selectDesiredRuntime(store.getState(), 'calorie')!;
  store.getState().setCompareMode(true); // 칼로리의 connect가 'none'으로 바뀐다
  store.getState().setPluginRuntime('calorie', {
    status: 'ready',
    runtimeId: 'old',
    runtimePolicy: { connect: 'network', manifestVersion: 1 },
    gateOpen: true,
    desired: before,
  });
  assert.equal(store.getState().plugins.calorie!.gateOpen, false);
  const now = selectDesiredRuntime(store.getState(), 'calorie')!;
  store.getState().setPluginRuntime('calorie', {
    status: 'ready',
    runtimeId: 'new',
    runtimePolicy: { connect: 'none', manifestVersion: 1 },
    gateOpen: true,
    desired: now,
  });
  assert.equal(store.getState().plugins.calorie!.gateOpen, true);
});

// ── F24 전송 범위 프레임 · F25 사용 기록 ──
check('clampFrame: 0~1 밖은 잘라 낸다(밀어 넣지 않음), 잘라 낸 뒤 최소값 미만·숫자가 아니면 null', () => {
  // 요청 [−0.25, 0.25] × [0.75, 1.25] → 잘라 낸 [0, 0.25] × [0.75, 1]. 사용자가 뺀 0.25 오른쪽은 들어오지 않는다.
  assert.deepEqual(clampFrame({ x: -0.25, y: 0.75, w: 0.5, h: 0.5 }), { x: 0, y: 0.75, w: 0.25, h: 0.25 });
  assert.equal(clampFrame({ x: 0.5, y: 0.5, w: 0.05, h: 0.5 }), null, '한 변 0.05');
  assert.equal(clampFrame({ x: 0.95, y: 0, w: 0.5, h: 0.5 }), null, '잘라 내니 0.05');
  assert.equal(clampFrame({ x: Number.NaN, y: 0, w: 0.5, h: 0.5 }), null);
});

check('dragCorner: 맞은편 꼭짓점은 고정, 끄는 꼭짓점은 0~1 안·최소값에서 멈춤', () => {
  const f = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }; // [0.25, 0.75]
  assert.deepEqual(dragCorner(f, 'tl', -0.5, 0.125), { x: 0, y: 0.125, w: 0.75, h: 0.625 }, '오른쪽·아래 변 그대로');
  const shrunk = dragCorner(f, 'tl', 0.74, 0.74);
  assert.ok(Math.abs(shrunk.w - CAPTURE_FRAME_MIN_SIDE) < 1e-9 && Math.abs(shrunk.h - CAPTURE_FRAME_MIN_SIDE) < 1e-9);
  assert.equal(shrunk.x + shrunk.w, 0.75, '최소값에서 멈춰도 오른쪽 변은 움직이지 않는다');
  assert.deepEqual(dragCorner(f, 'br', 2, Number.NaN), { x: 0.25, y: 0.25, w: 0.75, h: 0.5 }, '숫자가 아닌 축은 그대로');
  assert.ok(clampFrame(shrunk), '최소값으로 줄인 프레임도 setCaptureFrame이 받는다');
});

check('cropToFramePx: 결과는 늘 정수 px로 프레임 안, 1px 미만·숫자가 아니면 null', () => {
  const frame = { x: 144, y: 256, w: 432, h: 768 };
  assert.deepEqual(cropToFramePx({ x: 100.5, y: 299.4, w: 475.7, h: 200.2 }, frame), { x: 144, y: 300, w: 432, h: 199 });
  assert.equal(cropToFramePx({ x: 575.7, y: 300, w: 10, h: 10 }, frame), null, '0.3px 겹침');
  assert.equal(cropToFramePx({ x: Number.NaN, y: 0, w: 10, h: 10 }, frame), null);
  const c = cropToFramePx({ x: 500.2, y: 1000.6, w: 200, h: 200 }, frame)!;
  assert.ok(containsBox(frame, c));
});

check('prepareDelivery: 조각이 프레임 밖으로 나가면, raw가 프레임 전체와 다르면 받지 않는다(F24)', () => {
  const { store, ready, delivery } = setup();
  ready();
  const frameRect = { x: 100, y: 100, w: 200, h: 200 };
  const outside = delivery({ frameRect, cropRect: { x: 90, y: 100, w: 50, h: 50 } });
  assert.equal(store.getState().prepareDelivery(outside, { sceneDecisionId: null }), null);
  assert.ok(store.getState().prepareDelivery(delivery({ frameRect, cropRect: { x: 100, y: 100, w: 50, h: 50 } }), { sceneDecisionId: null }));
  store.getState().setCompareMode(true);
  ready('calorie', 'r2', 'none');
  const rawNoFrame: NewDelivery = { ...delivery({ branch: 'raw' }), frameRect: undefined };
  assert.equal(store.getState().prepareDelivery(rawNoFrame, { sceneDecisionId: null }), null, '프레임 없는 raw');
  const rawPart = delivery({ branch: 'raw', frameRect, cropRect: { x: 100, y: 100, w: 50, h: 50 } });
  assert.equal(store.getState().prepareDelivery(rawPart, { sceneDecisionId: null }), null, '프레임 일부만 담은 raw');
  assert.ok(store.getState().prepareDelivery(delivery({ branch: 'raw', frameRect, cropRect: { ...frameRect } }), { sceneDecisionId: null }));
});

check('frameToPx·intersectBox: 넓힌 대상 박스를 프레임으로 자르면 프레임 안, 겹치지 않으면 null', () => {
  const frame = frameToPx({ ...CAPTURE_FRAME_DEFAULT }, 720, 1280);
  assert.deepEqual(frame, { x: 144, y: 256, w: 432, h: 768 });
  const crop = intersectBox({ x: 100, y: 300, w: 200, h: 200 }, frame)!;
  assert.deepEqual(crop, { x: 144, y: 300, w: 156, h: 200 });
  assert.ok(crop.x >= frame.x && crop.y >= frame.y);
  assert.ok(crop.x + crop.w <= frame.x + frame.w && crop.y + crop.h <= frame.y + frame.h);
  assert.equal(intersectBox({ x: 0, y: 0, w: 100, h: 100 }, frame), null);
  assert.equal(intersectBox({ x: 0, y: 0, w: 144, h: 300 }, frame), null, '변이 닿기만 하면 넓이 0');
});

check('setCaptureFrame: 기본값은 가운데 60%, 0~1 밖은 잘라 쓰고, 너무 작거나 숫자가 아니면 무시, 새 세션에도 유지', () => {
  const { store } = setup();
  assert.deepEqual(store.getState().session.captureFrame, { ...CAPTURE_FRAME_DEFAULT });
  store.getState().setCaptureFrame({ x: 0.75, y: -0.25, w: 0.5, h: 0.5 });
  const trimmed = { x: 0.75, y: 0, w: 0.25, h: 0.25 };
  assert.deepEqual(store.getState().session.captureFrame, trimmed);
  store.getState().setCaptureFrame({ x: 0.5, y: 0.5, w: 0.05, h: 0.5 });
  store.getState().setCaptureFrame({ x: 0, y: 0, w: Number.POSITIVE_INFINITY, h: 0.5 });
  assert.deepEqual(store.getState().session.captureFrame, trimmed);
  store.getState().startNewSession();
  assert.deepEqual(store.getState().session.captureFrame, trimmed);
});

check('사용 기록: dispatched마다 한 줄(프레임 크기 포함), failed는 없음, deliver 로그에 frameRect', () => {
  const { store, ready, delivery, send } = setup();
  ready();
  const frameRect = { x: 144, y: 256, w: 432, h: 768 };
  const r = send({ frameRect, cropRect: { x: 144, y: 300, w: 156, h: 200 } });
  assert.deepEqual(r.log.frameRect, frameRect);
  const failed = store.getState().prepareDelivery(delivery(), { sceneDecisionId: null })!;
  store.getState().markDelivery(failed.delivery.id, 'failed');
  send(); // F24 구현 전 호출(frameRect 없음)
  const usage = store.getState().counter.usage;
  assert.equal(usage.length, 2);
  assert.deepEqual(usage[0], {
    at: usage[0]!.at,
    pluginId: 'calorie',
    deliveryId: r.delivery.id,
    objectLabel: 'pizza',
    bytes: 3,
    frameW: 432,
    frameH: 768,
  });
  assert.equal(usage[1]!.frameW, null);
});

check('대표 조각: 플러그인별 최근 3장, raw 제외, 로그에서 밀려나도 남은 조각의 썸네일은 해제하지 않음', () => {
  const { store, ready, send, revoked } = setup();
  ready();
  const sent = [send(), send(), send(), send()];
  const ids = () => store.getState().usageSamples.calorie!.map((x) => x.deliveryId);
  assert.deepEqual(ids(), sent.slice(1).map((r) => r.delivery.id));
  assert.deepEqual(revoked, [], '빠진 첫 조각은 아직 로그에 있으므로 로그가 해제한다');
  for (let i = 0; i < 100; i += 1) {
    store.getState().addLog({ pluginId: 'calorie', sceneDecisionId: null, kind: 'hold', branch: '2d', reason: `보류 ${i}`, enforcedBy: null });
  }
  for (const r of sent) assert.equal(store.getState().deliveries[r.delivery.id], undefined);
  assert.deepEqual(revoked, [sent[0]!.delivery.thumbnailRef], '대표 조각에 없는 첫 건만 해제');
  // 새 조각이 들어와 가장 오래된 조각이 빠지면, 그 Delivery는 이미 밀려났으므로 이때 해제한다.
  const next = send();
  assert.deepEqual(revoked, [sent[0]!.delivery.thumbnailRef, sent[1]!.delivery.thumbnailRef]);
  store.getState().setCompareMode(true);
  ready('calorie', 'r2', 'none');
  send({ branch: 'raw', faces: 1 });
  assert.deepEqual(ids(), [sent[2]!.delivery.id, sent[3]!.delivery.id, next.delivery.id], 'raw는 넣지 않는다');
  assert.equal(store.getState().counter.usage.length, 6);
});

check('새 세션: 사용 기록·대표 조각을 비우고, 같이 쓰는 썸네일은 한 번만 해제', () => {
  const { store, ready, send, revoked } = setup();
  ready();
  const a = send();
  const b = send();
  store.getState().startNewSession();
  assert.deepEqual([...revoked].sort(), [a.delivery.thumbnailRef, b.delivery.thumbnailRef].sort());
  assert.deepEqual(store.getState().usageSamples, {});
  assert.deepEqual(store.getState().counter.usage, []);
});

console.log(`\n${passed}개 통과`);
