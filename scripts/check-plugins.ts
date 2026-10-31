// src/plugins assertion 스크립트. 실행: npm run check:plugins
// 테스트 프레임워크 없이 경계 조건만 확인한다(AGENTS.md "테스트"). 브라우저 시험은 개발 서버의 /dev/m0.html(M0).

import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { build } from 'esbuild';
import { PLUGIN_MESSAGE_LIMITS } from '../src/core/constants';
import { buildCsp, buildSrcdoc, safeConnectList } from '../src/plugins/host/csp';
import { parsePluginMessage, violationReason } from '../src/plugins/host/validate';
import { CALORIE_TABLE, X_LABEL_MAX, X_LABEL_RE, fallbackText } from '../src/core/calorie';
import { caloriePlugin } from '../src/plugins/calorie';
import { buildModelWorkerSource, parseModelSpec, toTensorData, type OnDeviceConfig } from '../src/plugins/calorie-model';
import { calorieSource, pluginSourceFor } from '../src/plugins/registry';
import { sha256Pure } from '../src/plugins/sdk/sha256';
import { buildWorkerSource, pluginCall } from '../src/plugins/sdk/source';

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed += 1;
  console.log(`ok  ${name}`);
}

const nodeSha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const enc = new TextEncoder();
const M0_SHA256 = '358dbf25d013fc82e1a6e8fdeca1f735cf1b8aad35a445c63f01aa39033605e8';
const fixture = new Uint8Array(readFileSync(new URL('../dev/fixtures/m0-test.jpg', import.meta.url)));

