// 코디 스캔 말로 묻기 시험 페이지(docs/designs/outfit-pipelines.md 파이프라인 2, 02-SSRD IF-09·10·11). 개발 서버의 /dev/outfit.html.
// 서버 키가 없으면 /api/outfit이 대체 문구(source fallback)를 준다. ?expect=api면 가짜 Gemini(GEMINI_BASE_URL)가 붙어 있다고 보고 api를 기대한다.

import type { FrameletSdk } from '../src/core/sdk';
import { PLUGIN_SEEDS, type PluginSeed } from '../src/core/plugins';
import { createLensStore } from '../src/core/store';
import { createPluginHost, sha256Hex } from '../src/plugins/host';
import { OUTFIT_FALLBACK_TEXT } from '../src/plugins/outfit';
import { pluginSourceFor } from '../src/plugins/registry';
import { pluginCall } from '../src/plugins/sdk/source';
import { FIXTURE, createReport, deliver, el, waitFor } from './lib';

const { record, finish } = createReport('__outfit');
const EXPECT = new URLSearchParams(location.search).get('expect') ?? 'fallback';

const seed = PLUGIN_SEEDS.find((s) => s.id === 'outfit')!;
const seeds: PluginSeed[] = [
  { ...seed, enabledByDefault: true },
  // 질문을 받고도 답하지 않는 플러그인: 호스트가 시간 초과로 failTurn 하는지 본다.
  { ...seed, id: 'outfit-silent', enabledByDefault: true },
];

function silentPlugin(framelet: FrameletSdk): void {
  framelet.onQuestion(() => undefined);
}

function cspOf(pluginId: string): string {
  const f = el('frames').querySelector<HTMLIFrameElement>(`iframe[data-plugin-id="${pluginId}"]`);
  if (!f) return '';
  const doc = new DOMParser().parseFromString(f.srcdoc, 'text/html');
  return doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '';
}

async function run() {
  const blob = await fetch(FIXTURE).then((r) => r.blob());
  const sha = await sha256Hex(blob);
  const store = createLensStore({ seeds });
  const host = createPluginHost({
    store,
    container: el('frames'),
    answerTimeoutMs: 1_500,
    sourceFor: (p) => (p.id === 'outfit-silent' ? pluginCall(silentPlugin) : pluginSourceFor(p.kind)),
  });
  const st = () => store.getState();
  const turn = (id: string) => st().outfitTurns.find((t) => t.id === id);
  const settle = async (id: string, ms = 25_000) => {
    await waitFor(() => turn(id)?.status !== 'asking', ms);
    return turn(id);
  };
  const violations = () => st().logs.filter((l) => l.kind === 'violation');
  const person = { scene: 'person' as const, objectLabel: 'person' };

  const ready = await waitFor(() => ['outfit', 'outfit-silent'].every((id) => st().plugins[id]?.status === 'ready'), 4_000);
  const csp = cspOf('outfit');
  el('csp').textContent = csp;
  record(
    '코디 스캔 iframe ready, connect-src = 호스트 origin, wasm 없음',
    ready && csp.endsWith(`connect-src ${location.origin}`) && !csp.includes('wasm-unsafe-eval'),
    csp.replace(/'nonce-[^']+'/, "'nonce-…'"),
  );

  // 0. 보낸 조각이 없으면 askPlugin은 null(스토어).
  record('보낸 조각이 없으면 묻지 않음', st().askPlugin('outfit', '이 옷 어디 거야?') === null, `outfitTurns ${st().outfitTurns.length}개`);

  // 1. 조각 → 질문 → /api/outfit → 답 → recordAnswer.
  const d = await deliver(store, host, 'outfit', blob, sha, person);
  const t0 = performance.now();
  const id = st().askPlugin('outfit', '이 옷 어디 거야?');
  const done = id ? await settle(id) : undefined;
  const ms = Math.round(performance.now() - t0);
  const expectText = EXPECT === 'api' ? (t: string) => t !== OUTFIT_FALLBACK_TEXT && t.length > 0 : (t: string) => t === OUTFIT_FALLBACK_TEXT;
  record(
    `질문 → 답(${EXPECT}) → recordAnswer, 질문한 조각 = 가장 최근 전달`,
    d.status === 'match' &&
      !!done &&
      done.status === 'answered' &&
      done.source === EXPECT &&
      done.deliveryId === d.id &&
      expectText(done.answer ?? '') &&
      violations().length === 0,
    `${ms}ms · ack ${d.status} · ${done?.status ?? '없음'}(${done?.source ?? '-'}) · "${done?.answer ?? ''}" · 기록 ${violations().length}줄`,
  );

  // 2. 답 거르기: 가짜 Gemini는 \r\n과 방향 문자를 섞어 보낸다(?expect=api일 때만 의미가 있다).
  if (EXPECT === 'api') {
    const a = done?.answer ?? '';
    record(
      '답의 제어·방향 문자는 지우고 줄바꿈은 남김',
      !/[\u0000-\u0009\u000B-\u001F‪-‮⁦-⁩\r]/.test(a) && a.includes('\n'),
      JSON.stringify(a),
    );
  }

  // 3. 답하지 않는 플러그인: 호스트가 answerTimeoutMs(이 페이지 1.5초) 뒤 failTurn.
  await deliver(store, host, 'outfit-silent', blob, sha, person);
  const sid = st().askPlugin('outfit-silent', '무슨 옷이야?');
  const s = sid ? await settle(sid, 4_000) : undefined;
  record(
    '답이 없으면 시간 초과로 failTurn',
    s?.status === 'failed' && /답 시간 초과/.test(s.failReason ?? ''),
    `${s?.status ?? '없음'} · ${s?.failReason ?? ''}`,
  );

  // 4. 플러그인을 끄면(iframe 제거) 기다리던 질문은 바로 failed.
  await deliver(store, host, 'outfit', blob, sha, person);
  const kid = st().askPlugin('outfit', '이 신발은?');
  st().setPluginEnabled('outfit', false);
  const k = kid ? await settle(kid, 3_000) : undefined;
  record(
    '플러그인을 끄면 기다리던 질문은 failed',
    !!k && k.status === 'failed',
    `${k?.status ?? '없음'} · ${k?.failReason ?? ''}`,
  );
  // 꺼진 플러그인에 묻기: 보낼 iframe이 없어 바로 failed.
  const oid = st().askPlugin('outfit', '이 가방은?');
  const o = oid ? await settle(oid, 2_000) : undefined;
  record('꺼진 플러그인에 묻기 → 바로 failed', !oid || o?.status === 'failed', `${o?.status ?? 'askPlugin null'} · ${o?.failReason ?? ''}`);
  finish('코디 스캔');
}

run().catch((err: unknown) => finish('코디 스캔', err));
