// 칼로리 플러그인(F7). 계약: docs/specs/02-SSRD.md "플러그인 SDK" 네트워크 행·IF-08 "플러그인 폴백", 03-SRS FR-031·032.
// caloriePlugin은 Worker 소스에 toString()으로 들어가므로 바깥 이름을 참조하지 않는다.
// 고정표·라벨 규칙·표 밖 문구는 src/core/calorie.ts 값을 registry가 JSON 인자로 넣는다(서버와 같은 표).

import type { FrameletSdk } from '../core/sdk';

export function caloriePlugin(
  framelet: FrameletSdk,
  table: Record<string, { ko: string; kcal: number }>,
  labelPattern: string,
  labelMax: number,
  timeoutMs: number,
  unknownText: string,
): void {
  const labelRe = new RegExp(labelPattern);
  const isValidLabel = (label: string) => label.length <= labelMax && labelRe.test(label);
  // core fallbackText와 같은 규칙.
  const fallbackText = (label: string) => {
    const row = isValidLabel(label) && Object.prototype.hasOwnProperty.call(table, label) ? table[label] : undefined;
    return row ? `${row.ko} 약 ${row.kcal}kcal` : unknownText;
  };

  let apiBase: string | null = null;
  framelet.onInit((init) => {
    apiBase = init.apiBase;
  });

  framelet.onDelivery(async (d) => {
    // 비교 모드(connect-src 'none')에서는 요청을 시도하지 않는다.
    if (apiBase === null) {
      framelet.result(d.deliveryId, fallbackText(d.objectLabel), 'fallback');
      return;
    }
    const headers: Record<string, string> = { 'Content-Type': 'image/jpeg' };
    // 헤더는 Latin-1만 된다. 서버와 같은 정규식을 통과한 라벨만 싣는다.
    if (isValidLabel(d.objectLabel)) headers['x-label'] = d.objectLabel;
    // 3초는 fetch 바로 전부터 res.text()까지. 같은 signal로 본문 읽기도 덮는다.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      // 본문은 받은 Blob 그대로(F6: 로그 바이트 = 요청 본문). 다시 인코딩하지 않는다.
      const res = await fetch(`${apiBase}/api/calorie`, { method: 'POST', body: d.blob, headers, signal: ctrl.signal });
      if (res.ok) {
        const line = (await res.text()).split('\n')[0]?.trim() ?? '';
        if (line) {
          framelet.result(d.deliveryId, line, 'api');
          return;
        }
      }
      framelet.result(d.deliveryId, fallbackText(d.objectLabel), 'fallback');
    } catch {
      // 중단·네트워크 오류·CSP 차단: 고정표. reportViolation은 부르지 않는다(서버 장애가 HUD 빨강으로 보이지 않게).
      framelet.result(d.deliveryId, fallbackText(d.objectLabel), 'fallback');
    } finally {
      clearTimeout(timer);
    }
  });
}
