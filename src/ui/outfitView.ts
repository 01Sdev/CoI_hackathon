// 코디 스캔 화면(말 막대·답 패널·응시 칩)을 언제 보일지. 순수 함수라 scripts/check-ui.ts가 확인한다.
// 사용자 보고(2026-11-01): 코디 스캔을 쓴 뒤 칼로리 앱에 들어가면 답 패널이 남아 있었고, 닫아도 다시 열면 또 생겼다.

/**
 * 답 패널을 보일지: 코디 스캔이 지금 켜진 앱이고, 마지막 질문이 닫은 것(또는 앱을 열 때 이미 있던 것)이 아닐 때.
 * 칼로리 같은 다른 앱에서는 store에 지난 질문이 남아 있어도 보이지 않는다.
 */
export function outfitPanelOpen(outfitOn: boolean, lastId: string | null, closedId: string | null): boolean {
  return outfitOn && lastId !== null && lastId !== closedId;
}

/** 코디 스캔이 켜질 때 닫힌 기준: 그때까지의 마지막 질문. 지난 대화는 닫힌 채로 시작하고, 새 질문이 생기면 열린다. */
export function closedOnEnter(lastId: string | null): string | null {
  return lastId;
}