// ── sha256Pure ──
await check('sha256Pure: 빈 입력·abc 표준 벡터', () => {
  assert.equal(sha256Pure(new Uint8Array()), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Pure(enc.encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
await check('sha256Pure: 길이 0~300 무작위 = node:crypto', () => {
  for (let n = 0; n <= 300; n++) {
    const b = webcrypto.getRandomValues(new Uint8Array(n));
    assert.equal(sha256Pure(b), nodeSha(b), `길이 ${n}`);
  }
});
await check('sha256Pure: 600KB = node:crypto', () => {
  const b = new Uint8Array(600 * 1024).map((_, i) => (i * 31) & 0xff);
  assert.equal(sha256Pure(b), nodeSha(b));
});
await check('sha256Pure: M0 JPEG = 08-데모-소재.md 값', () => assert.equal(sha256Pure(fixture), M0_SHA256));

// ── parsePluginMessage ──
const L = PLUGIN_MESSAGE_LIMITS;
const ok = (d: unknown) => assert.equal(parsePluginMessage(d).ok, true, JSON.stringify(d).slice(0, 80));
const bad = (d: unknown, kind: 'format' | 'limit') => {
  const r = parsePluginMessage(d);
  assert.equal(r.ok, false, JSON.stringify(d ?? null).slice(0, 80));
  if (!r.ok) assert.equal(r.kind, kind, r.reason);
};
const hex64 = 'a'.repeat(64);
await check('검증: 정상 4종', () => {
  ok({ type: 'ready', pluginId: 'calorie' });
  ok({ type: 'ack', deliveryId: 'd1', sha256: hex64.toUpperCase() });
  ok({ type: 'result', deliveryId: 'd1', text: '피자 약 285kcal', source: 'api' });
  ok({ type: 'violation', attempt: 'fetch', target: 'https://evil.example/x' });
});
await check('검증: 형식 오류(모양·키·열거값·Blob)', () => {
  bad(null, 'format');
  bad('ready', 'format');
  bad([{ type: 'ready' }], 'format');
  bad({ type: 'nope' }, 'format');
  bad({ type: 'ready' }, 'format');
  bad({ type: 'ready', pluginId: 'x', extra: '1' }, 'format');
  bad({ type: 'ack', deliveryId: 'd', sha256: 'abc' }, 'format');
  bad({ type: 'result', deliveryId: 'd', text: 't', source: 'server' }, 'format');
  bad({ type: 'violation', attempt: 'xss', target: 't' }, 'format');
  bad({ type: 'result', deliveryId: 'd', text: 1, source: 'api' }, 'format');
  bad({ type: 'result', deliveryId: 'd', text: new Blob(['x']), source: 'api' }, 'format');
  bad(Object.assign(Object.create(null), { type: 'ready', pluginId: 'x' }), 'format');
});
await check('검증: text 200 통과, 201 한도(UTF-16 길이: 이모지 100개 = 200 통과, 101개 한도)', () => {
  ok({ type: 'result', deliveryId: 'd', text: 'a'.repeat(L.text), source: 'api' });
  ok({ type: 'result', deliveryId: 'd', text: '🍕'.repeat(L.text / 2), source: 'api' });
  bad({ type: 'result', deliveryId: 'd', text: 'a'.repeat(L.text + 1), source: 'api' }, 'limit');
  bad({ type: 'result', deliveryId: 'd', text: '🍕'.repeat(L.text / 2 + 1), source: 'api' }, 'limit');
});
await check('검증: ID 128자·target 512자·8KiB', () => {
  ok({ type: 'ready', pluginId: 'p'.repeat(L.id) });
  bad({ type: 'ready', pluginId: 'p'.repeat(L.id + 1) }, 'limit');
  bad({ type: 'ack', deliveryId: 'd'.repeat(L.id + 1), sha256: hex64 }, 'limit');
  ok({ type: 'violation', attempt: 'script', target: 't'.repeat(L.target) });
  bad({ type: 'violation', attempt: 'script', target: 't'.repeat(L.target + 1) }, 'limit');
  // 길이 한도 안에서는 직렬화가 8KiB에 닿지 않으므로 크기 한도는 따로 줄여 본다.
  const big = parsePluginMessage({ type: 'result', deliveryId: 'd', text: 'a', source: 'api' }, { ...L, maxSerializedBytes: 40 });
  assert.equal(big.ok, false);
  if (!big.ok) assert.equal(big.kind, 'limit');
});

// ── CSP ──
await check('CSP: 허용 목록 치환과 빈 목록', () => {
  assert.equal(
    buildCsp('bm9uY2U=', ['https://framelet.vercel.app']),
    "default-src 'none'; script-src 'nonce-bm9uY2U='; worker-src blob:; connect-src https://framelet.vercel.app",
  );
  assert.equal(buildCsp('bm9uY2U=', []), "default-src 'none'; script-src 'nonce-bm9uY2U='; worker-src blob:; connect-src 'none'");
});
await check('CSP: 주입 문자열은 connect-src에 들어가지 않는다', () => {
  const evil = [
    'https://a.com; script-src *',
    'https://a&quot.com',
    'https://a.com"',
    "'self'",
    '*',
    'https://a.com/path',
    'javascript:alert(1)',
    'https://A.com',
  ];
  assert.deepEqual(safeConnectList(evil), []);
  assert.deepEqual(safeConnectList(['http://localhost:5173', 'https://x.vercel.app']), [
    'http://localhost:5173',
    'https://x.vercel.app',
  ]);
  assert.throws(() => buildCsp('bad nonce', []));
});
await check('srcdoc: meta CSP가 script보다 먼저, </script 금지', () => {
  const doc = buildSrcdoc('bm9uY2U=', buildCsp('bm9uY2U=', []), 'void 0');
  assert.ok(doc.indexOf('Content-Security-Policy') < doc.indexOf('<script nonce="bm9uY2U=">'));
  assert.throws(() => buildSrcdoc('bm9uY2U=', 'x', '"</script><img>"'));
});

// ── violationReason ──
await check('violation reason: connect-src 목록 대조', () => {
  const list = ['https://framelet.vercel.app'];
  assert.match(violationReason('fetch', 'https://evil.example/x', list), /허용 목록 밖$/);
  assert.match(violationReason('fetch', 'https://framelet.vercel.app/api/calorie', list), /허용 목록 안인데 실패$/);
  assert.match(violationReason('script', 'not a url', list), /허용 목록 밖$/);
  assert.equal(violationReason('camera', 'getUserMedia', list), '카메라 접근(camera) getUserMedia');
});

// ── SDK를 Node vm에서(가짜 Worker 전역) ──
interface FakeWorker {
  posted: Record<string, unknown>[];
  dispatch(data: unknown): void;
}
function runWorker(source: string, withSubtle: boolean, extra: Record<string, unknown> = {}): FakeWorker {
  const posted: Record<string, unknown>[] = [];
  const listeners: ((e: { data: unknown }) => void)[] = [];
  const ctx: Record<string, unknown> = {
    postMessage: (m: unknown) => posted.push(JSON.parse(JSON.stringify(m)) as Record<string, unknown>),
    addEventListener: (_t: string, l: (e: { data: unknown }) => void) => listeners.push(l),
    setTimeout,
    clearTimeout,
    Blob,
    crypto: withSubtle ? webcrypto : undefined,
    ...extra,
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return { posted, dispatch: (data) => listeners.forEach((l) => l({ data })) };
}
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const manifest = { purpose: 'x', scenes: ['food'], region: 'target', maxSide: 256, quality: 0.8, maxPerMinute: 6, network: [] };
const init = { type: 'init', pluginId: 'p1', manifest, apiBase: null };
const delivery = (id: string) => ({
  type: 'delivery',
  deliveryId: id,
  scene: 'food',
  objectLabel: 'pizza',
  width: 256,
  height: 192,
  bytes: fixture.length,
  blob: new Blob([fixture], { type: 'image/jpeg' }),
});

/** 시험용 플러그인 본문. SDK 규칙을 건드리는 호출을 일부러 한다. */
const probePlugin = `
framelet.onDelivery(function (d) {
  framelet.result(d.deliveryId, 'x'.repeat(250), 'api');
  framelet.result(d.deliveryId, 'second', 'api');
  framelet.result('never-received', 'nope', 'api');
  framelet.reportViolation('fetch', 'https://evil.example/');
  framelet.reportViolation('fetch', 'https://evil.example/');
  framelet.reportViolation('bogus', 't');
});`;

async function sdkSuite(label: string, make: (plugin: string, test?: Parameters<typeof buildWorkerSource>[1]) => string) {
  await check(`${label}: ready 1번, ready 전 delivery 무시, ack가 결과보다 먼저`, async () => {
    const w = runWorker(make(probePlugin), true);
    w.dispatch(delivery('early'));
    await tick();
    assert.equal(w.posted.length, 0);
    w.dispatch(init);
    w.dispatch(init);
    await tick();
    assert.deepEqual([...w.posted], [{ type: 'ready', pluginId: 'p1' }]);
    w.dispatch(delivery('d1'));
    await tick(50);
    assert.deepEqual(w.posted[1], { type: 'ack', deliveryId: 'd1', sha256: M0_SHA256 });
    assert.equal(w.posted[2]!.type, 'result');
    assert.equal((w.posted[2]!.text as string).length, 200); // String.slice(0, 200)
    assert.deepEqual(w.posted[3], { type: 'violation', attempt: 'fetch', target: 'https://evil.example/' });
    assert.equal(w.posted.length, 4);
  });
  await check(`${label}: subtle 없음·순수 JS 강제 → 같은 해시, corrupt → 다른 해시, suppress → ack 없음`, async () => {
    for (const [subtle, test] of [
      [false, {}],
      [true, { forcePureHash: true }],
    ] as const) {
      const w = runWorker(make('', test), subtle);
      w.dispatch(init);
      await tick();
      w.dispatch(delivery('d1'));
      await tick(50);
      assert.equal(w.posted[1]!.sha256, M0_SHA256);
    }
    const c = runWorker(make('', { testAckMode: 'corrupt' }), true);
    c.dispatch(init);
    await tick();
    c.dispatch(delivery('d1'));
    await tick(50);
    assert.equal(c.posted[1]!.type, 'ack');
    assert.notEqual(c.posted[1]!.sha256, M0_SHA256);
    const s = runWorker(make('', { testAckMode: 'suppress' }), true);
    s.dispatch(init);
    await tick();
    s.dispatch(delivery('d1'));
    await tick(50);
    assert.equal(s.posted.length, 1);
  });
  await check(`${label}: 해시 실패(Blob 읽기 실패) → ack·핸들러 없음`, async () => {
    class BrokenBlob extends Blob {
      override arrayBuffer(): Promise<ArrayBuffer> {
        return Promise.reject(new Error('read failed'));
      }
    }
    const w = runWorker(make(probePlugin), true);
    w.dispatch(init);
    await tick();
    w.dispatch({ ...delivery('d1'), blob: new BrokenBlob([fixture]) });
    await tick(50);
    assert.equal(w.posted.length, 1);
  });
  await check(`${label}: 느린 핸들러가 다음 전달의 ack를 막지 않는다`, async () => {
    const w = runWorker(make('framelet.onDelivery(function () { return new Promise(function (r) { setTimeout(r, 400); }); });'), true);
    w.dispatch(init);
    await tick();
    w.dispatch(delivery('d1'));
    w.dispatch(delivery('d2'));
    await tick(80);
    assert.deepEqual(w.posted.filter((m) => m.type === 'ack').map((m) => m.deliveryId).sort(), ['d1', 'd2']);
  });
  await check(`${label}: onInit 예외 → ready 없음`, async () => {
    const w = runWorker(make("framelet.onInit(function () { throw new Error('x'); });"), true);
    w.dispatch(init);
    await tick();
    assert.equal(w.posted.length, 0);
  });
  await check(`${label}: hello 플러그인 결과 줄`, async () => {
    const w = runWorker(make(pluginSourceFor('hello')!), false);
    w.dispatch(init);
    await tick();
    w.dispatch(delivery('d1'));
    await tick(50);
    assert.match(w.posted[2]!.text as string, /^hello pizza 256×192 7322B · document:undefined · RTCPeerConnection:undefined/);
    assert.equal(w.posted[2]!.source, 'fallback');
  });
}


// ── 칼로리 플러그인(가짜 fetch) ──
interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}
async function runCalorie(apiBase: string | null, fetchImpl: (call: FetchCall, signal: AbortSignal) => Promise<Response>, label = 'pizza') {
  const calls: FetchCall[] = [];
  const fetchMock = (url: string, init: { method: string; headers: Record<string, string>; body: unknown; signal: AbortSignal }) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body };
    calls.push(call);
    return fetchImpl(call, init.signal);
  };
  // 시간 제한은 50ms로 줄여 넣는다(제품은 CALORIE_CLIENT_TIMEOUT_MS = 3초).
  const src = buildWorkerSource(pluginCall(caloriePlugin, CALORIE_TABLE, X_LABEL_RE.source, X_LABEL_MAX, 50, fallbackText(''), null));
  const w = runWorker(src, true, { fetch: fetchMock, AbortController, Response });
  w.dispatch({ ...init, apiBase });
  await tick();
  w.dispatch({ ...delivery('d1'), objectLabel: label });
  await tick(150);
  return { posted: w.posted.slice(1), calls };
}
const never = (_c: FetchCall, signal: AbortSignal) =>
  new Promise<Response>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

await check('칼로리: 200 → 서버 한 줄(api), Blob 그대로·image/jpeg·x-label', async () => {
  const r = await runCalorie('https://h.example', async () => new Response('피자 약 300kcal\n', { status: 200 }), 'hot dog');
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0]!.url, 'https://h.example/api/calorie');
  assert.equal(r.calls[0]!.method, 'POST');
  assert.ok(r.calls[0]!.body instanceof Blob);
  assert.equal((r.calls[0]!.body as Blob).size, fixture.length);
  assert.deepEqual({ ...r.calls[0]!.headers }, { 'Content-Type': 'image/jpeg', 'x-label': 'hot dog' });
  assert.deepEqual(r.posted[1], { type: 'result', deliveryId: 'd1', text: '피자 약 300kcal', source: 'api' });
});
await check('칼로리: 비 200(502·429) → 고정표, 기록 없음', async () => {
  for (const status of [502, 429, 413]) {
    const r = await runCalorie('https://h.example', async () => new Response('x', { status }));
    assert.deepEqual(r.posted.slice(1), [{ type: 'result', deliveryId: 'd1', text: '피자 약 285kcal', source: 'fallback' }]);
  }
});
await check('칼로리: 요청 실패(CSP·네트워크) → 고정표, reportViolation 없음', async () => {
  const r = await runCalorie('https://h.example', async () => {
    throw new TypeError('Failed to fetch');
  });
  assert.deepEqual(r.posted.slice(1), [{ type: 'result', deliveryId: 'd1', text: '피자 약 285kcal', source: 'fallback' }]);
});
await check('칼로리: 시간 초과(abort) → 고정표, 기록 없음', async () => {
  const r = await runCalorie('https://h.example', never);
  assert.deepEqual(r.posted.slice(1), [{ type: 'result', deliveryId: 'd1', text: '피자 약 285kcal', source: 'fallback' }]);
});
await check('칼로리: apiBase null(비교 모드) → 요청 0, 고정표', async () => {
  const r = await runCalorie(null, async () => new Response('x'));
  assert.equal(r.calls.length, 0);
  assert.deepEqual(r.posted.slice(1), [{ type: 'result', deliveryId: 'd1', text: '피자 약 285kcal', source: 'fallback' }]);
});
await check('칼로리: 규칙 밖 라벨(대문자·연속 공백·33자) → x-label 없음, 고정표 밖 문구', async () => {
  for (const label of ['Bowl!', 'hot  dog', 'a'.repeat(33)]) {
    const r = await runCalorie('https://h.example', async () => new Response('x', { status: 502 }), label);
    assert.deepEqual({ ...r.calls[0]!.headers }, { 'Content-Type': 'image/jpeg' });
    assert.equal(r.posted[1]!.text, '음식(종류 미상)');
  }
});
await check('칼로리: Worker 고정표 문구 = core fallbackText(표 10종·표 밖·규칙 밖)', async () => {
  for (const label of [...Object.keys(CALORIE_TABLE), 'bowl', 'cup', 'Pizza', 'pizza ', 'hot  dog', '']) {
    const r = await runCalorie(null, async () => new Response('x'), label);
    assert.equal(r.posted[1]!.text, fallbackText(label), JSON.stringify(label));
  }
});

