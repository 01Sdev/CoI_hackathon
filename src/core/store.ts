// 공용 zustand 스토어. 설계: docs/designs/core-store.md, 쓰기 권한: docs/specs/02-SSRD.md §2.
// C의 버튼은 "의도 상태"만 바꾸고, A·B는 lensStore.subscribe로 보고 처리한다. 액션 안에서는 부수 효과를 하지 않는다
// (예외: 밀려나거나 해제되는 썸네일의 URL.revokeObjectURL).
//
// 쓰는 법
// - C(React): useLensStore((s) => s.session.paused). 객체를 돌려주는 selector는 useShallow로 감싼다.
// - A·B(React 밖): lensStore.getState().addLog(...), lensStore.subscribe((s) => s.session.paused, fn, { fireImmediately: true })

import { useStore } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';
import {
  CAPTURE_FRAME_DEFAULT,
  LOG_LIMIT,
  RECENT_WINDOW_MS,
  SKIP_DEDUP_MS,
  THROUGHPUT_WINDOW_MS,
  USAGE_SAMPLES_PER_PLUGIN,
} from './constants';
import { clampFrame, containsBox } from './frame';
import { resolveAllowedOrigins, validateManifest, type ManifestResult } from './manifest';
import { PLUGIN_SEEDS, type PluginSeed } from './plugins';
import { selectCanSend, selectDesiredRuntime, type DesiredRuntime } from './selectors';
import type {
  Box,
  Counter,
  Delivery,
  Detection,
  InputKind,
  InputSource,
  LiveObservation,
  LogEntry,
  Plugin,
  ResultLine,
  SceneDecision,
  Session,
  ThroughputRecord,
  UsageSample,
  ViewMode,
} from './types';

export type NewLogEntry = Omit<LogEntry, 'id' | 'sessionId' | 'at' | 'deliveryId'> & {
  kind: 'hold' | 'skip' | 'violation';
};
export type NewDetection = Omit<Detection, 'id' | 'logEntryId'>;
export type NewDelivery = Omit<Delivery, 'id' | 'sendStatus' | 'ackSha256' | 'ackStatus' | 'processedAt'>;
export type NewSceneDecision = Omit<SceneDecision, 'id' | 'sessionId' | 'confirmedAt'>;
export type RuntimePatch = Partial<Pick<Plugin, 'status' | 'runtimeId' | 'runtimePolicy' | 'gateOpen'>> & {
  /** 게이트를 열 때(gateOpen: true) 그 iframe을 만든 때의 selectDesiredRuntime 값. 지금 값과 다르면 스토어가 게이트를 닫아 둔다. */
  desired?: DesiredRuntime;
};

export interface LensState {
  session: Session;
  plugins: Record<string, Plugin>;
  /** PLUGIN_SEEDS 순서. 화면 표시용. */
  pluginOrder: string[];
  sceneDecisions: Record<string, SceneDecision>;
  /** 넣은 순서(오래된 것이 앞). 최대 LOG_LIMIT. */
  logs: LogEntry[];
  deliveries: Record<string, Delivery>;
  /** logEntryId → 그 줄의 Detection. */
  detections: Record<string, Detection[]>;
  counter: Counter;
  liveObservation: LiveObservation | null;
  /** pluginId → 최신 결과 줄. */
  results: Record<string, ResultLine>;
  /** `${pluginId}|${reason}` → 마지막으로 받은 skip 시각. 버려진 skip은 시각을 바꾸지 않는다. */
  lastSkipAt: Record<string, number>;
  /** F25 pluginId → 대표 조각(오래된 것이 앞, 최대 USAGE_SAMPLES_PER_PLUGIN). raw는 넣지 않는다. */
  usageSamples: Record<string, UsageSample[]>;

