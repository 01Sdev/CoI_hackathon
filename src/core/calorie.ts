// 칼로리 고정표와 라벨 규칙. 서버(api/calorie)와 칼로리 플러그인(Worker 문자열에 JSON으로 끼워 넣음)이 같이 쓴다.
// 근거: docs/specs/02-SSRD.md IF-08 "플러그인 폴백"·"서버의 모델 호출".

/** COCO 영문 라벨 → 한국어 이름과 1인분(한 조각) kcal. */
export const CALORIE_TABLE: Readonly<Record<string, { ko: string; kcal: number }>> = {
  banana: { ko: '바나나', kcal: 105 },
  apple: { ko: '사과', kcal: 95 },
  orange: { ko: '오렌지', kcal: 62 },
  donut: { ko: '도넛', kcal: 250 },
  pizza: { ko: '피자', kcal: 285 },
  sandwich: { ko: '샌드위치', kcal: 300 },
  cake: { ko: '케이크', kcal: 350 },
  'hot dog': { ko: '핫도그', kcal: 290 },
  broccoli: { ko: '브로콜리', kcal: 30 },
  carrot: { ko: '당근', kcal: 25 },
};

/** x-label로 받는 값: 소문자 단어를 공백 하나로 이은 것, 32자 이하. */
export const X_LABEL_RE = /^[a-z]+( [a-z]+)*$/;
export const X_LABEL_MAX = 32;

export function isValidLabel(label: string | null | undefined): label is string {
  return typeof label === 'string' && label.length <= X_LABEL_MAX && X_LABEL_RE.test(label);
}

/** 고정표 한 줄. 표에 없으면 "음식(종류 미상)". */
export function fallbackText(objectLabel: string): string {
  const row = isValidLabel(objectLabel) ? CALORIE_TABLE[objectLabel] : undefined;
  return row ? `${row.ko} 약 ${row.kcal}kcal` : '음식(종류 미상)';
}

export type Portion = '한 조각' | '1인분' | '한 판' | '알 수 없음';

/**
 * 모델 답의 kcal 보정(서버 응답 처리 6단계). 순서: 고정표 비율 비교 → 10~3000 자르기.
 * 비율이 [0.25, 4]×기준을 벗어나면 고정표 값과 이름으로 바꾸고 clamped = true. 기준은 한 판이면 8조각.
 */
export function adjustKcal(
  kcal: number,
  name: string,
  portion: Portion,
  xLabel: string | null | undefined,
): { kcal: number; name: string; clamped: boolean } {
  const row = isValidLabel(xLabel) ? CALORIE_TABLE[xLabel] : undefined;
  let k = kcal;
  let n = name;
  let clamped = false;
  if (row) {
    const base = row.kcal * (portion === '한 판' ? 8 : 1);
    if (k < base * 0.25 || k > base * 4) {
      k = base;
      n = row.ko;
      clamped = true;
    }
  }
  return { kcal: Math.min(3000, Math.max(10, Math.round(k))), name: n, clamped };
}
