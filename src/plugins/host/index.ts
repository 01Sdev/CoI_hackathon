// 플러그인 호스트: iframe·Worker 생성, 메시지 검증, 전환 조정기, sendDelivery.
// 계약: docs/specs/02-SSRD.md §3·§4, docs/designs/core-store.md §2.2·§2.3. 설계: docs/designs/plugin-host.md.
// iframe으로의 postMessage는 이 파일의 sendInit(첫 load)과 sendDelivery에만 있다(02-SSRD §1 코드 규칙).

import { shallow } from 'zustand/vanilla/shallow';
import { ACK_TIMEOUT_MS, PLUGIN_MESSAGE_LIMITS, READY_TIMEOUT_MS } from '../../core/constants';
import type { HostToPlugin, PluginToHost } from '../../core/messages';
import { selectCanSend, selectDesiredRuntime, type DesiredRuntime } from '../../core/selectors';
import { lensStore, newId, type LensStore } from '../../core/store';
import type { Enforced, Plugin, RuntimePolicy } from '../../core/types';
import { pluginSourceFor } from '../registry';
import { sha256Pure } from '../sdk/sha256';
import { NAME_HELPER_SHIM, buildWorkerSource, type SdkTestOptions } from '../sdk/source';
import { iframeBootstrap } from './bootstrap';
import { buildCsp, buildSrcdoc, makeNonce, safeConnectList } from './csp';
import { parsePluginMessage, violationReason } from './validate';

export interface PluginHostOptions {
  /** 기본 lensStore. */
  store?: LensStore;
  /** iframe을 붙일 곳. 기본은 body 끝의 숨긴 div. */
  container?: HTMLElement;
  /** init.apiBase에 넣을 호스트 origin. 기본 location.origin. */
  hostOrigin?: string;
  /** 플러그인 코드. 기본은 kind별 registry. null이면 켜지 않는다(stopped). */
  sourceFor?: (plugin: Plugin) => string | null;
  /** /dev 시험 전용 SDK 옵션. */
  sdkTestOptionsFor?: (pluginId: string) => SdkTestOptions | undefined;
  readyTimeoutMs?: number;
  ackTimeoutMs?: number;
  /** 메시지 초당 한도용 시계. 기본 performance.now(). */
  now?: () => number;
}

export interface PluginHost {
  /** broker만 부른다. 거부하면 markDelivery(failed) 후 false. */
  sendDelivery(deliveryId: string): boolean;
  /** 구독 해제, iframe 제거. 지금 돌던 플러그인은 loading으로 돌려 둔다(다음 호스트가 다시 만든다). */
  stop(): void;
}

interface Runtime {
  pluginId: string;
  runtimeId: string;
  /** 이 iframe을 만든 selectDesiredRuntime 값. */
  desired: DesiredRuntime;
  policy: RuntimePolicy;
  /** 실제 connect-src 목록. 비교 모드 칼로리·빈 network면 []. */
  connectList: string[];
  iframe: HTMLIFrameElement;
  win: Window | null;
  loads: number;
  ready: boolean;
  readyTimer: ReturnType<typeof setTimeout> | null;
  /** 이 iframe에 보낸 deliveryId. ack·result는 여기 있는 것만 받는다. */
  sent: Set<string>;
  acked: Set<string>;
  resulted: Set<string>;
  reported: Set<string>;
  msgTimes: number[];
  formatErrors: number;
  onLoad: () => void;
}

const SANDBOX = 'allow-scripts';
/** 한 iframe에서 3번째 형식 오류면 종료(docs/designs/plugin-host.md §2.3). */
const FORMAT_ERROR_LIMIT = 3;
/** 한 iframe의 서로 다른 violation 보고 상한. 변조 플러그인은 4건. 넘으면 로그 100건을 밀어내지 않게 종료한다. */
const VIOLATION_REPORT_LIMIT = 8;
const RATE_WINDOW_MS = 1_000;

function sandboxOk(iframe: HTMLIFrameElement): boolean {
  return (
    iframe.getAttribute('sandbox') === SANDBOX &&
    iframe.sandbox.length === 1 &&
    iframe.sandbox.contains(SANDBOX) &&
    !iframe.sandbox.contains('allow-same-origin') &&
    iframe.getAttribute('allow') === ''
  );
}

