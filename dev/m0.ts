// M0 관문 시험 페이지(02-SSRD §5, 05 V10, docs/designs/plugin-host.md §2.8). 개발 서버의 /dev/m0.html에서만 열린다.
// 따로 만든 스토어에 hello 변형을 넣고, 이 페이지가 A(broker) 역할을 한다. 결과는 표와 window.__m0.

import { PLUGIN_SEEDS, type PluginSeed } from '../src/core/plugins';
import type { FameletSdk } from '../src/core/sdk';
import { selectPluginTotals } from '../src/core/selectors';
import { createLensStore, type LensStore, type NewDelivery } from '../src/core/store';
import type { AckStatus, Delivery } from '../src/core/types';
import { createPluginHost, sha256Hex, type PluginHost } from '../src/plugins/host';
import { pluginSourceFor } from '../src/plugins/registry';
import { sha256Pure } from '../src/plugins/sdk/sha256';
import { pluginCall, type SdkTestOptions } from '../src/plugins/sdk/source';

/** docs/specs/08-데모-소재.md §1. */
const EXPECTED_SHA256 = '358dbf25d013fc82e1a6e8fdeca1f735cf1b8aad35a445c63f01aa39033605e8';
const FIXTURE = '/dev/fixtures/m0-test.jpg';

interface Row {
  name: string;
  pass: boolean;
  detail: string;
}
declare global {
  interface Window {
    __m0?: { done: boolean; pass: boolean; rows: Row[] };
  }
}
const rows: Row[] = [];
window.__m0 = { done: false, pass: false, rows };

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
function record(name: string, pass: boolean, detail: string) {
  rows.push({ name, pass, detail });
  const tr = document.createElement('tr');
  for (const [text, cls] of [
    [String(rows.length), ''],
    [name, ''],
    [pass ? '통과' : '실패', pass ? 'pass' : 'fail'],
    [detail, ''],
  ] as const) {
    const td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    tr.appendChild(td);
  }
  el('rows').appendChild(tr);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    if (cond()) return true;
    await sleep(5);
  }
  return cond();
}

// ── 시험용 플러그인 ──
const helloJson = PLUGIN_SEEDS.find((s) => s.id === 'hello')!.manifestJson;
const variant = (id: string, enabledByDefault = true): PluginSeed => ({
  id,
  kind: 'hello',
  manifestJson: helloJson,
  enabledByDefault,
});
const seeds = [
  variant('hello'),
  variant('hello-pure'),
  variant('hello-corrupt'),
  variant('hello-silent'),
  variant('hello-reload'),
  variant('hello-noready'),
  variant('hello-spoof', false),
];
const READY_IDS = ['hello', 'hello-pure', 'hello-corrupt', 'hello-silent', 'hello-reload'];
const testOptions: Record<string, SdkTestOptions> = {
  'hello-pure': { forcePureHash: true },
  'hello-corrupt': { testAckMode: 'corrupt' },
  'hello-silent': { testAckMode: 'suppress' },
};

/** 자기 전달을 받으면, 다른 iframe에 보낸 deliveryId로 올바른 해시를 담은 ack를 SDK를 거치지 않고 보낸다. */
function spoofPlugin(famelet: FameletSdk, deliveryId: string, sha256: string): void {
  famelet.onDelivery(() => {
    (self as unknown as { postMessage(m: unknown): void }).postMessage({ type: 'ack', deliveryId, sha256 });
  });
}
/** onInit이 끝나지 않는다 → SDK가 ready를 보내지 않는다. */
function noReadyPlugin(famelet: FameletSdk): void {
  famelet.onInit(() => new Promise<void>(() => undefined));
}
let spoofTarget: { deliveryId: string; sha256: string } | null = null;

function prepare(store: LensStore, pluginId: string, blob: Blob, sha256: string, over: Partial<NewDelivery> = {}) {
  const s = store.getState();
  const p = s.plugins[pluginId];
  if (!p) return null;
  return s.prepareDelivery(
    {
      pluginId,
      manifestVersion: p.runtimePolicy?.manifestVersion ?? p.manifest.version,
      runtimeId: p.runtimeId ?? '',
      scene: 'food',
      objectLabel: 'pizza',
      branch: '2a',
      bytes: blob.size,
      width: 256,
      height: 192,
      areaRatio: 1,
      cropRect: { x: 0, y: 0, w: 256, h: 192 },
      facesMasked: 0,
      faceCheck: { status: 'checked', detectedFaces: 0 },
      location: 'browser',
      sha256,
      thumbnailRef: null,
      blob,
      ...over,
    },
    { sceneDecisionId: null, reason: 'M0' },
  );
}

