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
import { CALORIE_FALLBACK_TABLE, UNKNOWN_FOOD_TEXT, caloriePlugin } from '../src/plugins/calorie';
import { pluginSourceFor } from '../src/plugins/registry';
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
await check('검증: text 200자 통과, 201자 한도(코드 포인트, 이모지 200개 통과)', () => {
  ok({ type: 'result', deliveryId: 'd', text: 'a'.repeat(L.text), source: 'api' });
  ok({ type: 'result', deliveryId: 'd', text: '🍕'.repeat(L.text), source: 'api' });
  bad({ type: 'result', deliveryId: 'd', text: 'a'.repeat(L.text + 1), source: 'api' }, 'limit');
});
await check('검증: ID 128자·target 512자·8KiB', () => {
  ok({ type: 'ready', pluginId: 'p'.repeat(L.id) });
  bad({ type: 'ready', pluginId: 'p'.repeat(L.id + 1) }, 'limit');
  bad({ type: 'ack', deliveryId: 'd'.repeat(L.id + 1), sha256: hex64 }, 'limit');
  ok({ type: 'violation', attempt: 'script', target: 't'.repeat(L.target) });
  bad({ type: 'violation', attempt: 'script', target: 't'.repeat(L.target + 1) }, 'limit');
  // 길이 한도 안이지만 직렬화가 8KiB를 넘는 경우: 512자 × 4바이트(이모지) ≈ 2KiB라 크기 한도는 따로 만든다.
  const big = parsePluginMessage({ type: 'result', deliveryId: 'd', text: 'a', source: 'api' }, { ...L, maxSerializedBytes: 40 });
  assert.equal(big.ok, false);
  if (!big.ok) assert.equal(big.kind, 'limit');
});

// ── CSP ──
await check('CSP: 허용 목록 치환과 빈 목록', () => {
  assert.equal(
    buildCsp('bm9uY2U=', ['https://famelet.vercel.app']),
    "default-src 'none'; script-src 'nonce-bm9uY2U='; worker-src blob:; connect-src https://famelet.vercel.app",
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
  const list = ['https://famelet.vercel.app'];
  assert.match(violationReason('fetch', 'https://evil.example/x', list), /허용 목록 밖$/);
  assert.match(violationReason('fetch', 'https://famelet.vercel.app/api/calorie', list), /허용 목록 안인데 실패$/);
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
famelet.onDelivery(function (d) {
  famelet.result(d.deliveryId, 'x'.repeat(250), 'api');
  famelet.result(d.deliveryId, 'second', 'api');
  famelet.result('never-received', 'nope', 'api');
  famelet.reportViolation('fetch', 'https://evil.example/');
  famelet.reportViolation('fetch', 'https://evil.example/');
  famelet.reportViolation('bogus', 't');
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
    assert.equal((w.posted[2]!.text as string).length, 200);
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
  await check(`${label}: onInit 예외 → ready 없음`, async () => {
    const w = runWorker(make("famelet.onInit(function () { throw new Error('x'); });"), true);
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
  const src = buildWorkerSource(pluginCall(caloriePlugin, CALORIE_FALLBACK_TABLE, 50, UNKNOWN_FOOD_TEXT));
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
await check('칼로리: 요청 실패(CSP·네트워크) → violation fetch + 고정표', async () => {
  const r = await runCalorie('https://h.example', async () => {
    throw new TypeError('Failed to fetch');
  });
  assert.deepEqual(r.posted.slice(1), [
    { type: 'violation', attempt: 'fetch', target: 'https://h.example/api/calorie' },
    { type: 'result', deliveryId: 'd1', text: '피자 약 285kcal', source: 'fallback' },
  ]);
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
await check('칼로리: 고정표 밖·헤더에 못 싣는 라벨 → 고정표 밖 문구, x-label 없음', async () => {
  const r = await runCalorie('https://h.example', async () => new Response('x', { status: 502 }), 'Bowl!');
  assert.deepEqual({ ...r.calls[0]!.headers }, { 'Content-Type': 'image/jpeg' });
  assert.equal(r.posted[1]!.text, UNKNOWN_FOOD_TEXT);
});

// ── 변조 플러그인(Worker처럼 document·navigator·importScripts가 없는 vm) ──
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
  assert.equal(v[2]!.target, 'https://example.com/famelet-tamper');
  assert.equal(v[3]!.target, 'https://example.com/famelet-tamper.js');
});

await sdkSuite('SDK(원본)', (plugin, test) => buildWorkerSource(plugin, test));

// esbuild로 축소한 판(Vite 7 기본 build.target = baseline-widely-available과 같은 목록)에서도 toString()이 혼자 돈다.
const VITE_BASELINE_TARGET = ['chrome107', 'edge107', 'firefox104', 'safari16'];
const bundled = await build({
  stdin: {
    contents:
      "export { buildWorkerSource } from './src/plugins/sdk/source';\nexport { pluginSourceFor } from './src/plugins/registry';",
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
)) as { buildWorkerSource: typeof buildWorkerSource; pluginSourceFor: typeof pluginSourceFor };
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

console.log(`\n${passed}개 통과`);
