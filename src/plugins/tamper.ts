// 변조 플러그인(F13, FR-024). 카메라·호스트 화면·외부 fetch·외부 스크립트 4종을 시도하고 각각 자기 보고한다(IF-06).
// 기대값은 02-SSRD §3 "검증 근거" 표: Worker에는 API가 없거나 ReferenceError, 요청은 CSP가 막는다(서버 도달 0건).
// tamperPlugin은 Worker 소스에 toString()으로 들어가므로 바깥 이름을 참조하지 않는다.

import type { FrameletSdk } from '../core/sdk';

/** 막혀야 하는 외부 주소. 차단이 실패하면 무해한 example.com으로만 간다(네트워크 탭에서 확인). */
export const TAMPER_TARGETS = {
  fetch: 'https://example.com/framelet-tamper',
  script: 'https://example.com/framelet-tamper.js',
} as const;

export function tamperPlugin(framelet: FrameletSdk, targets: { fetch: string; script: string }): void {
  const g = self as unknown as Record<string, unknown>;
  const errName = (e: unknown) => (e instanceof Error ? e.name : typeof e);

  const tryCamera = async () => {
    const nav = g.navigator as { mediaDevices?: { getUserMedia?: (c: unknown) => Promise<unknown> } } | undefined;
    const gum = nav?.mediaDevices?.getUserMedia;
    if (typeof gum !== 'function') return 'navigator.mediaDevices.getUserMedia → 없음';
    try {
      await gum.call(nav!.mediaDevices, { video: true });
      return 'navigator.mediaDevices.getUserMedia → 차단 실패!';
    } catch (e) {
      return `navigator.mediaDevices.getUserMedia → ${errName(e)}`;
    }
  };

  const tryHostDom = () => {
    // 이름을 그대로 평가해야 ReferenceError가 난다(typeof는 나지 않는다). CSP에 unsafe-eval이 없어 new Function은 쓰지 않는다.
    const probes: [string, () => unknown][] = [
      ['document', () => document],
      ['parent', () => parent],
      ['top', () => top],
      ['localStorage', () => localStorage],
    ];
    const seen: string[] = [];
    for (const [name, probe] of probes) {
      try {
        const v = probe();
        seen.push(`${name}=${v === undefined || v === null ? String(v) : '있음(차단 실패!)'}`);
      } catch (e) {
        seen.push(`${name}=${errName(e)}`);
      }
    }
    return seen.join(' · ');
  };

  const tryFetch = async (body?: Blob) => {
    try {
      await fetch(targets.fetch, { method: 'POST', body: body ?? 'tamper', mode: 'no-cors' });
      return `차단 실패! ${targets.fetch}`;
    } catch {
      return targets.fetch;
    }
  };

  const tryScript = () => {
    try {
      (g.importScripts as (url: string) => void)(targets.script);
      return `차단 실패! ${targets.script}`;
    } catch {
      return targets.script;
    }
  };

  const runAll = async () => {
    framelet.reportViolation('camera', await tryCamera());
    framelet.reportViolation('hostDom', tryHostDom());
    framelet.reportViolation('fetch', await tryFetch());
    framelet.reportViolation('script', tryScript());
  };

  // ready를 먼저 보내고 나서 시도한다(켜면 4줄, TC-006).
  framelet.onInit(() => {
    setTimeout(() => void runAll(), 0);
  });
  // 받은 조각도 밖으로 보내 본다. 같은 target이라 SDK가 기록은 다시 보내지 않는다.
  framelet.onDelivery(async (d) => {
    framelet.reportViolation('fetch', await tryFetch(d.blob));
  });
}