// ── 변조 플러그인(Worker처럼 document·navigator·importScripts가 없는 vm) ──
// ── 칼로리 기기 안 모델(§2.10) ──
await check('CSP: 칼로리 wasm은 connect-src 안 origin일 때만, script-src는 그 origin의 /ort/까지만', () => {
  const o = 'https://framelet-demo.vercel.app';
  assert.equal(
    buildCsp('bm9uY2U=', [o], o),
    `default-src 'none'; script-src 'nonce-bm9uY2U=' 'wasm-unsafe-eval' ${o}/ort/; worker-src blob:; connect-src ${o}`,
  );
  assert.equal(buildCsp('bm9uY2U=', [], o), "default-src 'none'; script-src 'nonce-bm9uY2U='; worker-src blob:; connect-src 'none'");
  assert.equal(buildCsp('bm9uY2U=', [o], 'https://other.example'), `default-src 'none'; script-src 'nonce-bm9uY2U='; worker-src blob:; connect-src ${o}`);
  assert.equal(buildCsp('bm9uY2U=', [o]), `default-src 'none'; script-src 'nonce-bm9uY2U='; worker-src blob:; connect-src ${o}`);
});

const placeholderDir = new URL('../dev/fixtures/calorie-lens-placeholder/', import.meta.url);
const placeholderSpec = JSON.parse(readFileSync(new URL('model.json', placeholderDir), 'utf8')) as unknown;
await check('model.json: 자리표시 명세 통과, 경로·잘못된 값 거부', () => {
  const s = parseModelSpec(placeholderSpec);
  assert.deepEqual(s.files, ['model.onnx.0', 'model.onnx.1']);
  assert.equal(s.input.resize, 'center-crop');
  assert.equal(s.output.index, 0);
  const base = placeholderSpec as { files: string[]; input: Record<string, unknown>; output: Record<string, unknown> };
  for (const files of [[], ['../x.onnx'], ['a/b.onnx'], ['.hidden'], Array(9).fill('p')]) {
    assert.throws(() => parseModelSpec({ ...base, files }), /model\.json/, JSON.stringify(files));
  }
  for (const input of [
    { std: [0.2, 0, 0.2] },
    { std: [58, 57, 57] },
    { mean: [124, 116, 104] },
    { mean: [0, 0] },
    { width: 0 },
    { width: 2000 },
    { resize: 'fill' },
    { cropFraction: 0 },
    { name: 'a b' },
  ]) {
    assert.throws(() => parseModelSpec({ ...base, input: { ...base.input, ...input } }), /model\.json/, JSON.stringify(input));
  }
  assert.throws(() => parseModelSpec({ ...base, output: { name: 'kcal', index: -1 } }), /model\.json/);
  // 생략 가능: resize(stretch)·cropFraction(1)·index(0).
  const min = parseModelSpec({ files: ['m'], input: { name: 'x', width: 4, height: 4, mean: [0, 0, 0], std: [1, 1, 1] }, output: { name: 'y' } });
  assert.deepEqual([min.input.resize, min.input.cropFraction, min.output.index], ['stretch', 1, 0]);
});

