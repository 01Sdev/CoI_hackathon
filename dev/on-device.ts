// 칼로리 기기 안 모델 시험 페이지(F7, docs/designs/plugin-host.md §2.10). 개발 서버의 /dev/on-device.html.
// 격리된 칼로리 iframe Worker 안에서 모델을 받고 돌려 source 'on-device' 결과를 받는지, 시간은 얼마인지 잰다.
// 단계별 시간(받기·준비·실행)은 같은 하위 Worker 코드를 이 페이지에서 한 번 더 띄워 잰다.

import { PLUGIN_SEEDS, type PluginSeed } from '../src/core/plugins';
import { createLensStore } from '../src/core/store';
import { buildModelWorkerSource, calorieOnDevice, ORT_PATH } from '../src/plugins/calorie-model';
import { createPluginHost, sha256Hex } from '../src/plugins/host';
import { PORTION_TABLE, portionKcal } from '../src/plugins/portion';
import { calorieSource, pluginSourceFor } from '../src/plugins/registry';
import { FIXTURE, createReport, deliver, el, sleep, waitFor } from './lib';

const { record, finish } = createReport('__onDevice');

const params = new URLSearchParams(location.search);
const MODEL = params.get('model') ?? '/dev/fixtures/calorie-lens-placeholder/';
/** 같은 origin의 JPEG(기본은 M0 고정 JPEG). */
const IMAGE = params.get('image') ?? FIXTURE;
const RUNS = Number(params.get('runs') ?? 5);
const seed = (id: string) => PLUGIN_SEEDS.find((s) => s.id === id)!;
const seeds: PluginSeed[] = [
  { ...seed('calorie') },
  // 모델 파일이 없는 경우: API(개발 서버에 키가 없으면 고정표)로 간다.
  { ...seed('calorie'), id: 'calorie-nomodel' },
];
const ON_DEVICE_LINE = /^피자 약 \d+kcal$/;