  // ── C(UI) ──
  /** 부를 때마다 inputRequest.seq가 오른다. 같은 입력을 다시 눌러도 A가 처리한다. */
  selectInput(kind: InputKind): void;
  /** 통과하면 version+1(같은 JSON이어도)·게이트 닫기. 실패하면 아무것도 바꾸지 않는다. */
  applyManifest(pluginId: string, json: string): ManifestResult;
  /** 끌 때 게이트도 닫는다. */
  setPluginEnabled(pluginId: string, on: boolean): void;
  /** 칼로리 플러그인 게이트를 닫는다. 끌 때 raw Delivery의 썸네일·Blob을 즉시 해제한다. Counter 기록은 남긴다. */
  setCompareMode(on: boolean): void;
  setPaused(on: boolean): void;
  setViewMode(mode: ViewMode): void;
  /** F24 프레임(0~1). clampFrame으로 0~1 밖을 잘라 낸다. 잘라 낸 뒤 한 변이 최소값보다 작거나 숫자가 아니면 무시한다. 끌기는 frame.ts dragCorner. */
  setCaptureFrame(frame: Box): void;
  /** 새 session.id. 로그·전달·판정·결과·Counter를 비우고 compareMode·paused를 false로, 모든 게이트를 닫는다. 플러그인 행·매니페스트·enabled는 유지. */
  startNewSession(): void;
  /** C가 1초마다 부른다. 10초·60초 창에서 지난 기록을 뺀다. */
  tick(): void;

  // ── A(런타임) ──
  setInput(input: InputSource | null): void;
  /** cooldownUntil을 생략하면 기존 값 유지. */
  setPluginBusy(pluginId: string, busy: boolean, cooldownUntil?: number): void;
  setLiveObservation(obs: LiveObservation | null): void;
  addSceneDecision(d: NewSceneDecision): SceneDecision;
  /** hold·skip·violation만. skip이 같은 플러그인·같은 사유로 10초 안에 또 오면 버리고 null. hold는 window60s.holds +1. */
  addLog(entry: NewLogEntry, detections?: readonly NewDetection[]): LogEntry | null;
  /**
   * Delivery(prepared, pending)와 LogEntry(deliver)를 함께 쓰고 둘 다 돌려준다.
   * 포착 중에 전환이 끼어들었으면 null(쓰지 않음, 호출자는 그 포착을 버린다):
   * 보낼 수 없는 상태(selectCanSend), runtimeId·manifestVersion이 지금 iframe과 다름,
   * raw인데 비교 모드가 아니거나 칼로리가 아니거나 지금 iframe이 connect 'none'이 아님(G1 마지막 방어),
   * frameRect가 있는데 cropRect가 그 안에 없음, raw인데 frameRect가 없거나 cropRect와 다름(F24, 비교 모드도 프레임 안만).
   */
  prepareDelivery(
    delivery: NewDelivery,
    log: { sceneDecisionId: string | null; reason?: string },
    detections?: readonly NewDetection[],
  ): { delivery: Delivery; log: LogEntry } | null;
  /** 증가분을 받는다. faceDetectRuns는 여기로만 센다(가림 1 + 재검사 1). */
  recordRuns(runs: { stage0Runs?: number; faceDetectRuns?: number; sourceFrames?: number }): void;

  // ── B(격리·플러그인) ──
  /**
   * status가 ready가 아니면 gateOpen = false로 강제. stopped·terminated면 enabled = false(사용자가 다시 켜야 함).
   * gateOpen: true와 함께 desired를 주면, 지금 selectDesiredRuntime과 다를 때 게이트를 열지 않는다(낡은 정책 방지).
   */
  setPluginRuntime(pluginId: string, patch: RuntimePatch): void;
  /**
   * prepared에서만 바뀌고 true. dispatched일 때만 Counter(사용 기록 포함)에 쌓고, raw가 아니면 대표 조각에 넣는다.
   * 바뀐 뒤 스토어의 Blob 참조를 놓는다.
   */
  markDelivery(deliveryId: string, status: 'dispatched' | 'failed'): boolean;
  /** dispatched·pending일 때만 받고 true. sha256 = null이면 timeout(타이머는 B). 불일치면 violation 로그. */
  setAck(deliveryId: string, sha256: string | null): boolean;
  /**
   * 결과 줄. 이 플러그인에 실제로 보낸(dispatched) 전달의 첫 결과일 때만 받고 true.
   * 없는 전달·보내지 않은 전달·다른 플러그인·두 번째 결과·새 세션 전의 결과는 버리고 false.
   * 받은 결과의 source가 api면 counter.apiSends +1(플러그인 자기 보고 기준).
   */
  setResult(pluginId: string, line: ResultLine): boolean;
}

