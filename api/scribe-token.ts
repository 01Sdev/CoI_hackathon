// POST /api/scribe-token (Vercel 함수). 계약: docs/specs/02-SSRD.md IF-12, docs/designs/outfit-pipelines.md "파이프라인 2: 말로 묻기".
// 코디 스캔 실시간 받아쓰기용 ElevenLabs 일회용 토큰(realtime_scribe)을 만들어 { token }만 돌려준다.
// 말소리는 이 서버를 거치지 않는다: 브라우저가 이 토큰으로 ElevenLabs 실시간 받아쓰기 웹소켓에 바로 잇는다.
// ELEVENLABS_API_KEY는 서버 환경 변수에서만 읽고 응답·로그에 넣지 않는다. 키가 없거나 실패하면 503(화면은 브라우저 받아쓰기로).

/** 상류(ElevenLabs) 호출에 주는 시간. */
export const UPSTREAM_TIMEOUT_MS = 5_000;
/** 인스턴스 전역 고정 창. 질문 한 번에 토큰 하나를 쓴다. */
export const RATE_LIMIT = { count: 20, windowMs: 60_000 } as const;
export const DEFAULT_BASE_URL = 'https://api.elevenlabs.io';
/** ElevenLabs 토큰 종류(공식 문서 "Create single use token", 2026-11-01 확인). 15분 뒤 만료, 한 번 쓰면 끝. */
export const TOKEN_TYPE = 'realtime_scribe';
/** 화면에 보일 수 있는 오류 문구(키·상류 본문은 넣지 않는다). */
export const ERROR_TEXT = {
  unavailable: '음성 받아쓰기를 지금 쓸 수 없어요',
  auth: '음성 제공사 인증 오류',
  rate: '음성 제공사 요청 제한',
  invalid: '음성 제공사 요청 형식 오류',
  upstream: '음성 제공사 오류',
} as const;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

/** 503. 로그는 이유 한 줄만(토큰·키 없음). */
const unavailable = (reason: string, error: string = ERROR_TEXT.unavailable) => {
  console.error(`scribe-token 503 ${reason}`);
  return json(503, { error });
};

/**
 * 같은 출처 요청인지. 브라우저는 POST에 Origin을 붙인다. Origin의 host가 이 요청의 host와 같아야 하고,
 * Sec-Fetch-Site가 있으면 same-origin이어야 한다. CORS 헤더를 주지 않으므로 다른 사이트는 응답을 읽지도 못한다.
 */
export function isSameOrigin(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return false;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host;
  return originHost === host;
}

export interface ScribeTokenDeps {
  /** 시험용. 기본은 서버 환경 변수 ELEVENLABS_API_KEY. */
  apiKey?: string;
  /** 시험용. 기본 ELEVENLABS_BASE_URL 또는 공식 주소. */
  baseURL?: string;
  timeoutMs?: number;
  rateLimit?: { count: number; windowMs: number };
  now?: () => number;
  fetch?: typeof fetch;
}

/** 인스턴스 하나에 한도 창 하나. 시험은 createScribeTokenHandler로 따로 만든다. */
export function createScribeTokenHandler(deps: ScribeTokenDeps = {}) {
  const now = deps.now ?? (() => Date.now());
  const limit = deps.rateLimit ?? RATE_LIMIT;
  const doFetch = deps.fetch ?? fetch;
  let windowStart = -Infinity;
  let windowCount = 0;

  return async function handleScribeToken(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json(405, { error: 'method not allowed' }, { Allow: 'POST' });
    if (!isSameOrigin(request)) return json(403, { error: 'same origin only' });

    const t = now();
    if (t - windowStart >= limit.windowMs) {
      windowStart = t;
      windowCount = 0;
    }
    if (windowCount >= limit.count) return json(429, { error: 'too many requests' });
    windowCount += 1;

    const apiKey = deps.apiKey ?? process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return unavailable('no-key');
    const base = deps.baseURL ?? process.env.ELEVENLABS_BASE_URL ?? DEFAULT_BASE_URL;
    let res: Response;
    try {
      res = await doFetch(`${base}/v1/single-use-token/${TOKEN_TYPE}`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey },
        signal: AbortSignal.timeout(deps.timeoutMs ?? UPSTREAM_TIMEOUT_MS),
      });
    } catch (err) {
      const name = (err as Error)?.name ?? 'Error';
      return unavailable(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : `error=${name}`);
    }
    if (!res.ok) {
      const error =
        res.status === 401 || res.status === 403
          ? ERROR_TEXT.auth
          : res.status === 429
            ? ERROR_TEXT.rate
            : res.status === 422
              ? ERROR_TEXT.invalid
              : ERROR_TEXT.upstream;
      return unavailable(`upstream=${res.status}`, error);
    }
    let body: { token?: unknown } | null;
    try {
      body = (await res.json()) as { token?: unknown } | null;
    } catch {
      return unavailable('format=json');
    }
    const token = body?.token;
    // 토큰만 넘긴다. 이상한 값(빈 값·긴 값·공백·따옴표)은 받지 않는다.
    if (typeof token !== 'string' || !/^[A-Za-z0-9_.-]{1,512}$/.test(token)) return unavailable('format=no-token');
    return json(200, { token });
  };
}

const handler = createScribeTokenHandler();

// Vercel 웹 표준 함수 시그니처. 같은 origin(호스트 화면)에서만 부르므로 CORS를 열지 않는다.
export async function POST(req: Request): Promise<Response> {
  return handler(req);
}
