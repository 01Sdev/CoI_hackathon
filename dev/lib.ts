// /dev 시험 페이지 공용 도우미: 결과 표, 대기, A(broker) 역할의 prepare·deliver.

import type { LensStore, NewDelivery } from '../src/core/store';
import type { AckStatus, Delivery } from '../src/core/types';
import type { PluginHost } from '../src/plugins/host';

/** docs/specs/08-데모-소재.md §1. */
export const FIXTURE = '/dev/fixtures/m0-test.jpg';
export const FIXTURE_SHA256 = '358dbf25d013fc82e1a6e8fdeca1f735cf1b8aad35a445c63f01aa39033605e8';

export interface Row {
  name: string;
  pass: boolean;
  detail: string;
}
export interface Report {
  done: boolean;
  pass: boolean;
  rows: Row[];
}
declare global {
  interface Window {
    __m0?: Report;
    __plugins?: Report;
    __outfit?: Report;
  }
}

export const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** 표(#rows)와 요약(#summary)에 쓰고 window[key]에 같은 내용을 둔다. */
export function createReport(key: '__m0' | '__plugins' | '__outfit') {
  const report: Report = { done: false, pass: false, rows: [] };
  window[key] = report;
  const record = (name: string, pass: boolean, detail: string) => {
    report.rows.push({ name, pass, detail });
    const tr = document.createElement('tr');
    for (const [text, cls] of [
      [String(report.rows.length), ''],
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
  };
  const finish = (label: string, error?: unknown) => {
    if (error !== undefined) record('실행 오류', false, String(error));
    report.pass = report.rows.every((r) => r.pass);
    report.done = true;
    const failed = report.rows.filter((r) => !r.pass).length;
    el('summary').textContent = report.pass ? `${label} 통과 (${report.rows.length}/${report.rows.length})` : `실패 ${failed}건`;
  };
  return { record, finish };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    if (cond()) return true;
    await sleep(5);
  }
  return cond();
}

export function prepare(store: LensStore, pluginId: string, blob: Blob, sha256: string, over: Partial<NewDelivery> = {}) {
  const s = store.getState();
  const p = s.plugins[pluginId];
  if (!p) return null;
  // 고정 JPEG 전체를 포착 프레임으로 본다(F24). raw는 frameRect = cropRect여야 스토어가 받는다.
  const frame = { x: 0, y: 0, w: 256, h: 192 };
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
      cropRect: frame,
      frameRect: frame,
      facesMasked: 0,
      faceCheck: { status: 'checked', detectedFaces: 0 },
      location: 'browser',
      sha256,
      thumbnailRef: null,
      blob,
      ...over,
    },
    { sceneDecisionId: null, reason: 'dev' },
  );
}

/** prepare → sendDelivery → ack까지. 시각은 스토어 구독으로 잰다(배경 탭에서는 setTimeout 폴링이 1초 단위로 늦어진다). */
export async function deliver(
  store: LensStore,
  host: PluginHost,
  pluginId: string,
  blob: Blob,
  sha256: string,
  over: Partial<NewDelivery> = {},
) {
  const prepared = prepare(store, pluginId, blob, sha256, over);
  if (!prepared) return { sent: false, status: 'pending' as AckStatus, ms: 0, delivery: null as Delivery | null, id: '' };
  const id = prepared.delivery.id;
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
  return { sent, status: delivery?.ackStatus ?? 'pending', ms, delivery, id };
}