export function createPluginHost(opts: PluginHostOptions = {}): PluginHost {
  const store = opts.store ?? lensStore;
  const hostOrigin = opts.hostOrigin ?? location.origin;
  const sourceFor = opts.sourceFor ?? ((p: Plugin) => pluginSourceFor(p.kind));
  const readyTimeoutMs = opts.readyTimeoutMs ?? READY_TIMEOUT_MS;
  const ackTimeoutMs = opts.ackTimeoutMs ?? ACK_TIMEOUT_MS;
  const now = opts.now ?? (() => performance.now());
  const ownContainer = !opts.container;
  const container = opts.container ?? document.createElement('div');
  if (ownContainer) {
    container.hidden = true;
    container.dataset.pluginHost = '';
    document.body.appendChild(container);
  }

  const current = new Map<string, Runtime>();
  const byWindow = new Map<Window, Runtime>();
  const ackTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let stopped = false;

  const act = () => store.getState();
  const log = (pluginId: string, reason: string, enforcedBy: Enforced) =>
    act().addLog({ pluginId, sceneDecisionId: null, kind: 'violation', branch: null, reason, enforcedBy });

  /** 로컬에서만 떼어 낸다(여러 번 불러도 된다). iframe 제거 = Worker 종료. */
  const detach = (rt: Runtime) => {
    if (current.get(rt.pluginId) === rt) current.delete(rt.pluginId);
    if (rt.win) byWindow.delete(rt.win);
    if (rt.readyTimer) clearTimeout(rt.readyTimer);
    rt.readyTimer = null;
    rt.iframe.removeEventListener('load', rt.onLoad);
    rt.iframe.remove();
  };

  /**
   * 호스트가 끝내는 경우(재로드·한도·형식 위반 반복). 순서: 떼기 → 기록 → terminated.
   * 마지막 set이 enabled = false를 만들어 reconcile이 한 번 더 불리지만, 떼어 낸 뒤라 할 일이 없다.
   */
  const kill = (rt: Runtime, reason: string) => {
    if (current.get(rt.pluginId) !== rt) return;
    detach(rt);
    log(rt.pluginId, reason, 'host');
    act().setPluginRuntime(rt.pluginId, { status: 'terminated', runtimeId: null, runtimePolicy: null });
  };

  const formatError = (rt: Runtime, reason: string) => {
    rt.formatErrors += 1;
    if (rt.formatErrors >= FORMAT_ERROR_LIMIT) kill(rt, `형식 오류 반복(${FORMAT_ERROR_LIMIT}회): ${reason}`);
    else log(rt.pluginId, `형식 오류: ${reason}`, 'host');
  };

  const sendInit = (rt: Runtime, plugin: Plugin, code: string) => {
    const m = plugin.manifest;
    const msg: HostToPlugin = {
      type: 'init',
      pluginId: plugin.id,
      manifest: {
        purpose: m.purpose,
        scenes: [...m.scenes],
        region: m.region,
        maxSide: m.maxSide,
        quality: m.quality,
        maxPerMinute: m.maxPerMinute,
        network: [...m.network],
      },
      apiBase: rt.policy.connect === 'none' ? null : hostOrigin,
      code,
    };
    rt.win?.postMessage(msg, '*');
  };

  /** 새 iframe. 실패하면 null(붙인 것도 뗀다). 3초 ready 타이머는 DOM에 붙일 때 시작한다. */
  const create = (plugin: Plugin, desired: DesiredRuntime): Runtime | null => {
    const pluginSource = sourceFor(plugin);
    if (pluginSource === null) {
      console.warn(`[plugins] ${plugin.id}: 등록된 코드가 없어 켜지 않습니다`);
      return null;
    }
    const code = buildWorkerSource(pluginSource, opts.sdkTestOptionsFor?.(plugin.id));
    const connectList = desired.connect === 'none' ? [] : safeConnectList(plugin.allowedOrigins);
    const nonce = makeNonce();
    const iframe = document.createElement('iframe');
    const rt: Runtime = {
      pluginId: plugin.id,
      runtimeId: newId('rt'),
      desired,
      policy: { connect: desired.connect, manifestVersion: desired.manifestVersion },
      connectList,
      iframe,
      win: null,
      loads: 0,
      ready: false,
      readyTimer: null,
      sent: new Set(),
      acked: new Set(),
      resulted: new Set(),
      reported: new Set(),
      msgTimes: [],
      formatErrors: 0,
      onLoad: () => {
        rt.loads += 1;
        if (current.get(rt.pluginId) !== rt) return;
        // 재로드 감지는 첫 load 이후만 센다(02-SSRD CSP 문단).
        if (rt.loads > 1) kill(rt, 'iframe 재로드');
        else sendInit(rt, plugin, code);
      },
    };
    iframe.setAttribute('sandbox', SANDBOX);
    iframe.setAttribute('allow', '');
    iframe.dataset.pluginId = plugin.id;
    iframe.dataset.runtimeId = rt.runtimeId;
    try {
      iframe.srcdoc = buildSrcdoc(nonce, buildCsp(nonce, connectList), `${NAME_HELPER_SHIM}(${iframeBootstrap.toString()})();`);
    } catch (err) {
      console.warn(`[plugins] ${plugin.id}: srcdoc 생성 실패`, err);
      return null;
    }
    iframe.addEventListener('load', rt.onLoad);
    if (!sandboxOk(iframe)) return null;
    container.appendChild(iframe);
    rt.win = iframe.contentWindow;
    if (!sandboxOk(iframe) || !rt.win) {
      iframe.removeEventListener('load', rt.onLoad);
      iframe.remove();
      log(plugin.id, 'iframe 속성 확인 실패', 'host');
      return null;
    }
    byWindow.set(rt.win, rt);
    rt.readyTimer = setTimeout(() => {
      rt.readyTimer = null;
      if (current.get(rt.pluginId) !== rt || rt.ready) return;
      // 전환 실패: 옛 권한으로 돌아가지 않는다. 기록은 남기지 않고 상태로만 보인다.
      detach(rt);
      act().setPluginRuntime(rt.pluginId, { status: 'stopped', runtimeId: null, runtimePolicy: null });
    }, readyTimeoutMs);
    return rt;
  };

  /** 전환 공통 절차(02-SSRD §4). 구독 인자 대신 지금 상태의 최신 값을 본다. */
  const reconcileOnce = (pluginId: string) => {
    if (stopped) return;
    const desired = selectDesiredRuntime(act(), pluginId);
    const cur = current.get(pluginId);
    if (cur && desired && shallow(cur.desired, desired)) return;
    // ① 게이트 닫기(전환을 일으킨 액션이 이미 닫았지만 한 번 더).
    if (act().plugins[pluginId]?.gateOpen) act().setPluginRuntime(pluginId, { gateOpen: false });
    // ②는 runtimeId가 바뀌면 prepareDelivery·sendDelivery가 거부하는 것으로 된다. ③ 옛 iframe·Worker 종료.
    if (cur) detach(cur);
    const plugin = act().plugins[pluginId];
    if (!desired || !plugin) return;
    if (!desired.enabled) {
      // stopped는 덮지 않는다(stopped → enabled false → 여기로 다시 온다).
      const status = plugin.status === 'stopped' ? 'stopped' : 'terminated';
      if (plugin.status !== status || plugin.runtimeId !== null || plugin.runtimePolicy !== null) {
        act().setPluginRuntime(pluginId, { status, runtimeId: null, runtimePolicy: null });
      }
      return;
    }
    // ④ 새 정책으로 iframe.
    const rt = create(plugin, desired);
    if (!rt) {
      act().setPluginRuntime(pluginId, { status: 'stopped', runtimeId: null, runtimePolicy: null });
      return;
    }
    current.set(pluginId, rt);
    act().setPluginRuntime(pluginId, {
      status: 'loading',
      runtimeId: rt.runtimeId,
      runtimePolicy: rt.policy,
      gateOpen: false,
    });
  };

  // reconcile 안의 set이 같은 플러그인의 구독을 다시 부르면, 끝난 뒤 최신 값으로 한 번 더 돈다.
  const reconciling = new Set<string>();
  const again = new Set<string>();
  const reconcile = (pluginId: string) => {
    if (reconciling.has(pluginId)) {
      again.add(pluginId);
      return;
    }
    reconciling.add(pluginId);
    try {
      do {
        again.delete(pluginId);
        reconcileOnce(pluginId);
      } while (again.has(pluginId));
    } finally {
      reconciling.delete(pluginId);
    }
  };

  const handle = (rt: Runtime, msg: PluginToHost) => {
    switch (msg.type) {
      case 'ready': {
        // ⑤ 그 iframe을 만든 값이 지금 값과 같을 때만 게이트를 연다. msg.pluginId는 쓰지 않는다.
        if (rt.ready) return;
        rt.ready = true;
        if (rt.readyTimer) clearTimeout(rt.readyTimer);
        rt.readyTimer = null;
        const desired = selectDesiredRuntime(act(), rt.pluginId);
        if (!desired || !shallow(desired, rt.desired)) return;
        // desired도 넘긴다: 스토어가 한 번 더 대조해, 지금 값과 다르면 게이트를 열지 않는다.
        act().setPluginRuntime(rt.pluginId, {
          status: 'ready',
          runtimeId: rt.runtimeId,
          runtimePolicy: rt.policy,
          gateOpen: true,
          desired: rt.desired,
        });
        return;
      }
      case 'ack': {
        if (!rt.sent.has(msg.deliveryId)) return formatError(rt, '이 iframe에 보내지 않은 deliveryId의 ack');
        if (rt.acked.has(msg.deliveryId)) return;
        rt.acked.add(msg.deliveryId);
        const timer = ackTimers.get(msg.deliveryId);
        if (timer) clearTimeout(timer);
        ackTimers.delete(msg.deliveryId);
        act().setAck(msg.deliveryId, msg.sha256);
        return;
      }
      case 'result': {
        if (!rt.sent.has(msg.deliveryId)) return formatError(rt, '이 iframe에 보내지 않은 deliveryId의 result');
        if (rt.resulted.has(msg.deliveryId)) return;
        rt.resulted.add(msg.deliveryId);
        // 스토어가 dispatched 전달의 첫 결과만 받는다. false면 버린 것이다.
        act().setResult(rt.pluginId, { deliveryId: msg.deliveryId, text: msg.text, source: msg.source, at: now() });
        return;
      }
      case 'violation': {
        const key = `${msg.attempt}\n${msg.target}`;
        if (rt.reported.has(key)) return;
        if (rt.reported.size >= VIOLATION_REPORT_LIMIT) return kill(rt, `한도 초과: 위반 보고 ${VIOLATION_REPORT_LIMIT}건`);
        rt.reported.add(key);
        log(rt.pluginId, violationReason(msg.attempt, msg.target, rt.connectList), 'plugin-report');
        return;
      }
    }
  };

  const onMessage = (e: MessageEvent) => {
    const rt = e.source ? byWindow.get(e.source as Window) : undefined;
    // 모르는 창·옛 iframe·origin이 null이 아닌 메시지는 기록 없이 버린다.
    if (!rt || current.get(rt.pluginId) !== rt || e.origin !== 'null') return;
    const t = now();
    rt.msgTimes = rt.msgTimes.filter((x) => t - x < RATE_WINDOW_MS);
    rt.msgTimes.push(t);
    if (rt.msgTimes.length > PLUGIN_MESSAGE_LIMITS.perSecond) {
      return kill(rt, `한도 초과: 초당 메시지 ${PLUGIN_MESSAGE_LIMITS.perSecond}건`);
    }
    if (e.ports.length > 0) return formatError(rt, 'MessagePort 포함');
    const r = parsePluginMessage(e.data);
    if (!r.ok) return r.kind === 'limit' ? kill(rt, `한도 초과: ${r.reason}`) : formatError(rt, r.reason);
    handle(rt, r.msg);
  };

  const sendDelivery = (deliveryId: string): boolean => {
    const s = act();
    const d = s.deliveries[deliveryId];
    // 스토어에 없으면 failed로 표시할 수도 없다. prepared가 아니면 재전송이다.
    if (!d || d.sendStatus !== 'prepared') return false;
    const fail = (why: string) => {
      console.warn(`[plugins] sendDelivery 거부(${d.pluginId}, ${deliveryId}): ${why}`);
      act().markDelivery(deliveryId, 'failed');
      return false;
    };
    if (stopped) return fail('호스트 중지');
    const p = s.plugins[d.pluginId];
    const rt = current.get(d.pluginId);
    if (!p || !selectCanSend(s, d.pluginId)) return fail('보낼 수 없는 상태');
    if (!rt || !rt.ready || !rt.win) return fail('ready인 iframe 없음');
    if (p.runtimeId !== rt.runtimeId || d.runtimeId !== rt.runtimeId) return fail('runtimeId 다름');
    if (!p.runtimePolicy || d.manifestVersion !== p.runtimePolicy.manifestVersion) return fail('manifestVersion 다름');
    if (d.manifestVersion !== rt.policy.manifestVersion) return fail('manifestVersion 다름');
    if (!d.blob || d.bytes !== d.blob.size) return fail('bytes ≠ blob.size');
    if (d.branch === 'raw' && (!s.session.compareMode || p.kind !== 'calorie' || rt.policy.connect !== 'none')) {
      return fail('raw는 비교 모드의 통신 차단 칼로리에만');
    }
    // 보호 모드에서 출구 재검사가 0이 아닌 조각은 A가 만들지 않는다. 그래도 들어오면 여기서 막는다(IF-02).
    if (!s.session.compareMode && (d.faceCheck.status !== 'checked' || d.faceCheck.detectedFaces > 0)) {
      return fail('보호 모드인데 출구 재검사 얼굴이 0이 아님');
    }
    const msg: HostToPlugin = {
      type: 'delivery',
      deliveryId: d.id,
      scene: d.scene,
      objectLabel: d.objectLabel,
      width: d.width,
      height: d.height,
      bytes: d.bytes,
      blob: d.blob,
    };
    rt.sent.add(d.id);
    try {
      rt.win.postMessage(msg, '*');
    } catch (err) {
      rt.sent.delete(d.id);
      return fail(`postMessage 예외: ${(err as Error).message}`);
    }
    act().markDelivery(d.id, 'dispatched');
    ackTimers.set(
      d.id,
      setTimeout(() => {
        ackTimers.delete(d.id);
        act().setAck(d.id, null); // 이미 받았으면 스토어가 무시한다.
      }, ackTimeoutMs),
    );
    return true;
  };

  window.addEventListener('message', onMessage);
  // fireImmediately는 리스너를 등록하기 전에 불린다. 그 안에서 stopped로 바뀌면 리스너가 낡은 값을 들고 있어
  // 나중에 다시 켜도 불리지 않는다. 그래서 먼저 구독하고 나서 직접 한 번씩 돈다.
  const ids = [...act().pluginOrder];
  const unsubs = ids.map((id) =>
    store.subscribe((s) => selectDesiredRuntime(s, id), () => reconcile(id), { equalityFn: shallow }),
  );
  for (const id of ids) reconcile(id);

  return {
    sendDelivery,
    stop() {
      if (stopped) return;
      stopped = true;
      window.removeEventListener('message', onMessage);
      for (const u of unsubs) u();
      for (const timer of ackTimers.values()) clearTimeout(timer);
      ackTimers.clear();
      for (const rt of [...current.values()]) {
        detach(rt);
        act().setPluginRuntime(rt.pluginId, { status: 'loading', runtimeId: null, runtimePolicy: null });
      }
      if (ownContainer) container.remove();
    },
  };
}

