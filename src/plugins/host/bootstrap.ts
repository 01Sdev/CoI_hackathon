// iframe 안 부트스트랩(nonce 스크립트). docs/specs/02-SSRD.md IF-01, "플러그인 입력 위생" 마지막 문장.
// srcdoc에 toString()으로 들어가므로 바깥 이름을 참조하지 않는다. 형식 검사는 호스트가 한다.

export function iframeBootstrap(): void {
  const host = window.parent;
  const onInit = (e: MessageEvent) => {
    if (e.source !== host) return;
    const m = e.data as Record<string, unknown> | null;
    if (typeof m !== 'object' || m === null || m.type !== 'init' || typeof m.code !== 'string') return;
    // init은 1번만 받는다.
    window.removeEventListener('message', onInit);
    let worker: Worker;
    try {
      worker = new Worker(URL.createObjectURL(new Blob([m.code], { type: 'text/javascript' })));
    } catch {
      // fail-closed: 플러그인 코드를 iframe에서 실행하지 않는다. ready가 없으니 호스트가 3초 뒤 stopped로 만든다.
      return;
    }
    worker.addEventListener('message', (ev) => {
      try {
        host.postMessage(ev.data, '*');
      } catch {
        // 복제할 수 없는 값은 버린다.
      }
    });
    window.addEventListener('message', (ev) => {
      if (ev.source !== host) return;
      const d = ev.data as Record<string, unknown> | null;
      if (typeof d === 'object' && d !== null && d.type === 'delivery') worker.postMessage(d);
    });
    worker.postMessage({ type: 'init', pluginId: m.pluginId, manifest: m.manifest, apiBase: m.apiBase });
  };
  window.addEventListener('message', onInit);
}
