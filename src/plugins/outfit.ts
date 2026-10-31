// 코디 스캔 플러그인(두 번째 앱, docs/designs/outfit-pipelines.md "파이프라인 2: 말로 묻기"). 계약: 02-SSRD IF-09·IF-10·IF-11.
// outfitPlugin은 Worker 소스에 toString()으로 들어가므로 바깥 이름을 참조하지 않는다. 값은 registry가 JSON 인자로 넣는다.
// 받은 조각 Blob을 deliveryId별로 몇 개만 들고 있다가, 질문이 오면 그 조각과 질문을 /api/outfit에 보낸다.

import type { FrameletSdk } from '../core/sdk';

/** 서버가 답하지 못했거나 플러그인이 서버에 닿지 못했을 때의 답(IF-11 대체 문구). 서버(api/outfit.ts)도 같은 문구를 쓴다. */
export const OUTFIT_FALLBACK_TEXT = '지금은 옷 정보를 가져오지 못했어요. 잠시 뒤 다시 물어봐 주세요.';
/** fetch부터 본문 읽기까지. 서버 제한 15초 + 전송, 호스트가 기다리는 20초(OUTFIT_ANSWER_TIMEOUT_MS)보다 짧다. */
export const OUTFIT_CLIENT_TIMEOUT_MS = 18_000;
/** 들고 있는 최근 조각 수. 질문은 가장 최근 조각으로 오지만 전달이 이어지는 사이에 물을 수 있다. */
export const OUTFIT_KEEP_DELIVERIES = 4;

export function outfitPlugin(framelet: FrameletSdk, timeoutMs: number, keep: number, fallbackText: string): void {
  let apiBase: string | null = null;
  framelet.onInit((init) => {
    apiBase = init.apiBase;
  });

  // 넣은 순서를 지키는 Map. 오래된 것부터 버린다.
  const blobs = new Map<string, Blob>();
  framelet.onDelivery((d) => {
    blobs.set(d.deliveryId, d.blob);
    while (blobs.size > keep) blobs.delete(blobs.keys().next().value as string);
  });

  const toBase64 = async (blob: Blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    // String.fromCharCode의 인자 개수 한도를 넘지 않게 나눠서.
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };

  framelet.onQuestion(async (q) => {
    const blob = blobs.get(q.deliveryId);
    if (!blob || apiBase === null) {
      framelet.answer(q.questionId, fallbackText, 'fallback');
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${apiBase}/api/outfit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: await toBase64(blob), question: q.text }),
        signal: ctrl.signal,
      });
      if (res.ok) {
        const body = (await res.json()) as { answer?: unknown; source?: unknown };
        if (typeof body.answer === 'string' && body.answer.trim()) {
          // 서버가 대체 문구를 주면 source도 fallback(IF-11).
          framelet.answer(q.questionId, body.answer, body.source === 'fallback' ? 'fallback' : 'api');
          return;
        }
      }
      framelet.answer(q.questionId, fallbackText, 'fallback');
    } catch {
      // 중단·네트워크 오류·CSP 차단. reportViolation은 부르지 않는다(칼로리와 같다).
      framelet.answer(q.questionId, fallbackText, 'fallback');
    } finally {
      clearTimeout(timer);
    }
  });
}