export interface LensStoreOptions {
  /** 기본 performance.now(). assertion 스크립트가 시간을 직접 넘긴다. */
  clock?: () => number;
  /** 기본 URL.revokeObjectURL. */
  revokeUrl?: (url: string) => void;
  /** 기본 PLUGIN_SEEDS. */
  seeds?: readonly PluginSeed[];
  /** $ORIGIN 치환에 쓸 호스트 origin. 기본 location.origin. */
  hostOrigin?: string;
}

let seq = 0;
/** crypto.randomUUID는 HTTP(로컬 LAN 개발)에서 없으므로 쓰지 않는다. */
export function newId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

function emptyCounter(sessionId: string): Counter {
  return { sessionId, usage: [], recent10s: [], window60s: [], perPlugin: {}, rawServerSends: 0, apiSends: 0 };
}

function throughput(at: number, patch: Partial<Omit<ThroughputRecord, 'at'>>): ThroughputRecord {
  return { at, stage0Runs: 0, faceDetectRuns: 0, sourceFrames: 0, deliveries: 0, holds: 0, ...patch };
}

export function createLensStore(opts: LensStoreOptions = {}) {
  const clock = opts.clock ?? (() => performance.now());
  const revokeUrl =
    opts.revokeUrl ??
    ((url: string) => {
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
    });
  /** 결과 줄을 이미 받은 deliveryId. 새 세션에서 비운다. */
  const answered = new Set<string>();
  const sameDesired = (a: DesiredRuntime, b: DesiredRuntime) =>
    a.enabled === b.enabled && a.manifestVersion === b.manifestVersion && a.connect === b.connect && a.sessionId === b.sessionId;
  const revoke = (url: string | null) => {
    if (url) revokeUrl(url);
  };
  const hostOrigin = opts.hostOrigin ?? globalThis.location?.origin ?? '';

  /** 전환을 일으키는 액션이 같은 set 안에서 게이트를 닫는다. B의 구독 시점에 기대지 않기 위해서다. */
  const closeGates = (plugins: Record<string, Plugin>, match: (p: Plugin) => boolean): Record<string, Plugin> => {
    const next = { ...plugins };
    for (const [id, p] of Object.entries(next)) if (match(p) && p.gateOpen) next[id] = { ...p, gateOpen: false };
    return next;
  };

  const seedPlugins = (sessionId: string) => {
    const plugins: Record<string, Plugin> = {};
    for (const seed of opts.seeds ?? PLUGIN_SEEDS) {
      const r = validateManifest(seed.manifestJson, seed.id);
      if (!r.ok) throw new Error(`플러그인 ${seed.id} 시작 매니페스트 오류: ${r.errors.join(', ')}`);
      plugins[seed.id] = {
        id: seed.id,
        sessionId,
        kind: seed.kind,
        runtimeId: null,
        runtimePolicy: null,
        status: 'terminated',
        gateOpen: false,
        enabled: seed.enabledByDefault,
        cooldownUntil: 0,
        busy: false,
        manifest: { ...r.manifest, version: 1 },
        allowedOrigins: resolveAllowedOrigins(r.manifest.network, hostOrigin),
      };
    }
    return plugins;
  };

  const freshSession = (prev?: Session): Session => ({
    id: newId('session'),
    startedAt: clock(),
    viewMode: prev?.viewMode ?? 'phone',
    input: prev?.input ?? null,
    inputRequest: prev?.inputRequest ?? null,
    compareMode: false,
    paused: false,
    captureFrame: prev?.captureFrame ?? { ...CAPTURE_FRAME_DEFAULT },
  });

  /** 대표 조각이 쓰고 있는 썸네일 URL. 로그 밀어내기는 이 URL을 해제하지 않는다. */
  const sampleUrls = (samples: Record<string, UsageSample[]>) =>
    new Set(Object.values(samples).flatMap((list) => list.map((x) => x.thumbnailRef)));

  /**
   * logs에 한 줄 붙이고 LOG_LIMIT를 넘은 오래된 줄을 밀어낸다. 밀려난 줄의 Delivery·Detection·고아 SceneDecision을 지운다.
   * 밀려난 Delivery의 썸네일이 대표 조각(F25)에 남아 있으면 해제하지 않는다.
   */
  const appendLog = (
    s: Pick<LensState, 'logs' | 'detections' | 'deliveries' | 'sceneDecisions' | 'usageSamples'>,
    entry: LogEntry,
    dets: readonly NewDetection[] | undefined,
  ): Pick<LensState, 'logs' | 'detections' | 'deliveries' | 'sceneDecisions'> => {
    const logs = [...s.logs, entry];
    const detections = { ...s.detections };
    if (dets && dets.length > 0) {
      detections[entry.id] = dets.map((d) => ({ ...d, id: newId('det'), logEntryId: entry.id }));
    }
    let { deliveries, sceneDecisions } = s;
    if (logs.length > LOG_LIMIT) {
      const evicted = logs.splice(0, logs.length - LOG_LIMIT);
      deliveries = { ...deliveries };
      sceneDecisions = { ...sceneDecisions };
      const stillUsed = new Set(logs.map((l) => l.sceneDecisionId));
      const sampled = sampleUrls(s.usageSamples);
      for (const old of evicted) {
        delete detections[old.id];
        if (old.deliveryId) {
          const thumb = deliveries[old.deliveryId]?.thumbnailRef ?? null;
          if (thumb && !sampled.has(thumb)) revoke(thumb);
          delete deliveries[old.deliveryId];
        }
        if (old.sceneDecisionId && !stillUsed.has(old.sceneDecisionId)) delete sceneDecisions[old.sceneDecisionId];
      }
    }
    return { logs, detections, deliveries, sceneDecisions };
  };

  return createStore<LensState>()(
    subscribeWithSelector((set, get) => {
      const initial = freshSession();

      const addLog: LensState['addLog'] = (entry, dets) => {
        const s = get();
        const at = clock();
        const skipKey = `${entry.pluginId}|${entry.reason}`;
        if (entry.kind === 'skip') {
          const last = s.lastSkipAt[skipKey];
          if (last !== undefined && at - last < SKIP_DEDUP_MS) return null;
        }
        const log: LogEntry = { ...entry, id: newId('log'), sessionId: s.session.id, deliveryId: null, at };
        set((cur) => {
          const next: Partial<LensState> = appendLog(cur, log, dets);
          if (entry.kind === 'skip') next.lastSkipAt = { ...cur.lastSkipAt, [skipKey]: at };
          if (entry.kind === 'hold') {
            next.counter = { ...cur.counter, window60s: [...cur.counter.window60s, throughput(at, { holds: 1 })] };
          }
          return next;
        });
        return log;
      };

      const plugins = seedPlugins(initial.id);

      return {
        session: initial,
        plugins,
        pluginOrder: Object.keys(plugins),
        sceneDecisions: {},
        logs: [],
        deliveries: {},
        detections: {},
        counter: emptyCounter(initial.id),
        liveObservation: null,
        results: {},
        lastSkipAt: {},
        usageSamples: {},

        // ── C ──
        selectInput: (kind) =>
          set((s) => ({
            session: { ...s.session, inputRequest: { kind, seq: (s.session.inputRequest?.seq ?? 0) + 1 } },
          })),

        applyManifest: (pluginId, json) => {
          if (!get().plugins[pluginId]) return { ok: false, errors: [`없는 플러그인: ${pluginId}`] };
          const r = validateManifest(json, pluginId);
          if (!r.ok) return r;
          set((s) => {
            const cur = s.plugins[pluginId];
            if (!cur) return {};
            return {
              plugins: {
                ...s.plugins,
                [pluginId]: {
                  ...cur,
                  gateOpen: false,
                  manifest: { ...r.manifest, version: cur.manifest.version + 1 },
                  allowedOrigins: resolveAllowedOrigins(r.manifest.network, hostOrigin),
                },
              },
            };
          });
          return r;
        },

        setPluginEnabled: (pluginId, on) =>
          set((s) => {
            const p = s.plugins[pluginId];
            if (!p || p.enabled === on) return {};
            return { plugins: { ...s.plugins, [pluginId]: { ...p, enabled: on, gateOpen: on ? p.gateOpen : false } } };
          }),

        setCompareMode: (on) =>
          set((s) => {
            if (s.session.compareMode === on) return {};
            const plugins = closeGates(s.plugins, (p) => p.kind === 'calorie');
            if (on) return { session: { ...s.session, compareMode: true }, plugins };
            const deliveries = { ...s.deliveries };
            for (const d of Object.values(deliveries)) {
              if (d.branch === 'raw' && (d.thumbnailRef !== null || d.blob !== null)) {
                revoke(d.thumbnailRef);
                deliveries[d.id] = { ...d, thumbnailRef: null, blob: null };
              }
            }
            return { session: { ...s.session, compareMode: false }, plugins, deliveries };
          }),

        setPaused: (on) => set((s) => (s.session.paused === on ? {} : { session: { ...s.session, paused: on } })),

        setViewMode: (mode) =>
          set((s) => (s.session.viewMode === mode ? {} : { session: { ...s.session, viewMode: mode } })),

        setCaptureFrame: (frame) => {
          const captureFrame = clampFrame(frame);
          if (captureFrame) set((s) => ({ session: { ...s.session, captureFrame } }));
        },

        startNewSession: () =>
          set((s) => {
            answered.clear();
            // 대표 조각은 Delivery 썸네일을 같이 쓰므로 한 URL을 두 번 해제하지 않는다.
            const thumbs = sampleUrls(s.usageSamples);
            for (const d of Object.values(s.deliveries)) if (d.thumbnailRef) thumbs.add(d.thumbnailRef);
            for (const url of thumbs) revoke(url);
            const session = freshSession(s.session);
            const plugins: Record<string, Plugin> = {};
            for (const [id, p] of Object.entries(s.plugins)) {
              plugins[id] = { ...p, sessionId: session.id, busy: false, cooldownUntil: 0, gateOpen: false };
            }
            return {
              session,
              plugins,
              sceneDecisions: {},
              logs: [],
              deliveries: {},
              detections: {},
              counter: emptyCounter(session.id),
              liveObservation: null,
              results: {},
              lastSkipAt: {},
              usageSamples: {},
            };
          }),

        tick: () =>
          set((s) => {
            const now = clock();
            const recent10s = s.counter.recent10s.filter((r) => now - r.at < RECENT_WINDOW_MS);
            const window60s = s.counter.window60s.filter((r) => now - r.at < THROUGHPUT_WINDOW_MS);
            if (recent10s.length === s.counter.recent10s.length && window60s.length === s.counter.window60s.length) {
              return {};
            }
            return { counter: { ...s.counter, recent10s, window60s } };
          }),

        // ── A ──
        setInput: (input) => set((s) => ({ session: { ...s.session, input } })),

        setPluginBusy: (pluginId, busy, cooldownUntil) =>
          set((s) => {
            const p = s.plugins[pluginId];
            if (!p) return {};
            return {
              plugins: { ...s.plugins, [pluginId]: { ...p, busy, cooldownUntil: cooldownUntil ?? p.cooldownUntil } },
            };
          }),

        setLiveObservation: (obs) => set({ liveObservation: obs }),

        addSceneDecision: (d) => {
          const decision: SceneDecision = { ...d, id: newId('scene'), sessionId: get().session.id, confirmedAt: clock() };
          set((s) => ({ sceneDecisions: { ...s.sceneDecisions, [decision.id]: decision } }));
          return decision;
        },

        addLog,

        prepareDelivery: (d, logInfo, dets) => {
          const s = get();
          const p = s.plugins[d.pluginId];
          if (!p || !selectCanSend(s, d.pluginId)) return null;
          if (p.runtimeId === null || d.runtimeId !== p.runtimeId) return null;
          if (!p.runtimePolicy || d.manifestVersion !== p.runtimePolicy.manifestVersion) return null;
          // F24: 프레임 밖 픽셀은 어떤 플러그인에도 보내지 않는다. 자른 조각이 프레임을 벗어나면 받지 않는다.
          if (d.frameRect && !containsBox(d.frameRect, d.cropRect)) return null;
          if (d.branch === 'raw') {
            // 가리지 않은 원본은 비교 모드의 칼로리, 통신이 막힌 iframe에만 간다(G1의 유일한 예외).
            if (!s.session.compareMode || p.kind !== 'calorie' || p.runtimePolicy.connect !== 'none') return null;
            // 비교 모드도 프레임 안만 보낸다(사용자 결정 2026-10-31). raw 조각은 프레임 전체와 같아야 한다.
            const f = d.frameRect;
            const c = d.cropRect;
            if (!f || f.x !== c.x || f.y !== c.y || f.w !== c.w || f.h !== c.h) return null;
          }
          const at = clock();
          const delivery: Delivery = {
            ...d,
            id: newId('dlv'),
            processedAt: at,
            sendStatus: 'prepared',
            ackSha256: null,
            ackStatus: 'pending',
          };
          const log: LogEntry = {
            id: newId('log'),
            sessionId: s.session.id,
            pluginId: d.pluginId,
            sceneDecisionId: logInfo.sceneDecisionId,
            deliveryId: delivery.id,
            kind: 'deliver',
            branch: d.branch,
            reason: logInfo.reason ?? '',
            enforcedBy: null,
            at,
            ...(d.frameRect ? { frameRect: d.frameRect } : {}),
          };
          set((cur) => appendLog({ ...cur, deliveries: { ...cur.deliveries, [delivery.id]: delivery } }, log, dets));
          return { delivery, log };
        },

        recordRuns: (runs) =>
          set((s) => ({
            counter: { ...s.counter, window60s: [...s.counter.window60s, throughput(clock(), runs)] },
          })),

        // ── B ──
        setPluginRuntime: (pluginId, patch) =>
          set((s) => {
            const p = s.plugins[pluginId];
            if (!p) return {};
            const { desired, ...fields } = patch;
            const next: Plugin = { ...p, ...fields };
            if (next.status !== 'ready') next.gateOpen = false;
            if (fields.gateOpen && desired) {
              const now = selectDesiredRuntime(s, pluginId);
              if (!now || !sameDesired(now, desired)) next.gateOpen = false;
            }
            if (patch.status === 'stopped' || patch.status === 'terminated') next.enabled = false;
            return { plugins: { ...s.plugins, [pluginId]: next } };
          }),

        markDelivery: (deliveryId, status) => {
          const d = get().deliveries[deliveryId];
          if (!d || d.sendStatus !== 'prepared') return false;
          set((s) => {
            // 전송이 끝나면 스토어는 Blob을 들고 있지 않는다(썸네일은 thumbnailRef로 따로 있다).
            const deliveries = { ...s.deliveries, [deliveryId]: { ...d, sendStatus: status, blob: null } };
            if (status === 'failed') return { deliveries };
            const at = clock();
            // faceCheck가 error인 Delivery는 보호 모드에서 만들지 않는다. 그래도 들어오면 얼굴 수를 모르므로 덜 세지 않게 1로 센다.
            const faces = d.faceCheck.status === 'checked' ? d.faceCheck.detectedFaces : 1;
            const prev = s.counter.perPlugin[d.pluginId] ?? { deliveries: 0, faceDeliveries: 0 };
            // F25 대표 조각: raw(가리지 않은 원본)는 남기지 않는다. 넘쳐서 빠진 조각은 그 Delivery가 이미 밀려났을 때만 해제한다.
            let usageSamples = s.usageSamples;
            if (d.branch !== 'raw' && d.thumbnailRef) {
              const list = [
                ...(s.usageSamples[d.pluginId] ?? []),
                { pluginId: d.pluginId, deliveryId: d.id, at, thumbnailRef: d.thumbnailRef },
              ];
              for (const dropped of list.splice(0, Math.max(0, list.length - USAGE_SAMPLES_PER_PLUGIN))) {
                if (!s.deliveries[dropped.deliveryId]) revoke(dropped.thumbnailRef);
              }
              usageSamples = { ...s.usageSamples, [d.pluginId]: list };
            }
            return {
              deliveries,
              usageSamples,
              counter: {
                ...s.counter,
                usage: [
                  ...s.counter.usage,
                  {
                    at,
                    pluginId: d.pluginId,
                    deliveryId: d.id,
                    objectLabel: d.objectLabel,
                    bytes: d.bytes,
                    frameW: d.frameRect?.w ?? null,
                    frameH: d.frameRect?.h ?? null,
                  },
                ],
                recent10s: [...s.counter.recent10s, { at, pluginId: d.pluginId, detectedFaces: faces }],
                window60s: [...s.counter.window60s, throughput(at, { deliveries: 1 })],
                perPlugin: {
                  ...s.counter.perPlugin,
                  [d.pluginId]: {
                    deliveries: prev.deliveries + 1,
                    faceDeliveries: prev.faceDeliveries + (faces > 0 ? 1 : 0),
                  },
                },
              },
            };
          });
          return true;
        },

        setAck: (deliveryId, sha256) => {
          const d = get().deliveries[deliveryId];
          if (!d || d.sendStatus !== 'dispatched' || d.ackStatus !== 'pending') return false;
          const ackSha256 = sha256 === null ? null : sha256.toLowerCase();
          const ackStatus = ackSha256 === null ? 'timeout' : ackSha256 === d.sha256.toLowerCase() ? 'match' : 'mismatch';
          set((s) => ({ deliveries: { ...s.deliveries, [deliveryId]: { ...d, ackSha256, ackStatus } } }));
          if (ackStatus === 'mismatch') {
            addLog({
              pluginId: d.pluginId,
              sceneDecisionId: null,
              kind: 'violation',
              branch: null,
              reason: '해시 불일치',
              enforcedBy: 'host',
            });
          }
          return true;
        },

        setResult: (pluginId, line) => {
          const d = get().deliveries[line.deliveryId];
          if (!d || d.pluginId !== pluginId || d.sendStatus !== 'dispatched' || answered.has(line.deliveryId)) return false;
          answered.add(line.deliveryId);
          set((s) => ({
            results: { ...s.results, [pluginId]: line },
            counter: line.source === 'api' ? { ...s.counter, apiSends: s.counter.apiSends + 1 } : s.counter,
          }));
          return true;
        },
      };
    }),
  );
}

export type LensStore = ReturnType<typeof createLensStore>;

/** 앱 전체가 쓰는 스토어 하나. React 밖(A·B)에서는 이것을 직접 쓴다. */
export const lensStore = createLensStore();

/** React(C)용. 원시값을 돌려주는 selector를 쓰고, 객체면 zustand/react/shallow의 useShallow로 감싼다. */
export function useLensStore<T>(selector: (s: LensState) => T): T {
  return useStore(lensStore, selector);
}
