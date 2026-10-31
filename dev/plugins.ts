// 칼로리·변조 플러그인 시험 페이지(F7·F13·F14·F17, FR-024·025·031·032·047, TC-006·016). 개발 서버의 /dev/plugins.html.
// 서버가 없으면(/api/calorie 404) 칼로리는 고정표로 끝난다. 서버가 있으면 source api 한 줄을 받는다.
// 기기 안 모델은 끄고 본다(94MB 모델을 iframe마다 받지 않게). 기기 안 경로는 /dev/on-device.html.

import { fallbackText } from '../src/core/calorie';
import { PLUGIN_SEEDS, type PluginSeed } from '../src/core/plugins';
import { createLensStore } from '../src/core/store';
import { createPluginHost, sha256Hex } from '../src/plugins/host';
import { calorieSource, pluginSourceFor } from '../src/plugins/registry';
import { FIXTURE, createReport, deliver, el, sleep, waitFor } from './lib';

const { record, finish } = createReport('__plugins');

const seed = (id: string) => PLUGIN_SEEDS.find((s) => s.id === id)!;
const calorieManifest = JSON.parse(seed('calorie').manifestJson) as Record<string, unknown>;
const seeds: PluginSeed[] = [
  { ...seed('calorie') },
  // F14 데모: network에서 칼로리 도메인을 지운 상태.
  { id: 'calorie-blocked', kind: 'calorie', manifestJson: JSON.stringify({ ...calorieManifest, network: [] }), enabledByDefault: true },
  { ...seed('tamper'), enabledByDefault: false },
];
const FALLBACK_PIZZA = '피자 약 285kcal';
const API_LINE = /^(\S.{0,11} 약 \d+kcal|음식 아님)$/;

function cspOf(pluginId: string): string {
  const f = el('frames').querySelector<HTMLIFrameElement>(`iframe[data-plugin-id="${pluginId}"]`);
  if (!f) return '';
  const doc = new DOMParser().parseFromString(f.srcdoc, 'text/html');
  return doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '';
}
const connectSrc = (pluginId: string) => /connect-src ([^;]+)$/.exec(cspOf(pluginId))?.[1] ?? '';