await check('toTensorData: RGBA → NCHW, (v/255 − mean)/std', () => {
  const rgba = [255, 0, 51, 9, 0, 255, 102, 9]; // 2×1
  const t = toTensorData(rgba, 2, 1, [0.5, 0.5, 0.2], [0.5, 0.25, 0.1]);
  assert.deepEqual([...t].map((x) => Math.round(x * 1000) / 1000), [1, -1, -2, 2, 0, 2]);
});

/** 칼로리 플러그인 안에서 만든 하위 Worker 대역. */
class FakeModel {
  static made: FakeModel[] = [];
  sent: Record<string, unknown>[] = [];
  terminated = false;
  private ls: ((e: { data: unknown }) => void)[] = [];
  constructor(public url: string) {
    FakeModel.made.push(this);
  }
  addEventListener(t: string, l: (e: { data: unknown }) => void) {
    if (t === 'message') this.ls.push(l);
  }
  postMessage(m: Record<string, unknown>) {
    // vm 쪽 객체를 이 realm 객체로(deepEqual은 프로토타입까지 본다).
    this.sent.push({ ...m });
  }
  terminate() {
    this.terminated = true;
  }
  emit(data: unknown) {
    for (const l of this.ls) l({ data });
  }
  runs() {
    return this.sent.filter((m) => m.type === 'run');
  }
}
async function onDeviceWorker(
  apiBase: string | null,
  fetchImpl = async () => new Response('피자 약 300kcal', { status: 200 }),
  network: string[] = ['$ORIGIN'],
  make: (onDevice: OnDeviceConfig) => string = (onDevice) =>
    buildWorkerSource(pluginCall(caloriePlugin, CALORIE_TABLE, X_LABEL_RE.source, X_LABEL_MAX, 50, fallbackText(''), onDevice)),
) {
  FakeModel.made = [];
  const calls: string[] = [];
  const onDevice = { workerSource: '/*model*/', ortPath: '/ort/', modelPath: '/models/calorie-lens/', timeoutMs: 50 };
  const src = make(onDevice);
  const w = runWorker(src, true, {
    fetch: (url: string) => (calls.push(url), fetchImpl()),
    AbortController,
    Response,
    Worker: FakeModel,
    URL: { createObjectURL: () => 'blob:model' },
  });
  w.dispatch({ ...init, apiBase, manifest: { ...manifest, network } });
  await tick();
  const results = () => w.posted.filter((m) => m.type === 'result');
  const send = async (id: string, label = 'pizza', ms = 30) => {
    w.dispatch({ ...delivery(id), objectLabel: label });
    await tick(ms);
  };
  return { w, calls, results, send, model: FakeModel.made[0] };
}
const answer = (m: FakeModel, kcal: unknown) => m.emit({ type: 'out', id: m.runs().at(-1)!.id, kcal });

