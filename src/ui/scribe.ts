// 코디 스캔 실시간 받아쓰기(ElevenLabs Scribe)의 순수 부분. scripts/check-ui.ts가 확인한다. 연결과 화면 상태는 useScribeInput.ts.

/** 받아쓰기 서비스 고지(말 막대 위 한 줄). 규약 보기 SPEECH_NOTE와 같은 뜻이다. */
export const STT_NOTICE = '말소리는 받아쓰기 서비스(ElevenLabs)로 보내요';

/** 확정된 덩어리를 이어 붙인다(공백 하나로). */
export function joinScribe(a: string, b: string): string {
  return [a.trim(), b.trim()].filter(Boolean).join(' ');
}

/**
 * 멈춘 뒤 질문으로 쓸 글자. A의 stop()이 확정 글자 전체를 돌려주면 그것, 아니면 onCommitted로 모은 글자,
 * 그것도 없으면 마지막 중간 글자(확정 전에 멈춘 경우)다. 공백은 하나로 줄인다.
 */
export function scribeFinalText(stopResult: unknown, committed: string, partial: string): string {
  const pick = typeof stopResult === 'string' && stopResult.trim() ? stopResult : committed.trim() ? committed : partial;
  return pick.replace(/\s+/g, ' ').trim();
}