async function run() {
  const blob = await fetch(FIXTURE).then((r) => r.blob());
  const sha = await sha256Hex(blob);
  const store = createLensStore({ seeds });
  const host = createPluginHost({
    store,
    container: el('frames'),
    sourceFor: (p) => (p.kind === 'calorie' ? calorieSource(null) : pluginSourceFor(p.kind)),
  });
  const st = () => store.getState();
  const violations = (pluginId: string) => st().logs.filter((l) => l.pluginId === pluginId && l.kind === 'violation');
  const resultFor = async (pluginId: string, deliveryId: string) => {
    await waitFor(() => st().results[pluginId]?.deliveryId === deliveryId, 4_000);
    const r = st().results[pluginId];
    return r?.deliveryId === deliveryId ? r : null;
  };

  const ready = await waitFor(() => ['calorie', 'calorie-blocked'].every((id) => st().plugins[id]?.status === 'ready'), 4_000);
  el('csp').textContent = cspOf('calorie');
  record(
    '칼로리 iframe ready, connect-src = network ∩ 허용 목록',
    ready && connectSrc('calorie') === location.origin && connectSrc('calorie-blocked') === "'none'",
    `calorie: ${connectSrc('calorie')} · calorie-blocked: ${connectSrc('calorie-blocked')}`,
  );

  // 1. 정상: Blob 그대로 POST → 서버 한 줄(api) 또는 비 200이면 고정표.
  const t0 = performance.now();
  const ok = await deliver(store, host, 'calorie', blob, sha);
  const okResult = await resultFor('calorie', ok.id);
  const okMs = Math.round(performance.now() - t0);
  // 서버가 비 200을 주거나(키 없음 502 등) 요청이 실패하면 고정표. 어느 쪽이든 기록은 남기지 않는다(02-SSRD "플러그인 SDK").
  const okLogs = violations('calorie');
  const okPass =
    ok.status === 'match' &&
    !!okResult &&
    (okResult.source === 'api' ? API_LINE.test(okResult.text) : okResult.text === FALLBACK_PIZZA) &&
    okLogs.length === 0;
  record(
    '칼로리: 전달 → ack match → 결과 한 줄(서버 없으면 고정표)',
    okPass,
    `${okMs}ms · ack ${ok.status} · "${okResult?.text ?? '없음'}"(${okResult?.source ?? '-'}) · 기록 ${okLogs.map((l) => l.reason).join(' / ') || '0줄'}`,
  );

  // 2. F14: network에서 도메인을 지운 iframe → CSP가 막는다 → 고정표. 칼로리는 차단을 자기 보고하지 않는다.
  const blocked = await deliver(store, host, 'calorie-blocked', blob, sha);
  const blockedResult = await resultFor('calorie-blocked', blocked.id);
  await sleep(300);
  const bv = violations('calorie-blocked');
  record(
    '도메인 삭제(F14): CSP 차단 → 고정표, 기록 없음',
    blockedResult?.text === FALLBACK_PIZZA && blockedResult.source === 'fallback' && bv.length === 0,
    `"${blockedResult?.text ?? '없음'}"(${blockedResult?.source ?? '-'}) · 기록 ${bv.length}줄`,
  );

  // 3. 고정표에 없는 라벨.
  const bowl = await deliver(store, host, 'calorie-blocked', blob, sha, { objectLabel: 'bowl' });
  const bowlResult = await resultFor('calorie-blocked', bowl.id);
  record(
    '고정표 밖 라벨(bowl) → "음식(종류 미상)"(core fallbackText)',
    bowlResult?.text === fallbackText('bowl') && bowlResult.text === '음식(종류 미상)' && violations('calorie-blocked').length === 0,
    `"${bowlResult?.text ?? '없음'}" · 기록 ${violations('calorie-blocked').length}줄`,
  );

  // 4. 비교 모드(F17): 칼로리 iframe을 connect-src 'none', apiBase null로 다시 만든다 → raw도 받고, 요청·차단 기록 0.
  const oldRuntime = st().plugins.calorie!.runtimeId;
  st().setCompareMode(true);
  const compareReady = await waitFor(
    () => st().plugins.calorie?.status === 'ready' && st().plugins.calorie?.runtimePolicy?.connect === 'none',
    4_000,
  );
  const logsBefore = st().logs.filter((l) => l.kind === 'violation').length;
  const raw = await deliver(store, host, 'calorie', blob, sha, {
    branch: 'raw',
    faceCheck: { status: 'checked', detectedFaces: 2 },
  });
  const rawResult = await resultFor('calorie', raw.id);
  await sleep(300);
  record(
    "비교 모드: connect-src 'none' iframe으로 교체, raw 받고 고정표, 차단 기록 0",
    compareReady &&
      st().plugins.calorie!.runtimeId !== oldRuntime &&
      connectSrc('calorie') === "'none'" &&
      raw.sent &&
      rawResult?.text === FALLBACK_PIZZA &&
      rawResult.source === 'fallback' &&
      st().logs.filter((l) => l.kind === 'violation').length === logsBefore,
    `connect-src ${connectSrc('calorie')} · raw sent=${raw.sent} · "${rawResult?.text ?? '없음'}"(${rawResult?.source ?? '-'}) · 새 차단 기록 ${st().logs.filter((l) => l.kind === 'violation').length - logsBefore}`,
  );
  st().setCompareMode(false);
  const backReady = await waitFor(
    () => st().plugins.calorie?.status === 'ready' && st().plugins.calorie?.runtimePolicy?.connect === 'network',
    4_000,
  );
  // 보호 모드에서는 스토어가 raw 포착을 받지 않는다(prepare null → id '').
  const rawAfter = await deliver(store, host, 'calorie', blob, sha, { branch: 'raw' });
  record(
    '비교 모드 끄기: 원래 network iframe으로, raw는 거부',
    backReady && connectSrc('calorie') === location.origin && rawAfter.id === '',
    `connect-src ${connectSrc('calorie')} · raw prepare=${rawAfter.id === '' ? '거부' : '받음'}`,
  );

  // 5. 변조(F13): 켜면 4종 자기 보고, fetch·script는 허용 목록 밖, 차단 실패 없음.
  st().setPluginEnabled('tamper', true);
  await waitFor(() => st().plugins.tamper?.status === 'ready', 4_000);
  await waitFor(() => violations('tamper').length >= 4, 3_000);
  const tv = violations('tamper');
  const byAttempt = (prefix: string) => tv.find((l) => l.reason.startsWith(prefix))?.reason ?? '';
  record(
    '변조 4종: 카메라·호스트 화면 없음, 외부 fetch·script 허용 목록 밖(plugin-report)',
    tv.length === 4 &&
      tv.every((l) => l.enforcedBy === 'plugin-report' && !l.reason.includes('차단 실패')) &&
      byAttempt('카메라 접근(camera)').endsWith('getUserMedia → 없음') &&
      /document=ReferenceError · parent=ReferenceError · top=ReferenceError · localStorage=ReferenceError$/.test(
        byAttempt('호스트 화면 접근(hostDom)'),
      ) &&
      byAttempt('외부 요청(fetch)').endsWith('· 허용 목록 밖') &&
      byAttempt('외부 스크립트(script)').endsWith('· 허용 목록 밖'),
    tv.map((l) => l.reason).join(' / '),
  );

  // 6. 변조 플러그인이 받은 조각을 밖으로 보내려 해도 막히고, 같은 시도는 다시 기록하지 않는다.
  const exfil = await deliver(store, host, 'tamper', blob, sha);
  await sleep(500);
  record(
    '변조: 받은 조각 외부 전송 시도 → 막힘, 기록 4줄 그대로',
    exfil.status === 'match' && violations('tamper').length === 4 && st().plugins.tamper?.status === 'ready',
    `ack ${exfil.status} · 기록 ${violations('tamper').length}줄`,
  );

  record(
    'apiSends = source api 결과 수',
    st().counter.apiSends === (okResult?.source === 'api' ? 1 : 0),
    `apiSends ${st().counter.apiSends}`,
  );
  finish('플러그인');
}

run().catch((err: unknown) => finish('플러그인', err));
