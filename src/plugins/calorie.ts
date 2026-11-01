// 칼로리 플러그인(F7). 계약: docs/specs/02-SSRD.md "플러그인 SDK" 네트워크 행·IF-08 "플러그인 폴백", 03-SRS FR-031·032.
// caloriePlugin은 Worker 소스에 toString()으로 들어가므로 바깥 이름을 참조하지 않는다.
// 고정표·라벨 규칙·표 밖 문구는 src/core/calorie.ts 값을 registry가 JSON 인자로 넣는다(서버와 같은 표).
// 순서: 기기 안 모델(하위 Worker, calorie-model.ts) → /api/calorie → 고정표. 설계 docs/designs/plugin-host.md §2.10.

import type { FrameletSdk } from '../core/sdk';
import type { OnDeviceConfig } from './calorie-model';
import type { Portion, clampApiKcal, portionKcal } from './portion';

export function caloriePlugin(
  framelet: FrameletSdk,
  table: Record<string, { ko: string; kcal: number }>,
  labelPattern: string,
  labelMax: number,
  timeoutMs: number,
  unknownText: string,
  onDevice: OnDeviceConfig | null,
  portions: Record<string, Portion>,
  toKcal: typeof portionKcal,
  clampApi: typeof clampApiKcal,
): void {
  const labelRe = new RegExp(labelPattern);
  const isValidLabel = (label: string) => label.length <= labelMax && labelRe.test(label);
  const rowOf = (label: string) =>
    isValidLabel(label) && Object.prototype.hasOwnProperty.call(table, label) ? table[label] : undefined;
  const portionOf = (label: string) =>
    isValidLabel(label) && Object.prototype.hasOwnProperty.call(portions, label) ? portions[label] : undefined;
  // core fallbackText와 같은 규칙.
  const fallbackText = (label: string) => {
    const row = rowOf(label);
    return row ? `${row.ko} 약 ${row.kcal}kcal` : unknownText;
  };

  // 기기 안 모델. 준비 전·실행 중·실패·시간 초과면 null을 돌려 API로 넘긴다.
  let model: Worker | null = null;
  let modelReady = false;
  let busy = false;
  let busySince = 0;
  // 연달아 실패한 횟수(시간 초과·출력 없음·5~5000 밖). 2번이면 이 iframe에서는 끈다.
  let failures = 0;
  let seq = 0;
  const waiting = new Map<
    number,
    { timer: ReturnType<typeof setTimeout>; portion: Portion | undefined; resolve: (kcal: number | null) => void }
  >();
  const stopModel = (why: string) => {
    // 개발자 도구에만 남긴다(호스트 기록·reportViolation 아님). 이 iframe에서는 API로 간다.
    console.warn(`[calorie] 기기 안 모델 끔: ${why}`);
    model?.terminate();
    model = null;
    modelReady = false;
    busy = false;
    const pending = [...waiting.values()];
    waiting.clear();
    for (const w of pending) {
      clearTimeout(w.timer);
      w.resolve(null);
    }
  };
  const fail = (why: string) => {
    failures += 1;
    if (failures >= 2) stopModel(`연달아 ${failures}번 실패(${why})`);
  };
  const startModel = (base: string) => {
    if (!onDevice) return;
    try {
      model = new Worker(URL.createObjectURL(new Blob([onDevice.workerSource], { type: 'text/javascript' })));
    } catch {
      model = null;
      return;
    }
    model.addEventListener('message', (e: MessageEvent) => {
      const m = e.data as Record<string, unknown> | null;
      if (typeof m !== 'object' || m === null) return;
      if (m.type === 'loaded') modelReady = true;
      else if (m.type === 'failed') stopModel(String(m.reason));
      else if (m.type === 'out' && typeof m.id === 'number') {
        busy = false;
        const w = waiting.get(m.id);
        if (!w) return; // 시간 초과 뒤 늦은 답: 실행 중 표시만 푼다.
        waiting.delete(m.id);
        clearTimeout(w.timer);
        const kcal = typeof m.kcal === 'number' ? m.kcal : null;
        const mass = typeof m.mass === 'number' ? m.mass : null;
        // 양은 라벨 범위 평균, 1g당 kcal만 모델에서(portion.ts). 계산할 수 없으면 API로 넘긴다.
        const shown = toKcal(w.portion, kcal, mass);
        if (shown === null) {
          w.resolve(null);
          fail(`쓸 수 없는 출력 kcal=${String(kcal)} mass=${String(mass)}`);
          return;
        }
        failures = 0;
        w.resolve(shown);
      }
    });
    model.addEventListener('error', () => stopModel('하위 Worker 오류'));
    model.postMessage({
      type: 'load',
      ortBase: `${base}${onDevice.ortPath}`,
      modelBase: `${base}${onDevice.modelPath}`,
      budgetMs: onDevice.timeoutMs,
    });
  };
  const onDeviceKcal = (blob: Blob, label: string): Promise<number | null> => {
    // 한 실행이 제한의 2배를 넘게 끝나지 않으면 멈춘 것으로 보고 끈다.
    if (onDevice && busy && Date.now() - busySince > 2 * onDevice.timeoutMs) stopModel('실행이 끝나지 않음');
    // 양 표에 없는 라벨(음료·컵·그릇 등)은 접시 음식용 모델의 숫자를 쓸 수 없어 바로 API로 간다.
    const portion = portionOf(label);
    if (!portion || !onDevice || model === null || !modelReady || busy) return Promise.resolve(null);
    const worker = model;
    const id = (seq += 1);
    busy = true;
    busySince = Date.now();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!waiting.delete(id)) return;
        resolve(null);
        fail('시간 초과');
      }, onDevice.timeoutMs);
      waiting.set(id, { timer, portion, resolve });
      worker.postMessage({ type: 'run', id, blob });
    });
  };

  let apiBase: string | null = null;
  framelet.onInit((init) => {
    apiBase = init.apiBase;
    // 비교 모드(connect-src 'none')나 network에서 $ORIGIN을 지운 매니페스트(F14)에서는 모델도 받지 않는다.
    // ready를 막지 않도록 기다리지 않는다.
    if (apiBase !== null && init.manifest.network.includes('$ORIGIN')) startModel(apiBase);
  });

  framelet.onDelivery(async (d) => {
    // 비교 모드(connect-src 'none')에서는 요청을 시도하지 않는다.
    if (apiBase === null) {
      framelet.result(d.deliveryId, fallbackText(d.objectLabel), 'fallback');
      return;
    }
    const kcal = await onDeviceKcal(d.blob, d.objectLabel);
    if (kcal !== null) {
      // 이름은 0단계 라벨에서(표에 없으면 서버와 같은 기본 이름).
      framelet.result(d.deliveryId, `${rowOf(d.objectLabel)?.ko ?? '음식'} 약 ${kcal}kcal`, 'on-device');
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
          // 서버 숫자도 같은 표의 kcal 범위로 자른다(엉뚱한 값을 막기 위해). "음식 아님"은 그대로.
          const m = /^(.+) 약 (\d+)kcal$/.exec(line);
          framelet.result(d.deliveryId, m ? `${m[1]} 약 ${clampApi(portionOf(d.objectLabel), Number(m[2]))}kcal` : line, 'api');
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