await check('기기 안: 준비되면 on-device("피자 약 1235kcal"), API 요청 0, 받을 곳은 호스트 /ort/·/models/', async () => {
  const r = await onDeviceWorker('https://h.example');
  assert.ok(r.model);
  assert.deepEqual(r.model.sent[0], {
    type: 'load',
    ortBase: 'https://h.example/ort/',
    modelBase: 'https://h.example/models/calorie-lens/',
    budgetMs: 50,
  });
  r.model.emit({ type: 'loaded', ep: 'wasm' });
  r.w.dispatch(delivery('d1'));
  await tick();
  assert.equal(r.model.runs().length, 1);
  assert.ok(r.model.runs()[0]!.blob instanceof Blob);
  answer(r.model, 1234.6);
  await tick();
  assert.deepEqual(r.results(), [{ type: 'result', deliveryId: 'd1', text: '피자 약 1235kcal', source: 'on-device' }]);
  assert.equal(r.calls.length, 0);
});
await check('기기 안: 준비 전 → API, 이름은 0단계 라벨(표 밖은 "음식"), 범위 10~3000', async () => {
  const r = await onDeviceWorker('https://h.example');
  await r.send('d1');
  assert.deepEqual(r.results()[0], { type: 'result', deliveryId: 'd1', text: '피자 약 300kcal', source: 'api' });
  assert.equal(r.model!.runs().length, 0);
  r.model!.emit({ type: 'loaded', ep: 'wasm' });
  for (const [id, label, kcal, text] of [
    ['d2', 'bowl', 412.4, '음식 약 412kcal'],
    ['d3', 'pizza', 7, '피자 약 10kcal'],
    ['d4', 'hot dog', 4_200, '핫도그 약 3000kcal'],
  ] as const) {
    r.w.dispatch({ ...delivery(id), objectLabel: label });
    await tick();
    answer(r.model!, kcal);
    await tick();
    assert.equal(r.results().at(-1)!.text, text, label);
    assert.equal(r.results().at(-1)!.source, 'on-device');
  }
});
await check('기기 안: 실패 값(null·NaN·0 이하)과 5~5000 밖(단위 어긋남) → API, 연달아 2번이면 끈다', async () => {
  for (const kcal of [null, Number.NaN, 0, -5, 'x', 0.42, 4.9, 5_001]) {
    const r = await onDeviceWorker('https://h.example');
    r.model!.emit({ type: 'loaded', ep: 'wasm' });
    r.w.dispatch(delivery('d1'));
    await tick();
    answer(r.model!, kcal);
    await tick();
    assert.equal(r.results().at(-1)!.source, 'api', String(kcal));
    assert.equal(r.model!.terminated, false, String(kcal));
  }
  // 성공이 끼면 다시 센다. 실패가 연달아 2번이면 끈다.
  const r = await onDeviceWorker('https://h.example');
  r.model!.emit({ type: 'loaded', ep: 'wasm' });
  for (const [id, kcal] of [['d1', 0.4], ['d2', 300], ['d3', 0.4]] as const) {
    r.w.dispatch(delivery(id));
    await tick();
    answer(r.model!, kcal);
    await tick();
  }
  assert.deepEqual(r.results().map((m) => m.source), ['api', 'on-device', 'api']);
  assert.equal(r.model!.terminated, false);
  r.w.dispatch(delivery('d4'));
  await tick();
  answer(r.model!, 9_000);
  await tick();
  assert.equal(r.model!.terminated, true);
  await r.send('d5');
  assert.equal(r.model!.runs().length, 4);
  assert.equal(r.results().at(-1)!.source, 'api');
});
await check('기기 안: 시간 초과 → API, 실행 중 전달은 바로 API, 연달아 2번 넘으면 끈다', async () => {
  const r = await onDeviceWorker('https://h.example');
  r.model!.emit({ type: 'loaded', ep: 'wasm' });
  r.w.dispatch(delivery('d1'));
  await tick(5);
  r.w.dispatch(delivery('d2')); // d1이 아직 실행 중
  await tick(120);
  assert.equal(r.model!.runs().length, 1);
  assert.deepEqual(r.results().map((m) => [m.deliveryId, m.source]), [['d2', 'api'], ['d1', 'api']]);
  answer(r.model!, 500); // 늦은 답: busy만 풀린다
  await r.send('d3', 'pizza', 120);
  assert.equal(r.model!.runs().length, 2);
  assert.equal(r.results().at(-1)!.source, 'api');
  assert.equal(r.model!.terminated, true);
  await r.send('d4');
  assert.equal(r.model!.runs().length, 2);
});
await check('기기 안: 한 실행이 제한의 2배를 넘게 안 끝나면 끈다', async () => {
  const r = await onDeviceWorker('https://h.example');
  r.model!.emit({ type: 'loaded', ep: 'wasm' });
  await r.send('d1', 'pizza', 60); // 답 없음 → 50ms 뒤 API, 실행 중 표시는 남는다
  await r.send('d2', 'pizza', 60); // 아직 2배(100ms) 전: 바로 API
  assert.equal(r.model!.terminated, false);
  await tick(20);
  await r.send('d3');
  assert.equal(r.model!.terminated, true);
  assert.deepEqual(r.results().map((m) => m.source), ['api', 'api', 'api']);
});
await check('기기 안: failed면 끄고 API, 비교 모드(apiBase null)·network에 $ORIGIN 없음(F14)은 하위 Worker 없음', async () => {
  const r = await onDeviceWorker('https://h.example');
  r.model!.emit({ type: 'failed', reason: '404' });
  assert.equal(r.model!.terminated, true);
  await r.send('d1');
  assert.equal(r.results()[0]!.source, 'api');
  const c = await onDeviceWorker(null);
  assert.equal(c.model, undefined);
  await c.send('d1');
  assert.deepEqual(c.results()[0], { type: 'result', deliveryId: 'd1', text: '피자 약 285kcal', source: 'fallback' });
  assert.equal(c.calls.length, 0);
  const f14 = await onDeviceWorker('https://h.example', undefined, []);
  assert.equal(f14.model, undefined);
  await f14.send('d1');
  assert.equal(f14.results()[0]!.source, 'api');
});
await check('기기 안: 제품 calorie 소스에 하위 Worker·경로·2.5초가 들어 있다', () => {
  const src = pluginSourceFor('calorie')!;
  assert.match(src, /"ortPath":"\/ort\/","modelPath":"\/models\/calorie-lens\/","timeoutMs":2500/);
  assert.ok(src.includes(JSON.stringify(buildModelWorkerSource())));
});

