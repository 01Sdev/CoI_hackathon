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
    return {
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

check('setResult: source api일 때만 apiSends +1', () => {
  const { store } = setup();
  store.getState().setResult('calorie', { deliveryId: 'x', text: 'a', source: 'fallback', at: 0 });
  store.getState().setResult('calorie', { deliveryId: 'y', text: 'b', source: 'api', at: 0 });
  assert.equal(store.getState().counter.apiSends, 1);
});

console.log(`\n${passed}개 통과`);