async function deliver(store: LensStore, host: PluginHost, pluginId: string, blob: Blob, sha256: string) {
  const prepared = prepare(store, pluginId, blob, sha256);
  if (!prepared) return { sent: false, status: 'pending' as AckStatus, ms: 0, delivery: null as Delivery | null };
  const id = prepared.delivery.id;
  // 시각은 스토어 구독으로 잰다(배경 탭에서는 setTimeout 폴링이 1초 단위로 늦어진다).
  let ackedAt: number | null = null;
  const unsub = store.subscribe(
    (s) => s.deliveries[id]?.ackStatus,
    (st) => {
      if (st !== 'pending' && ackedAt === null) ackedAt = performance.now();
    },
  );
  const t0 = performance.now();
  const sent = host.sendDelivery(id);
  await waitFor(() => ackedAt !== null, 3_000);
  unsub();
  const delivery = store.getState().deliveries[id] ?? null;
  const ms = ackedAt === null ? -1 : Math.round((ackedAt - t0) * 10) / 10;
  return { sent, status: delivery?.ackStatus ?? 'pending', ms, delivery };
}

async function run() {
  const blob = await fetch(FIXTURE).then((r) => r.blob());
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const hostHash = await sha256Hex(blob);
  record(
    '고정 JPEG 해시 = 08-데모-소재.md',
    hostHash === EXPECTED_SHA256 && sha256Pure(bytes) === EXPECTED_SHA256,
    `${blob.size}B ${blob.type} · subtle=${typeof crypto.subtle} · ${hostHash}`,
  );

  const store = createLensStore({ seeds });
  let noreadyStoppedAt: number | null = null;
  store.subscribe(
    (s) => s.plugins['hello-noready']?.status,
    (st) => {
      if (st === 'stopped' && noreadyStoppedAt === null) noreadyStoppedAt = performance.now();
    },
  );
  const tHost = performance.now();
  const host = createPluginHost({
    store,
    container: el('frames'),
    sdkTestOptionsFor: (id) => testOptions[id],
    sourceFor: (p) => {
      if (p.id === 'hello-noready') return pluginCall(noReadyPlugin);
      if (p.id === 'hello-spoof') return spoofTarget ? pluginCall(spoofPlugin, spoofTarget.deliveryId, spoofTarget.sha256) : null;
      return pluginSourceFor(p.kind);
    },
  });

  // ready 전에는 스토어가 포착을 받지 않는다.
  const early = prepare(store, 'hello', blob, hostHash);
  record(
    'ready 전 전달 0건',
    early === null && store.getState().plugins.hello!.status === 'loading',
    `status=${store.getState().plugins.hello!.status}, prepareDelivery=${early === null ? 'null' : '받음'}`,
  );

  const allReady = await waitFor(() => READY_IDS.every((id) => store.getState().plugins[id]?.status === 'ready'), 4_000);
  record(
    'iframe → blob Worker → ready',
    allReady,
    `${Math.round(performance.now() - tHost)}ms · ` +
      READY_IDS.map((id) => `${id}=${store.getState().plugins[id]?.status}`).join(', '),
  );

  // iframe 속성·CSP(TC-029). srcdoc의 meta와 script nonce를 직접 읽는다.
  const iframes = [...el('frames').querySelectorAll('iframe')];
  const nonces = new Set<string>();
  let attrOk = iframes.length > 0;
  let cspText = '';
  for (const f of iframes) {
    const doc = new DOMParser().parseFromString(f.srcdoc, 'text/html');
    const csp = doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '';
    const nonce = doc.querySelector('script')?.getAttribute('nonce') ?? '';
    nonces.add(nonce);
    cspText ||= csp;
    attrOk &&=
      f.getAttribute('sandbox') === 'allow-scripts' &&
      f.getAttribute('allow') === '' &&
      !f.sandbox.contains('allow-same-origin') &&
      csp === `default-src 'none'; script-src 'nonce-${nonce}'; worker-src blob:; connect-src 'none'`;
  }
  el('csp').textContent = cspText;
  record(
    'iframe 속성·CSP(sandbox, allow, nonce)',
    attrOk && nonces.size === iframes.length,
    `${iframes.length}개 iframe, nonce ${nonces.size}종 · sandbox="${iframes[0]?.getAttribute('sandbox')}" allow="${iframes[0]?.getAttribute('allow')}"`,
  );

  const m = await deliver(store, host, 'hello', blob, hostHash);
  record('match', m.sent && m.status === 'match', `${m.ms}ms · ack=${m.delivery?.ackSha256 ?? 'null'}`);
  await waitFor(() => !!store.getState().results.hello, 1_000);
  const helloText = store.getState().results.hello?.text ?? '';
  record(
    'Worker 안 document·RTCPeerConnection 없음(TC-051)',
    helloText.includes('document:undefined') && helloText.includes('RTCPeerConnection:undefined'),
    helloText || '결과 줄 없음',
  );

  const pure = await deliver(store, host, 'hello-pure', blob, hostHash);
  record('match(순수 JS 해시 강제, TC-059)', pure.sent && pure.status === 'match', `${pure.ms}ms`);

  const bad = await deliver(store, host, 'hello-corrupt', blob, hostHash);
  const mismatchLog = store
    .getState()
    .logs.find((l) => l.pluginId === 'hello-corrupt' && l.kind === 'violation' && l.reason === '해시 불일치');
  record(
    'mismatch(플러그인 쪽 바이트 1개 변조)',
    bad.sent && bad.status === 'mismatch' && mismatchLog?.enforcedBy === 'host',
    `${bad.ms}ms · ack=${bad.delivery?.ackSha256 ?? 'null'} · 로그 "${mismatchLog?.reason ?? '없음'}"(${mismatchLog?.enforcedBy ?? '-'})`,
  );

  // timeout. 2초 안에 호스트 창 자신이 보낸 가짜 ack와 다른 iframe(hello-spoof)이 보낸 ack가 와도 받지 않아야 한다.
  // 위조 ack가 pending 동안 도착하도록 hello-spoof를 먼저 띄워 두고(ready), silent 전달 직후 spoof에도 하나 보낸다.
  const silent = prepare(store, 'hello-silent', blob, hostHash);
  const silentId = silent?.delivery.id ?? '';
  spoofTarget = { deliveryId: silentId, sha256: hostHash };
  store.getState().setPluginEnabled('hello-spoof', true);
  await waitFor(() => store.getState().plugins['hello-spoof']?.status === 'ready', 4_000);
  const logsBefore = store.getState().logs.length;
  const tSilent = performance.now();
  let silentEndAt: number | null = null;
  const unsubSilent = store.subscribe(
    (s) => s.deliveries[silentId]?.ackStatus,
    (st) => {
      if (st !== 'pending' && silentEndAt === null) silentEndAt = performance.now();
    },
  );
  const silentSent = host.sendDelivery(silentId);
  window.postMessage({ type: 'ack', deliveryId: silentId, sha256: hostHash }, '*');
  const spoofDelivery = prepare(store, 'hello-spoof', blob, hostHash);
  const spoofSent = spoofDelivery ? host.sendDelivery(spoofDelivery.delivery.id) : false;
  await waitFor(() => silentEndAt !== null, 3_000);
  unsubSilent();
  const silentEnd = store.getState().deliveries[silentId];
  const msSilent = silentEndAt === null ? -1 : Math.round(silentEndAt - tSilent);
  const pendingAt19 = msSilent >= 1_900;
  record(
    'timeout(ack 억제)',
    silentSent && pendingAt19 && silentEnd?.ackStatus === 'timeout' && silentEnd.ackSha256 === null,
    `${msSilent}ms 뒤 ${silentEnd?.ackStatus}(1.9초 전 바뀌지 않음=${pendingAt19}) · ackSha256=${silentEnd?.ackSha256 ?? 'null'}`,
  );
  const newLogs = store.getState().logs.slice(logsBefore).filter((l) => l.kind === 'violation');
  const spoofLogs = newLogs.filter((l) => l.pluginId === 'hello-spoof');
  record(
    '다른 event.source(호스트 창)의 ack 무시',
    silentEnd?.ackStatus === 'timeout' && newLogs.every((l) => l.pluginId === 'hello-spoof'),
    `새 로그 ${newLogs.length}줄, hello-spoof 외 0줄이어야 함`,
  );
  record(
    '다른 iframe에 보낸 deliveryId의 ack 거부',
    spoofSent &&
      silentEnd?.ackStatus === 'timeout' &&
      spoofLogs.length === 1 &&
      spoofLogs[0]!.enforcedBy === 'host' &&
      spoofLogs[0]!.reason.includes('보내지 않은 deliveryId'),
    spoofLogs.map((l) => `${l.reason}(${l.enforcedBy})`).join(' / ') || '로그 없음',
  );

  // sendDelivery 거부 → failed, 전달 수에 안 들어감.
  const totalsBefore = selectPluginTotals(store.getState(), 'hello').deliveries;
  const recentBefore = store.getState().counter.recent10s.length;
  const wrong = prepare(store, 'hello', blob, hostHash, { bytes: blob.size + 1 });
  const wrongSent = wrong ? host.sendDelivery(wrong.delivery.id) : true;
  const wrongEnd = wrong ? store.getState().deliveries[wrong.delivery.id] : undefined;
  record(
    'bytes ≠ blob.size → failed, 전달 수 그대로',
    !!wrong &&
      !wrongSent &&
      wrongEnd?.sendStatus === 'failed' &&
      selectPluginTotals(store.getState(), 'hello').deliveries === totalsBefore &&
      store.getState().counter.recent10s.length === recentBefore,
    `sendStatus=${wrongEnd?.sendStatus} · 전달 수 ${totalsBefore} → ${selectPluginTotals(store.getState(), 'hello').deliveries}`,
  );

  await waitFor(() => noreadyStoppedAt !== null, 4_000);
  const nr = store.getState().plugins['hello-noready']!;
  record(
    'ready 없음 → 3초 뒤 stopped, enabled false(TC-061)',
    nr.status === 'stopped' && !nr.enabled && nr.runtimeId === null,
    `${noreadyStoppedAt === null ? '-' : Math.round(noreadyStoppedAt - tHost)}ms · status=${nr.status} enabled=${nr.enabled}`,
  );

  // 매니페스트 재적용 = 전환 공통 절차. 옛 runtimeId로 시작한 포착은 거부된다.
  const before = store.getState().plugins.hello!;
  const oldRuntimeId = before.runtimeId;
  const oldVersion = before.runtimePolicy?.manifestVersion ?? 0;
  const applied = store.getState().applyManifest('hello', helloJson);
  const during = store.getState().plugins.hello!;
  const stale = prepare(store, 'hello', blob, hostHash, { runtimeId: oldRuntimeId ?? '', manifestVersion: oldVersion });
  await waitFor(() => store.getState().plugins.hello?.status === 'ready', 3_000);
  const after = store.getState().plugins.hello!;
  const again = await deliver(store, host, 'hello', blob, hostHash);
  record(
    '매니페스트 재적용: 새 runtimeId, 옛 포착 거부, 다시 match',
    applied.ok &&
      during.status === 'loading' &&
      !during.gateOpen &&
      stale === null &&
      after.status === 'ready' &&
      after.runtimeId !== oldRuntimeId &&
      after.runtimePolicy?.manifestVersion === oldVersion + 1 &&
      again.status === 'match',
    `v${oldVersion} → v${after.runtimePolicy?.manifestVersion} · 전환 중 ${during.status}/gate=${during.gateOpen} · ` +
      `옛 포착=${stale === null ? '거부' : '받음'} · 전환 뒤 ${after.status}/gate=${after.gateOpen} · ` +
      `다시 보냄=${again.sent} ${again.status} ${again.ms}ms`,
  );

  // 재로드(TC-030): srcdoc을 다시 넣으면 두 번째 load.
  const reloadFrame = el('frames').querySelector<HTMLIFrameElement>('iframe[data-plugin-id="hello-reload"]');
  if (reloadFrame) reloadFrame.srcdoc = reloadFrame.srcdoc;
  await waitFor(() => store.getState().plugins['hello-reload']?.status === 'terminated', 2_000);
  const rl = store.getState().plugins['hello-reload']!;
  const reloadLog = store.getState().logs.find((l) => l.pluginId === 'hello-reload' && l.reason === 'iframe 재로드');
  record(
    'iframe 재로드 → 종료·기록(TC-030)',
    rl.status === 'terminated' && !rl.enabled && reloadLog?.enforcedBy === 'host' && !el('frames').querySelector('iframe[data-plugin-id="hello-reload"]'),
    `status=${rl.status} · 로그 "${reloadLog?.reason ?? '없음'}"(${reloadLog?.enforcedBy ?? '-'})`,
  );

  const pass = rows.every((r) => r.pass);
  el('summary').textContent = pass ? `M0 통과 (${rows.length}/${rows.length})` : `실패 ${rows.filter((r) => !r.pass).length}건`;
  window.__m0 = { done: true, pass, rows };
}

run().catch((err: unknown) => {
  record('실행 오류', false, String(err));
  el('summary').textContent = '실행 오류';
  window.__m0 = { done: true, pass: false, rows };
});