/** 하위 Worker 본문을 vm에서(가짜 ort·fetch·디코드). */
async function runModelWorker(
  opts: { gpu?: boolean; gpuFails?: boolean; specStatus?: number; outIndex?: number; runMs?: number; budgetMs?: number },
  source = buildModelWorkerSource(),
) {
  const posted: Record<string, unknown>[] = [];
  const listeners: ((e: { data: unknown }) => void)[] = [];
  const imported: string[] = [];
  const created: { bytes: Uint8Array; eps: string[] }[] = [];
  const draws: number[][] = [];
  const fetches: { url: string; cache: string | undefined }[] = [];
  const feeds: { name: string; dims: number[]; data: Float32Array }[] = [];
  const parts: Record<string, Uint8Array> = { 'a.0': new Uint8Array([1, 2, 3]), 'a.1': new Uint8Array([4, 5]) };
  const spec = {
    files: ['a.0', 'a.1'],
    input: { name: 'pixel_values', width: 4, height: 4, mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5], resize: 'center-crop', cropFraction: 0.5 },
    output: { name: 'kcal', index: opts.outIndex ?? 1 },
  };
  const ort = {
    env: { wasm: { numThreads: 4, proxy: true, wasmPaths: null as unknown } },
    Tensor: class {
      constructor(
        public type: string,
        public data: Float32Array,
        public dims: number[],
      ) {}
    },
    InferenceSession: {
      create: async (bytes: Uint8Array, o: { executionProviders: string[] }) => {
        created.push({ bytes, eps: o.executionProviders });
        if (opts.gpuFails && o.executionProviders[0] === 'webgpu') throw new Error('no webgpu');
        return {
          run: async (f: Record<string, { data: Float32Array; dims: number[] }>) => {
            if (opts.runMs) await new Promise((r) => setTimeout(r, opts.runMs));
            for (const [name, t] of Object.entries(f)) feeds.push({ name, dims: t.dims, data: t.data });
            return { kcal: { data: new Float32Array([1, 777.25]) } };
          },
        };
      },
    },
  };
  const ctx: Record<string, unknown> = {
    postMessage: (m: unknown) => posted.push(m as Record<string, unknown>),
    addEventListener: (_t: string, l: (e: { data: unknown }) => void) => listeners.push(l),
    importScripts: (u: string) => {
      imported.push(u);
      ctx.ort = ort;
    },
    navigator: opts.gpu ? { gpu: { requestAdapter: async () => ({}) } } : {},
    fetch: async (url: string, init?: { cache?: string }) => {
      fetches.push({ url, cache: init?.cache });
      if (url.endsWith('model.json')) return new Response(JSON.stringify(spec), { status: opts.specStatus ?? 200 });
      const name = url.slice(url.lastIndexOf('/') + 1);
      const part = parts[name];
      return part ? new Response(new Blob([part.slice()])) : new Response('x', { status: 404 });
    },
    createImageBitmap: async () => ({ width: 8, height: 6, close() {} }),
    OffscreenCanvas: class {
      constructor(
        public w: number,
        public h: number,
      ) {}
      getContext() {
        const { w, h } = this;
        return {
          drawImage: (_b: unknown, ...a: number[]) => draws.push(a),
          getImageData: () => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }),
        };
      }
    },
    performance,
    Blob,
    Uint8Array,
    Float32Array,
    Response,
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  const send = (data: unknown) => listeners.forEach((l) => l({ data }));
  send({ type: 'load', ortBase: 'https://h.example/ort/', modelBase: 'https://h.example/models/calorie-lens/', budgetMs: opts.budgetMs ?? 2_500 });
  await tick(30 + 2 * (opts.runMs ?? 0));
  return { posted, imported, created, draws, feeds, fetches, ort, send };
}
await check('하위 Worker: wasm 판 불러오기, 단일 스레드, 조각 이어 붙이기, 첫 실행 뒤 loaded', async () => {
  const m = await runModelWorker({});
  assert.deepEqual(m.imported, ['https://h.example/ort/ort.wasm.min.js']);
  // model.json만 다시 확인(/models/*는 immutable 캐시), 조각은 캐시 그대로.
  assert.deepEqual(m.fetches.map((f) => [f.url.slice(f.url.lastIndexOf('/') + 1), f.cache]), [
    ['model.json', 'no-cache'],
    ['a.0', undefined],
    ['a.1', undefined],
  ]);
  assert.equal(m.ort.env.wasm.numThreads, 1);
  assert.equal(m.ort.env.wasm.proxy, false);
  assert.deepEqual({ ...(m.ort.env.wasm.wasmPaths as object) }, {
    mjs: 'https://h.example/ort/ort-wasm-simd-threaded.mjs',
    wasm: 'https://h.example/ort/ort-wasm-simd-threaded.wasm',
  });
  assert.deepEqual([...m.created[0]!.bytes], [1, 2, 3, 4, 5]);
  assert.deepEqual([...m.created[0]!.eps], ['wasm']);
  assert.equal(m.feeds.length, 2); // 준비 실행 2번
  assert.equal(m.posted[0]!.type, 'loaded');
  assert.equal(m.posted[0]!.ep, 'wasm');
  assert.equal(m.posted[0]!.bytes, 5);
});
await check('하위 Worker: 디코드·가운데 자르기·NCHW, 출력 index의 kcal', async () => {
  const m = await runModelWorker({});
  m.send({ type: 'run', id: 7, blob: new Blob([fixture], { type: 'image/jpeg' }) });
  await tick(30);
  // 8×6을 짧은 변 4/0.5=8로 맞추면 k=8/6: 원본에서 3×3을 가운데에서 잘라 4×4로.
  assert.deepEqual(m.draws.at(-1), [2.5, 1.5, 3, 3, 0, 0, 4, 4]);
  const f = m.feeds.at(-1)!;
  assert.deepEqual([f.name, [...f.dims], f.data.length, f.data[0], f.data[47]], ['pixel_values', [1, 3, 4, 4], 48, 1, 1]);
  assert.deepEqual(m.posted.at(-1)!.type, 'out');
  assert.deepEqual([m.posted.at(-1)!.id, m.posted.at(-1)!.kcal], [7, 777.25]);
});
await check('하위 Worker: WebGPU면 webgpu 판·asyncify, 세션 실패 시 wasm으로', async () => {
  const g = await runModelWorker({ gpu: true });
  assert.deepEqual(g.imported, ['https://h.example/ort/ort.webgpu.min.js']);
  assert.equal((g.ort.env.wasm.wasmPaths as { wasm: string }).wasm, 'https://h.example/ort/ort-wasm-simd-threaded.asyncify.wasm');
  assert.deepEqual(g.created.map((c) => [...c.eps]), [['webgpu', 'wasm']]);
  assert.equal(g.posted[0]!.ep, 'webgpu');
  const f = await runModelWorker({ gpu: true, gpuFails: true });
  assert.deepEqual(f.created.map((c) => [...c.eps]), [['webgpu', 'wasm'], ['wasm']]);
  assert.equal(f.posted[0]!.ep, 'wasm');
});
await check('하위 Worker: 두 번째 준비 실행이 제한의 80%를 넘는 기기는 failed(느림)', async () => {
  const m = await runModelWorker({ runMs: 40, budgetMs: 20 });
  assert.equal(m.posted[0]!.type, 'failed');
  assert.match(String(m.posted[0]!.reason), /느림: 실행 \d+ms > 16ms/); // 제한의 80%
});
await check('하위 Worker: model.json 404·출력 index 밖 → failed·out null', async () => {
  const m = await runModelWorker({ specStatus: 404 });
  assert.equal(m.posted[0]!.type, 'failed');
  assert.equal(m.imported.length, 0);
  const o = await runModelWorker({ outIndex: 5 });
  o.send({ type: 'run', id: 1, blob: new Blob([fixture]) });
  await tick(30);
  assert.equal(o.posted.at(-1)!.kcal, null);
});
await check('자리표시 모델: 실제 onnxruntime-web(Node, wasm)으로 300 + 100·평균', async () => {
  const ortNode = await import('onnxruntime-web');
  ortNode.env.wasm.numThreads = 1;
  const s = parseModelSpec(placeholderSpec);
  const bytes = Buffer.concat(s.files.map((f) => readFileSync(new URL(f, placeholderDir))));
  const session = await ortNode.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'] });
  const { width: W, height: H, mean, std } = s.input;
  const rgba = new Uint8ClampedArray(W * H * 4).fill(128);
  const out = await session.run({ [s.input.name]: new ortNode.Tensor('float32', toTensorData(rgba, W, H, mean, std), [1, 3, H, W]) });
  const expected = 300 + (100 * [0, 1, 2].reduce((a, c) => a + (128 / 255 - mean[c]!) / std[c]!, 0)) / 3;
  // float32 합이라 15만 값 평균에서 0.03쯤 어긋난다. 표시는 반올림한 정수다.
  assert.ok(Math.abs(Number(out[s.output.name]!.data[s.output.index]) - expected) < 0.1);
  await session.release();
});