let defaultHost: PluginHost | null = null;

/** 기본 lensStore로 호스트 하나. 여러 번 불러도 하나만 만든다. React 밖(main.tsx)에서 부른다. */
export function startPluginHost(): () => void {
  if (!defaultHost) defaultHost = createPluginHost();
  return () => {
    defaultHost?.stop();
    defaultHost = null;
  };
}

/** IF-02. A broker만 부른다. 호스트가 없으면 failed. */
export function sendDelivery(deliveryId: string): boolean {
  if (defaultHost) return defaultHost.sendDelivery(deliveryId);
  const s = lensStore.getState();
  if (s.deliveries[deliveryId]?.sendStatus === 'prepared') s.markDelivery(deliveryId, 'failed');
  return false;
}

type DeliveryMessage = Extract<HostToPlugin, { type: 'delivery' }>;

/**
 * 트랙 A broker의 `connectPluginHost(send)`에 넘기는 모양(PR #11의 SendDelivery). 받은 메시지가 스토어 Delivery와
 * 같을 때(같은 Blob 객체 포함)만 sendDelivery로 보낸다. 다르면 failed. 실제로 보내는 메시지는 스토어에서 다시 만든다.
 */
export function sendDeliveryMessage(pluginId: string, msg: DeliveryMessage): void {
  const s = lensStore.getState();
  const d = s.deliveries[msg.deliveryId];
  if (!d || d.sendStatus !== 'prepared') return;
  const same =
    d.pluginId === pluginId &&
    d.blob === msg.blob &&
    d.bytes === msg.bytes &&
    d.scene === msg.scene &&
    d.objectLabel === msg.objectLabel &&
    d.width === msg.width &&
    d.height === msg.height;
  if (!same) {
    console.warn(`[plugins] 전달 메시지가 스토어 Delivery와 다름(${pluginId}, ${msg.deliveryId})`);
    s.markDelivery(d.id, 'failed');
    return;
  }
  sendDelivery(msg.deliveryId);
}

/** Delivery.sha256(소문자 16진). crypto.subtle(LAN HTTP에서는 없음)이 없으면 순수 JS. */
export async function sha256Hex(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
      return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // 순수 JS로 넘어간다.
    }
  }
  return sha256Pure(bytes);
}
