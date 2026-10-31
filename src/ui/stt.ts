// /api/stt 받아쓰기 요청(순수 함수라 scripts/check-ui.ts가 확인한다). 녹음과 화면 상태는 useRecordedStt.ts.

/** 받아쓰기 서비스 고지(말 막대 위 한 줄). 규약 보기 SPEECH_NOTE와 같은 뜻이다. */
export const STT_NOTICE = '말소리는 받아쓰기 서비스(ElevenLabs)로 보내요';

export const STT_URL = '/api/stt';

/** /api/stt가 받아쓰기를 못 했다(503 = 키 없음·서비스 꺼짐 포함). 부르는 쪽은 다음 방법으로 넘긴다. */
export class SttUnavailable extends Error {
  constructor(readonly status: number | null) {
    super(status === null ? '받아쓰기 서버에 닿지 못함' : `받아쓰기 서버 응답 ${status}`);
  }
}

/** 오디오 Blob을 /api/stt에 그대로 보내고 받아쓴 글자를 돌려준다. 빈 글자면 ''. 응답이 ok가 아니면 SttUnavailable. */
export async function transcribe(blob: Blob, fetchFn: typeof fetch = fetch): Promise<string> {
  let res: Response;
  try {
    res = await fetchFn(STT_URL, {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
    });
  } catch {
    throw new SttUnavailable(null);
  }
  if (!res.ok) throw new SttUnavailable(res.status);
  const body: unknown = await res.json().catch(() => null);
  const text = body && typeof body === 'object' && typeof (body as { text?: unknown }).text === 'string' ? (body as { text: string }).text : '';
  return text.replace(/\s+/g, ' ').trim();
}
