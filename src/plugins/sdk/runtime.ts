// Worker 안의 전역 `famelet` SDK. 규칙: docs/specs/02-SSRD.md "플러그인 SDK", 설계: docs/designs/plugin-host.md §2.6.
// Worker 소스에 toString()으로 들어가므로 인자와 Worker 전역(setTimeout, Blob, Uint8Array…)만 쓴다. import는 타입만.

import type { ViolationAttempt } from '../../core/messages';
import type { FameletDelivery, FameletInit, FameletSdk } from '../../core/sdk';

export interface SdkOptions {
  initTimeoutMs: number;
  textLimit: number;
  targetLimit: number;
  /** crypto.subtle이 있어도 순수 JS 해시를 쓴다(V10·TC-059). */
  forcePureHash: boolean;
  /** /dev M0 시험용. corrupt = 받은 바이트 1개를 바꿔 해시, suppress = ack를 보내지 않음. */
  testAckMode: 'normal' | 'corrupt' | 'suppress';
}

/** Worker 전역 중 SDK가 쓰는 부분. Node 시험에서는 가짜 객체를 넘긴다. */
export interface WorkerScopeLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void;
  crypto?: { subtle?: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> } };
}

export function installFameletSdk(
  scope: WorkerScopeLike,
  sha256Pure: (bytes: Uint8Array) => string,
  options: SdkOptions,
): void {
  // 플러그인이 나중에 scope.postMessage를 바꿔도 SDK는 처음 것을 쓴다(그래도 자기 보고일 뿐이다).
  const post = scope.postMessage.bind(scope);
  const attempts: readonly string[] = ['camera', 'hostDom', 'fetch', 'script'];
  let initHandler: ((init: FameletInit) => void | Promise<void>) | null = null;
  let deliveryHandler: ((d: FameletDelivery) => void | Promise<void>) | null = null;
  let initSeen = false;
  let ready = false;
  const received = new Set<string>();
  const resulted = new Set<string>();
  const reported = new Set<string>();

  const clip = (s: string, max: number) => {
    const cps = Array.from(s);
    return cps.length > max ? cps.slice(0, max).join('') : s;
  };

  const hash = async (bytes: Uint8Array) => {
    const subtle = options.forcePureHash ? undefined : scope.crypto?.subtle;
    if (subtle) {
      try {
        const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
        let hex = '';
        for (let i = 0; i < digest.length; i++) hex += digest[i]!.toString(16).padStart(2, '0');
        return hex;
      } catch {
        // 순수 JS로 넘어간다.
      }
    }
    return sha256Pure(bytes);
  };

  const handleInit = async (m: Record<string, unknown>) => {
    const init: FameletInit = {
      pluginId: String(m.pluginId),
      manifest: m.manifest as FameletInit['manifest'],
      apiBase: typeof m.apiBase === 'string' ? m.apiBase : null,
    };
    const handler = initHandler;
    if (handler) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.resolve().then(() => handler(init)),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('init timeout')), options.initTimeoutMs);
          }),
        ]);
      } catch {
        // 예외·2.5초 초과: ready를 보내지 않는다. 호스트가 3초 뒤 stopped로 만든다.
        return;
      } finally {
        clearTimeout(timer);
      }
    }
    ready = true;
    post({ type: 'ready', pluginId: init.pluginId });
  };

  const handleDelivery = async (m: Record<string, unknown>) => {
    const blob = m.blob;
    const deliveryId = m.deliveryId;
    if (!ready || typeof deliveryId !== 'string' || !(blob instanceof Blob) || received.has(deliveryId)) return;
    received.add(deliveryId);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (options.testAckMode !== 'suppress') {
      if (options.testAckMode === 'corrupt' && bytes.length > 0) bytes[0] = bytes[0]! ^ 0xff;
      // 핸들러보다 먼저 보낸다(IF-04).
      post({ type: 'ack', deliveryId, sha256: await hash(bytes) });
    }
    const handler = deliveryHandler;
    if (!handler) return;
    const d: FameletDelivery = {
      deliveryId,
      scene: m.scene as FameletDelivery['scene'],
      objectLabel: String(m.objectLabel),
      width: Number(m.width),
      height: Number(m.height),
      bytes: Number(m.bytes),
      blob,
    };
    try {
      await handler(d);
    } catch {
      // 결과 줄 없음. C는 이전 결과를 그대로 둔다.
    }
  };

  scope.addEventListener('message', (e) => {
    const m = e.data;
    if (typeof m !== 'object' || m === null) return;
    const msg = m as Record<string, unknown>;
    if (msg.type === 'init') {
      if (initSeen) return;
      initSeen = true;
      void handleInit(msg);
    } else if (msg.type === 'delivery') {
      void handleDelivery(msg);
    }
  });

  const sdk: FameletSdk = {
    onInit(handler) {
      initHandler = typeof handler === 'function' ? handler : null;
    },
    onDelivery(handler) {
      deliveryHandler = typeof handler === 'function' ? handler : null;
    },
    result(deliveryId, text, source) {
      if (typeof deliveryId !== 'string' || !received.has(deliveryId) || resulted.has(deliveryId)) return;
      if (source !== 'api' && source !== 'fallback') return;
      resulted.add(deliveryId);
      post({ type: 'result', deliveryId, text: clip(String(text), options.textLimit), source });
    },
    reportViolation(attempt: ViolationAttempt, target) {
      if (!attempts.includes(attempt)) return;
      const t = clip(String(target), options.targetLimit);
      const key = `${attempt}\n${t}`;
      if (reported.has(key)) return;
      reported.add(key);
      post({ type: 'violation', attempt, target: t });
    },
  };
  Object.defineProperty(scope, 'famelet', { value: Object.freeze(sdk), enumerable: true });
}