await check('변조: 켜면 4종 자기 보고, 차단 실패 없음', async () => {
  const w = runWorker(buildWorkerSource(pluginSourceFor('tamper')!), true, {
    fetch: async () => {
      throw new TypeError('Failed to fetch');
    },
  });
  w.dispatch(init);
  await tick(50);
  const v = w.posted.filter((m) => m.type === 'violation');
  assert.deepEqual(
    v.map((m) => m.attempt),
    ['camera', 'hostDom', 'fetch', 'script'],
  );
  assert.equal(v[0]!.target, 'navigator.mediaDevices.getUserMedia → 없음');
  assert.equal(v[1]!.target, 'document=ReferenceError · parent=ReferenceError · top=ReferenceError · localStorage=ReferenceError');
  assert.equal(v[2]!.target, 'https://example.com/framelet-tamper');
  assert.equal(v[3]!.target, 'https://example.com/framelet-tamper.js');
});

await sdkSuite('SDK(원본)', (plugin, test) => buildWorkerSource(plugin, test));

// esbuild로 축소한 판(Vite 7 기본 build.target = baseline-widely-available과 같은 목록)에서도 toString()이 혼자 돈다.
const VITE_BASELINE_TARGET = ['chrome107', 'edge107', 'firefox104', 'safari16'];
const bundled = await build({
  stdin: {
    contents:
      "export { buildWorkerSource } from './src/plugins/sdk/source';\nexport { pluginSourceFor, calorieSource } from './src/plugins/registry';\nexport { buildModelWorkerSource } from './src/plugins/calorie-model';",
    resolveDir: new URL('..', import.meta.url).pathname,
    loader: 'ts',
  },
  bundle: true,
  minify: true,
  format: 'esm',
  target: VITE_BASELINE_TARGET,
  write: false,
});
const minified = (await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0]!.text).toString('base64')}`
)) as {
  buildWorkerSource: typeof buildWorkerSource;
  pluginSourceFor: typeof pluginSourceFor;
  calorieSource: typeof calorieSource;
  buildModelWorkerSource: typeof buildModelWorkerSource;
};
await check('축소판: Worker 소스가 원본과 다르다(실제로 축소됨)', () => {
  assert.notEqual(minified.buildWorkerSource(''), buildWorkerSource(''));
});
await sdkSuite('SDK(축소)', (plugin, test) => minified.buildWorkerSource(plugin, test));
await check('축소판: hello 플러그인 결과 줄', async () => {
  const w = runWorker(minified.buildWorkerSource(minified.pluginSourceFor('hello')!), false);
  w.dispatch(init);
  await tick();
  w.dispatch(delivery('d1'));
  await tick(50);
  assert.match(w.posted[2]!.text as string, /document:undefined/);
});

await check('축소판: 칼로리 기기 안 경로(on-device 결과)와 하위 Worker 본문', async () => {
  const r = await onDeviceWorker('https://h.example', undefined, ['$ORIGIN'], (onDevice) =>
    minified.buildWorkerSource(minified.calorieSource({ ...onDevice, workerSource: minified.buildModelWorkerSource() })),
  );
  r.model!.emit({ type: 'loaded', ep: 'wasm' });
  r.w.dispatch(delivery('d1'));
  await tick();
  answer(r.model!, 640.4);
  await tick();
  assert.deepEqual(r.results(), [{ type: 'result', deliveryId: 'd1', text: '피자 약 640kcal', source: 'on-device' }]);
  assert.notEqual(minified.buildModelWorkerSource(), buildModelWorkerSource());
  const m = await runModelWorker({}, minified.buildModelWorkerSource());
  assert.equal(m.posted[0]!.type, 'loaded');
  m.send({ type: 'run', id: 3, blob: new Blob([fixture], { type: 'image/jpeg' }) });
  await tick(30);
  assert.deepEqual([m.posted.at(-1)!.id, m.posted.at(-1)!.kcal], [3, 777.25]);
});

console.log(`\n${passed}개 통과`);