function cspOf(pluginId: string): string {
  const f = el('frames').querySelector<HTMLIFrameElement>(`iframe[data-plugin-id="${pluginId}"]`);
  if (!f) return '';
  const doc = new DOMParser().parseFromString(f.srcdoc, 'text/html');
  return doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '';
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? -1;

/** 같은 하위 Worker 코드를 이 페이지(격리 밖)에서 돌려 단계별 시간을 잰다. */
async function breakdown(blob: Blob) {
  const w = new Worker(URL.createObjectURL(new Blob([buildModelWorkerSource()], { type: 'text/javascript' })));
  const next = (type: string, ms: number) =>
    new Promise<Record<string, unknown> | null>((resolve) => {
      const t = setTimeout(() => resolve(null), ms);
      const on = (e: MessageEvent) => {
        const m = e.data as Record<string, unknown>;
        if (m.type === type || m.type === 'failed') {
          clearTimeout(t);
          w.removeEventListener('message', on);
          resolve(m);
        }
      };
      w.addEventListener('message', on);
    });
  const t0 = performance.now();
  w.postMessage({ type: 'load', ortBase: `${location.origin}${ORT_PATH}`, modelBase: `${location.origin}${MODEL}` });
  const loaded = await next('loaded', 120_000);
  const totalLoadMs = Math.round(performance.now() - t0);
  const runs: number[] = [];
  let kcal: unknown = null;
  let mass: unknown = null;
  if (loaded?.type === 'loaded') {
    for (let i = 0; i < RUNS; i++) {
      w.postMessage({ type: 'run', id: i, blob });
      const out = await next('out', 30_000);
      kcal = out?.kcal ?? null;
      mass = out?.mass ?? null;
      runs.push(typeof out?.ms === 'number' ? out.ms : -1);
    }
  }
  w.terminate();
  return { loaded, totalLoadMs, runs, kcal, mass };
}

async function run() {
  const blob = await fetch(IMAGE).then((r) => r.blob());
  const sha = await sha256Hex(blob);
  const store = createLensStore({ seeds });
  const host = createPluginHost({
    store,
    container: el('frames'),
    sourceFor: (p) =>
      p.id === 'calorie'
        ? calorieSource(calorieOnDevice(MODEL))
        : p.id === 'calorie-nomodel'
          ? calorieSource(calorieOnDevice('/dev/fixtures/no-such-model/'))
          : pluginSourceFor(p.kind),
  });
  const st = () => store.getState();
  const violations = () => st().logs.filter((l) => l.kind === 'violation');
  const resultFor = async (pluginId: string, deliveryId: string, ms = 15_000) => {
    await waitFor(() => st().results[pluginId]?.deliveryId === deliveryId, ms);
    const r = st().results[pluginId];
    return r?.deliveryId === deliveryId ? r : null;
  };

  const tReady0 = performance.now();
  const ready = await waitFor(() => ['calorie', 'calorie-nomodel'].every((id) => st().plugins[id]?.status === 'ready'), 4_000);
  const readyAt = performance.now();
  const csp = cspOf('calorie');
  el('csp').textContent = csp;
  record(
    "칼로리 iframe ready, script-src에 'wasm-unsafe-eval'과 호스트 origin의 /ort/",
    ready && csp.includes(`script-src 'nonce-`) && csp.includes(` 'wasm-unsafe-eval' ${location.origin}${ORT_PATH};`) && csp.endsWith(`connect-src ${location.origin}`),
    `${Math.round(readyAt - tReady0)}ms · ${csp.replace(/'nonce-[^']+'/, "'nonce-…'")}`,
  );

  // 1. 모델 준비 전 전달은 API로 간다. 준비되면 source on-device. 첫 on-device까지 반복한다(최대 120초).
  let first: { text: string; ms: number; ack: string; tries: number; sinceReady: number } | null = null;
  const early: string[] = [];
  const deadline = performance.now() + 120_000;
  for (let tries = 1; first === null && performance.now() < deadline; tries++) {
    const t0 = performance.now();
    const d = await deliver(store, host, 'calorie', blob, sha);
    const r = await resultFor('calorie', d.id);
    if (r?.source === 'on-device') {
      first = { text: r.text, ms: Math.round(performance.now() - t0), ack: d.status, tries, sinceReady: Math.round(performance.now() - readyAt) };
    } else {
      early.push(r?.source ?? '없음');
      await sleep(500);
    }
  }
  record(
    '기기 안 결과: source on-device, "피자 약 N kcal", ack match, 기록 0줄',
    first !== null && ON_DEVICE_LINE.test(first.text) && first.ack === 'match' && violations().length === 0,
    first
      ? `ready 뒤 ${first.sinceReady}ms에 첫 on-device("${first.text}", 전달→결과 ${first.ms}ms) · 그전 ${early.length}건(${[...new Set(early)].join('·') || '-'}) · 기록 ${violations().length}줄`
      : `120초 안에 on-device 없음 · ${[...new Set(early)].join('·')}`,
  );

  // 2. 전달 → 결과 시간(호스트 기준, 확인·디코드·전처리·추론 포함).
  const e2e: number[] = [];
  const texts = new Set<string>();
  let allOnDevice = true;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    const d = await deliver(store, host, 'calorie', blob, sha);
    const r = await resultFor('calorie', d.id);
    e2e.push(Math.round(performance.now() - t0));
    if (r?.source !== 'on-device') allOnDevice = false;
    texts.add(r?.text ?? '없음');
  }
  record(
    `전달 → 결과 ${RUNS}회(격리 iframe 안): 모두 on-device, 같은 값`,
    allOnDevice && texts.size === 1,
    `중앙값 ${median(e2e)}ms · 최대 ${Math.max(...e2e)}ms · [${e2e.join(', ')}] · ${[...texts].join(' / ')}`,
  );

  // 3. 모델 파일이 없으면 기록 없이 API 경로(키 없는 개발 서버는 502 → 고정표).
  const nm = await deliver(store, host, 'calorie-nomodel', blob, sha);
  const nmResult = await resultFor('calorie-nomodel', nm.id);
  await sleep(300);
  record(
    '모델 없음(404) → API 경로, 기록 없음',
    !!nmResult && nmResult.source !== 'on-device' && violations().length === 0,
    `"${nmResult?.text ?? '없음'}"(${nmResult?.source ?? '-'}) · 기록 ${violations().length}줄`,
  );

  // 4. 비교 모드: connect-src 'none' iframe에는 'wasm-unsafe-eval'도 없고, 모델을 받지 않으며 고정표.
  st().setCompareMode(true);
  const compareReady = await waitFor(
    () => st().plugins.calorie?.status === 'ready' && st().plugins.calorie?.runtimePolicy?.connect === 'none',
    4_000,
  );
  const raw = await deliver(store, host, 'calorie', blob, sha, { branch: 'raw', faceCheck: { status: 'checked', detectedFaces: 1 } });
  const rawResult = await resultFor('calorie', raw.id);
  const compareCsp = cspOf('calorie');
  record(
    "비교 모드: 'wasm-unsafe-eval' 없음, raw → 고정표",
    compareReady && !compareCsp.includes('wasm-unsafe-eval') && rawResult?.source === 'fallback' && violations().length === 0,
    `${compareCsp.replace(/'nonce-[^']+'/, "'nonce-…'")} · "${rawResult?.text ?? '없음'}"(${rawResult?.source ?? '-'})`,
  );
  st().setCompareMode(false);

  // 5. 단계별 시간(격리 밖에서 같은 코드).
  const b = await breakdown(blob);
  record(
    '단계별 시간(같은 하위 Worker 코드, 격리 밖)',
    b.loaded?.type === 'loaded' && b.runs.every((x) => x >= 0),
    b.loaded?.type === 'loaded'
      ? `실행기 ${String(b.loaded.ep)} · 모델 ${String(b.loaded.bytes)}B · 받기+세션 ${String(b.loaded.loadMs)}ms · 준비 실행 ${String(b.loaded.firstMs)}ms(재기 ${String(b.loaded.warmMs)}ms) · 전체 ${b.totalLoadMs}ms · 실행 ${RUNS}회(디코드 포함) 중앙값 ${median(b.runs)}ms [${b.runs.join(', ')}] · 모델 kcal ${String(b.kcal)} · mass ${String(b.mass)}g → 피자 표 ${String(portionKcal(PORTION_TABLE.pizza, typeof b.kcal === 'number' ? b.kcal : null, typeof b.mass === 'number' ? b.mass : null))}kcal · ${navigator.userAgent}`
      : `실패: ${String(b.loaded?.reason ?? '시간 초과')}`,
  );
  finish('기기 안 모델');
}

run().catch((err: unknown) => finish('기기 안 모델', err));
