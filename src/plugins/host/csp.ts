// iframe 문서 CSP와 srcdoc. docs/specs/02-SSRD.md "iframe 문서 CSP", docs/designs/plugin-host.md §2.2.

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

export function buildCsp(nonce: string, connect: readonly string[]): string {
  if (!NONCE.test(nonce)) throw new Error('nonce 형식 오류');
  const list = safeConnectList(connect);
  const connectSrc = list.length > 0 ? list.join(' ') : "'none'";
  return `default-src 'none'; script-src 'nonce-${nonce}'; worker-src blob:; connect-src ${connectSrc}`;
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
