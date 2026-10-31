// iframe 문서 CSP와 srcdoc. docs/specs/02-SSRD.md "iframe 문서 CSP", docs/designs/plugin-host.md §2.2.

import { ORT_PATH } from '../calorie-model';

const NONCE = /^[A-Za-z0-9+/]+={0,2}$/;

/** iframe마다 새로. 16바이트 base64. getRandomValues는 HTTP에서도 있다. */
export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** validateManifest의 network 정규식에 http를 더한 것($ORIGIN이 로컬 개발에서 http다). */
const ORIGIN = /^https?:\/\/[a-z0-9.-]+(:[0-9]+)?$/;

/**
 * connect-src에 넣어도 되는 origin만 남긴다. validateManifest 다음의 두 번째 방어:
 * 엄격한 정규식(`&`·따옴표·공백·`;` 없음)과 `new URL(o).origin === o`를 둘 다 통과해야 한다.
 */
export function safeConnectList(origins: readonly string[]): string[] {
  return origins.filter((o) => {
    if (!ORIGIN.test(o)) return false;
    try {
      return new URL(o).origin === o;
    } catch {
      return false;
    }
  });
}

/**
 * wasmOrigin은 칼로리의 기기 안 모델용이다(호스트가 칼로리에만 넘기고, connect-src 목록에 있을 때만 쓴다).
 * 있으면 script-src에 'wasm-unsafe-eval'(WASM 컴파일)과 `<origin>/ort/`(onnxruntime-web 스크립트, 경로까지만)를 더한다.
 * 새 바깥 통로는 열리지 않는다: 같은 origin은 이미 connect-src에 있다.
 */
export function buildCsp(nonce: string, connect: readonly string[], wasmOrigin: string | null = null): string {
  if (!NONCE.test(nonce)) throw new Error('nonce 형식 오류');
  const list = safeConnectList(connect);
  const connectSrc = list.length > 0 ? list.join(' ') : "'none'";
  const wasm = wasmOrigin !== null && list.includes(wasmOrigin) ? ` 'wasm-unsafe-eval' ${wasmOrigin}${ORT_PATH}` : '';
  return `default-src 'none'; script-src 'nonce-${nonce}'${wasm}; worker-src blob:; connect-src ${connectSrc}`;
}

export function buildSrcdoc(nonce: string, csp: string, script: string): string {
  if (!NONCE.test(nonce)) throw new Error('nonce 형식 오류');
  if (/[<>"&]/.test(csp)) throw new Error('CSP에 HTML 특수 문자');
  if (/<\/script/i.test(script)) throw new Error('부트스트랩에 </script');
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `</head><body><script nonce="${nonce}">${script}</script></body></html>`
  );
}
