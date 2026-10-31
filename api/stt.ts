// POST /api/stt (Vercel 함수). 계약: docs/specs/02-SSRD.md IF-12, docs/designs/outfit-pipelines.md "파이프라인 2: 말로 묻기".
// 코디 스캔 받아쓰기: 착용자가 말한 소리(녹음 Blob 그대로)를 ElevenLabs Speech-to-Text에 보내 글자만 돌려준다.
// 오디오와 받아쓴 글자는 저장하지 않고 로그에도 남기지 않는다. ELEVENLABS_API_KEY는 서버 환경 변수에서만 읽는다.
// 키가 없거나 실패하면 503: 화면(C)이 브라우저 받아쓰기로 넘어간다.

import { OUTFIT_QUESTION_MAX } from '../src/core/constants.js';

/** 녹음 상한 2MiB(Content-Length와 실제로 읽은 바이트 둘 다). 15초 상한은 녹음하는 쪽(A)이 지킨다. */
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
/** 녹음 길이 상한(A의 녹음 제한). 서버는 컨테이너를 풀지 않으므로 크기로만 막는다. */
export const MAX_AUDIO_SECS = 15;
/** 상류(ElevenLabs) 호출에 주는 시간. vercel.json maxDuration(30초) 안. */
export const UPSTREAM_TIMEOUT_MS = 10_000;
/** 인스턴스 전역 고정 창. 실제 상한은 ElevenLabs 쪽 사용량 한도로 건다. */
export const RATE_LIMIT = { count: 30, windowMs: 60_000 } as const;
/** ElevenLabs 모델 문서(2026-11-01 확인): 일반 받아쓰기 최신판. scribe_v1은 지원 중단 예정. STT_MODEL로 바꿀 수 있다. */
export const DEFAULT_MODEL = 'scribe_v2';
export const DEFAULT_BASE_URL = 'https://api.elevenlabs.io';
/** ISO-639-1. 자동 감지를 끄고 한국어로 고정한다. */
export const LANGUAGE_CODE = 'ko';

/** 받는 녹음 형식. MediaRecorder 기본값: Chrome·Android는 webm(Opus), 사파리는 mp4(AAC). */
const TYPES: Record<string, { ext: string; magic: (b: Uint8Array) => boolean }> = {
  // EBML 머리 1A 45 DF A3.
  'audio/webm': { ext: 'webm', magic: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  // ISO BMFF: 4~7바이트가 'ftyp'.
  'audio/mp4': { ext: 'mp4', magic: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 },
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

/** 키 없음·상류 실패·시간 초과·응답 형식 오류. 화면이 브라우저 받아쓰기로 넘어가는 신호다. 로그는 이유 한 줄만. */
const unavailable = (reason: string) => {
  console.error(`stt 503 ${reason}`);
  return json(503, { error: 'stt unavailable' });
};

export interface SttDeps {
  /** 시험용. 기본은 서버 환경 변수 ELEVENLABS_API_KEY. */
  apiKey?: string;
  /** 시험용. 기본 ELEVENLABS_BASE_URL 또는 공식 주소. */
  baseURL?: string;
  model?: string;
  /** true면 enable_logging=false(ElevenLabs 무보관 모드, 엔터프라이즈 전용). 기본 ELEVENLABS_ZERO_RETENTION === '1'. */
  zeroRetention?: boolean;
  timeoutMs?: number;
  rateLimit?: { count: number; windowMs: number };
  now?: () => number;
  fetch?: typeof fetch;
}

/** 인스턴스 하나에 한도 창 하나. 시험은 createSttHandler로 따로 만든다. */
export function createSttHandler(deps: SttDeps = {}) {
  const now = deps.now ?? (() => Date.now());
  const limit = deps.rateLimit ?? RATE_LIMIT;
  const doFetch = deps.fetch ?? fetch;
  let windowStart = -Infinity;
  let windowCount = 0;

  return async function handleStt(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json(405, { error: 'method not allowed' }, { Allow: 'POST' });

    const t = now();
    if (t - windowStart >= limit.windowMs) {
      windowStart = t;
      windowCount = 0;
    }
    if (windowCount >= limit.count) return json(429, { error: 'too many requests' });
    windowCount += 1;

    const declared = Number(request.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES) return json(413, { error: 'audio too large' });
    const type = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    const kind = Object.prototype.hasOwnProperty.call(TYPES, type) ? TYPES[type] : undefined;
    if (!kind) return json(415, { error: 'audio/webm or audio/mp4 only' });
    const audio = new Uint8Array(await request.arrayBuffer());
    if (audio.byteLength > MAX_AUDIO_BYTES) return json(413, { error: 'audio too large' });
    if (audio.byteLength === 0) return json(400, { error: 'empty audio' });
    if (audio.byteLength < 8 || !kind.magic(audio)) return json(415, { error: `not ${type}` });

    const apiKey = deps.apiKey ?? process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return unavailable('no-key');
    const base = deps.baseURL ?? process.env.ELEVENLABS_BASE_URL ?? DEFAULT_BASE_URL;
    const zero = deps.zeroRetention ?? process.env.ELEVENLABS_ZERO_RETENTION === '1';
    const form = new FormData();
    form.append('model_id', deps.model ?? process.env.STT_MODEL ?? DEFAULT_MODEL);
    form.append('language_code', LANGUAGE_CODE);
    form.append('tag_audio_events', 'false');
    form.append('diarize', 'false');
    form.append('file', new Blob([audio], { type }), `speech.${kind.ext}`);

    let res: Response;
    try {
      res = await doFetch(`${base}/v1/speech-to-text${zero ? '?enable_logging=false' : ''}`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey },
        body: form,
        signal: AbortSignal.timeout(deps.timeoutMs ?? UPSTREAM_TIMEOUT_MS),
      });
    } catch (err) {
      const name = (err as Error)?.name ?? 'Error';
      return unavailable(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : `error=${name}`);
    }
    if (!res.ok) return unavailable(`upstream=${res.status}`);
    let body: { text?: unknown } | null;
    try {
      body = (await res.json()) as { text?: unknown } | null;
    } catch {
      return unavailable('format=json');
    }
    if (typeof body?.text !== 'string') return unavailable('format=no-text');
    // 글자만 돌려준다(단어 시각·언어 확률은 버린다). 조용하면 빈 글자.
    return json(200, { text: body.text.replace(/\s+/g, ' ').trim().slice(0, OUTFIT_QUESTION_MAX) });
  };
}

const handler = createSttHandler();

// Vercel 웹 표준 함수 시그니처. 같은 origin(호스트 화면)에서만 부르므로 CORS를 열지 않는다.
export async function POST(req: Request): Promise<Response> {
  return handler(req);
}
