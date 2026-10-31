// 라벨별 양·1g당 kcal 범위(사용자 결정, 2026-11-01). 계약: docs/specs/02-SSRD.md IF-08 "기기 안 모델".
// calorie-lens는 화면에 보이는 크기로 양을 짐작하는데, framelet은 조각을 잘라 늘려서 넘기므로 실제 크기를 알 수 없다.
// 그래서 양은 라벨의 범위 평균으로 두고, 모델에서는 1g당 kcal(totals.kcal / mass)만 범위 안에서 쓴다.
// portionKcal·clampApiKcal은 칼로리 Worker에 toString()으로 들어가므로 인자만 쓴다.

export interface Portion {
  /** 양 범위(g). */
  minG: number;
  maxG: number;
  /** 1g당 kcal 범위. */
  densMin: number;
  densMax: number;
}

/**
 * 키는 0단계 COCO 라벨(core CALORIE_TABLE과 같은 10종).
 * pizza는 사용자 확정값(한 조각 110g ~ 12인치 한 판 800g, 2.2~3.0kcal/g).
 * 나머지는 가정값: USDA FoodData Central의 보통 1회 분량과 100g당 kcal을 바탕으로, 작은 1개 ~ 큰 1개(또는 2개)를 양 범위로 잡았다.
 */
export const PORTION_TABLE: Readonly<Record<string, Portion>> = {
  pizza: { minG: 110, maxG: 800, densMin: 2.2, densMax: 3.0 },
  banana: { minG: 80, maxG: 240, densMin: 0.85, densMax: 0.95 }, // 가정값: 중간 1개 118g, 89kcal/100g
  apple: { minG: 100, maxG: 250, densMin: 0.48, densMax: 0.6 }, // 가정값: 중간 1개 182g, 52kcal/100g
  orange: { minG: 90, maxG: 220, densMin: 0.43, densMax: 0.52 }, // 가정값: 중간 1개 131g, 47kcal/100g
  donut: { minG: 40, maxG: 120, densMin: 3.4, densMax: 4.6 }, // 가정값: 글레이즈드 1개 60g, 421kcal/100g(잼 도넛 340)
  sandwich: { minG: 100, maxG: 350, densMin: 1.8, densMax: 3.0 }, // 가정값: 1개 150~250g, 200~280kcal/100g
  cake: { minG: 60, maxG: 200, densMin: 2.5, densMax: 4.2 }, // 가정값: 한 조각 80~100g, 290~370kcal/100g
  'hot dog': { minG: 70, maxG: 200, densMin: 2.3, densMax: 3.2 }, // 가정값: 빵 포함 1개 98g, 250kcal/100g
  broccoli: { minG: 50, maxG: 300, densMin: 0.3, densMax: 0.5 }, // 가정값: 1컵 91g, 34kcal/100g
  carrot: { minG: 40, maxG: 200, densMin: 0.35, densMax: 0.5 }, // 가정값: 중간 1개 61g, 41kcal/100g
};

/**
 * 기기 안 모델 값 → 표시할 kcal. 계산할 수 없으면 null(호출하는 쪽이 API로 넘긴다).
 * 표에 있는 라벨: 반올림((minG + maxG) / 2 × clamp(kcal / mass, densMin, densMax)). 모델의 mass는 비율에만 쓴다.
 * 표 밖 라벨: 모델 kcal 그대로(반올림).
 * kcal이 5~5000 밖이면 단위·정규화가 어긋난 출력으로 보고 null. 결과는 서버와 같은 표시 범위 10~3000으로 자른다.
 */
export function portionKcal(portion: Portion | undefined, modelKcal: number | null, modelMassG: number | null): number | null {
  if (modelKcal === null || !(modelKcal >= 5 && modelKcal <= 5000)) return null;
  let kcal = modelKcal;
  if (portion) {
    if (modelMassG === null || !(modelMassG > 0) || !Number.isFinite(modelMassG)) return null;
    const density = Math.min(portion.densMax, Math.max(portion.densMin, modelKcal / modelMassG));
    kcal = ((portion.minG + portion.maxG) / 2) * density;
  }
  return Math.min(3000, Math.max(10, Math.round(kcal)));
}

/** API(Haiku) kcal을 같은 표의 [minG × densMin, maxG × densMax]로 자른다(반올림). 표 밖 라벨은 그대로. */
export function clampApiKcal(portion: Portion | undefined, kcal: number): number {
  if (!portion) return kcal;
  return Math.min(Math.round(portion.maxG * portion.densMax), Math.max(Math.round(portion.minG * portion.densMin), kcal));
}
