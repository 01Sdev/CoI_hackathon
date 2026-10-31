// 호스트 창의 외부 요청 가드. 근거: docs/specs/02-SSRD.md "호스트 페이지의 외부 요청 차단" 1번(P0).
// fetch·XMLHttpRequest·navigator.sendBeacon이 같은 origin이 아닌 주소로 가면 보내지 않고 console.warn을 남긴다.
// MediaPipe tasks-vision 1.2.0의 로그 요청(odml.pa.googleapis.com/v1/log)을 멈추기 위해서다.
// fetch가 거부되면 그 로거는 다시 시도하지 않는다(PROGRESS V15, 트랙 A 실측). 라이브러리는 보낼 때 fetch를 찾으므로
// import 뒤에 걸어도 잡힌다.
// 브라우저가 강제하는 경계는 아니다(CSP connect-src는 V15 iPhone 확인 뒤, 2번). 플러그인 iframe·Worker는 자기 전역을 쓰므로
// 이 가드와 상관없다.

import { APP_NAME } from '../core/constants';

/** 같은 origin, blob:, data:만 허용한다. 주소를 해석하지 못하면 막는다. */
export function isAllowedHostRequest(url: string, origin: string): boolean {
  let u: URL;
  try {
    u = new URL(url, origin);
  } catch {
    return false;
  }
  if (u.protocol === 'blob:' || u.protocol === 'data:') return true;
  return u.origin === origin;
}

/** 가드를 거는 대상. 제품에서는 window, 시험에서는 가짜 객체. */
export interface GuardTarget {
  location: { origin: string };
  fetch: typeof fetch;
  XMLHttpRequest?: typeof XMLHttpRequest;
  navigator: { sendBeacon?: (url: string | URL, data?: BodyInit | null) => boolean };
}

export interface GuardHandle {
  /** 막은 요청 수(종류 합계). 개발 도구에서 확인용. */
  blocked(): number;
}

const installed = new WeakMap<GuardTarget, GuardHandle>();

/** 여러 번 불러도 한 번만 건다. warn은 종류·대상 origin마다 처음 한 번만 남긴다. */
export function installHostRequestGuard(w: GuardTarget, warn: (...args: unknown[]) => void = console.warn): GuardHandle {
  const existing = installed.get(w);
  if (existing) return existing;

  const origin = w.location.origin;
  let count = 0;
  const warned = new Set<string>();
  const block = (kind: 'fetch' | 'xhr' | 'beacon', url: string): TypeError => {
    count += 1;
    let target = url;
    try {
      target = new URL(url, origin).origin;
    } catch {
      // 해석하지 못한 주소는 그대로 적는다.
    }
    const key = `${kind}|${target}`;
    if (!warned.has(key)) {
      warned.add(key);
      warn(`[${APP_NAME}] 호스트 외부 요청을 막음`, kind, target);
    }
    return new TypeError(`호스트 외부 요청 차단: ${target}`);
  };

  const origFetch = w.fetch.bind(w);
  w.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!isAllowedHostRequest(url, origin)) return Promise.reject(block('fetch', url));
    return origFetch(input, init);
  }) as typeof fetch;

  const X = w.XMLHttpRequest;
  if (X) {
    const open = X.prototype.open as (this: XMLHttpRequest, ...args: unknown[]) => void;
    const send = X.prototype.send as (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) => void;
    const blockedXhr = new WeakSet<XMLHttpRequest>();
    X.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
      const url = String(args[1]);
      if (isAllowedHostRequest(url, origin)) blockedXhr.delete(this);
      else {
        blockedXhr.add(this);
        block('xhr', url);
      }
      open.apply(this, args);
    } as typeof X.prototype.open;
    X.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      if (!blockedXhr.has(this)) {
        send.call(this, body);
        return;
      }
      // 보내지 않고 네트워크 오류처럼 끝낸다.
      setTimeout(() => this.dispatchEvent(new Event('error')), 0);
    };
  }

  const beacon = w.navigator.sendBeacon?.bind(w.navigator);
  if (beacon) {
    w.navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
      const href = String(url);
      if (!isAllowedHostRequest(href, origin)) {
        block('beacon', href);
        return false;
      }
      return beacon(url, data);
    };
  }

  const handle: GuardHandle = { blocked: () => count };
  installed.set(w, handle);
  return handle;
}
