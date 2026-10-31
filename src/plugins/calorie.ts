// 칼로리 플러그인(F7). 계약: docs/specs/02-SSRD.md IF-08 "플러그인 폴백"·"플러그인 SDK" 네트워크 행, 03-SRS FR-031·032.
// caloriePlugin은 Worker 소스에 toString()으로 들어가므로 바깥 이름을 참조하지 않는다. 고정표와 시간은 인자로 받는다.

import type { FameletSdk } from '../core/sdk';

/** objectLabel(COCO 영문) → [한국어 이름, kcal]. 02-SSRD IF-08 표. api/calorie.ts의 표와 같아야 한다(check-plugins가 대조). */
export const CALORIE_FALLBACK_TABLE: Readonly<Record<string, readonly [string, number]>> = {
  banana: ['바나나', 105],
  apple: ['사과', 95],
  orange: ['오렌지', 62],
  donut: ['도넛', 250],
  pizza: ['피자', 285],
  sandwich: ['샌드위치', 300],
  cake: ['케이크', 350],
  'hot dog': ['핫도그', 290],
  broccoli: ['브로콜리', 30],
  carrot: ['당근', 25],
};

/** 표에 없는 음식 라벨(bowl·cup 등). 03-SRS FR-032(결정). */
export const UNKNOWN_FOOD_TEXT = '음식(칼로리 정보 없음)';

export function caloriePlugin(
  famelet: FameletSdk,
  table: Record<string, [string, number]>,
  timeoutMs: number,
  unknownText: string,
): void {
  let apiBase: string | null = null;
  famelet.onInit((init) => {
    apiBase = init.apiBase;
  });

  const fallback = (label: string) => {
    const row = Object.prototype.hasOwnProperty.call(table, label) ? table[label] : undefined;
    return row ? `${row[0]} 약 ${row[1]}kcal` : unknownText;
  };

  famelet.onDelivery(async (d) => {
    // 비교 모드(connect-src 'none')에서는 요청을 시도하지 않는다. 그래서 차단 기록도 생기지 않는다.
    if (apiBase === null) {
      famelet.result(d.deliveryId, fallback(d.objectLabel), 'fallback');
      return;
    }
    const url = `${apiBase}/api/calorie`;
    const headers: Record<string, string> = { 'Content-Type': 'image/jpeg' };
    // 헤더는 Latin-1만 된다. 서버와 같은 규칙의 라벨만 싣는다.
    if (/^[a-z][a-z ]{0,31}$/.test(d.objectLabel)) headers['x-label'] = d.objectLabel;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      // 본문은 받은 Blob 그대로(F6: 로그 바이트 = 요청 본문). 다시 인코딩하지 않는다.
      const res = await fetch(url, { method: 'POST', body: d.blob, headers, signal: ctrl.signal });
      if (res.ok) {
        const line = (await res.text()).split('\n')[0]?.trim() ?? '';
        if (line) {
          famelet.result(d.deliveryId, line, 'api');
          return;
        }
      }
      // 413·415·429·502 등 비 200, 빈 본문: 고정표.
      famelet.result(d.deliveryId, fallback(d.objectLabel), 'fallback');
    } catch {
      // 3초 초과(abort)는 기록하지 않는다. 그 밖의 요청 실패(CSP 차단·네트워크 오류)는 자기 보고한다.
      // 호스트가 url의 origin을 connect-src와 대조해 "허용 목록 밖"(F14 도메인 삭제) / "허용 목록 안인데 실패"(오프라인)를 붙인다.
      if (!ctrl.signal.aborted) famelet.reportViolation('fetch', url);
      famelet.result(d.deliveryId, fallback(d.objectLabel), 'fallback');
    } finally {
      clearTimeout(timer);
    }
  });
}
