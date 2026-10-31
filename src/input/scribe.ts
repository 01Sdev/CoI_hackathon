// 코디 스캔 실시간 받아쓰기(ElevenLabs Scribe v2 Realtime). 마이크 → AudioWorklet(public/pcm-worklet.js, 16kHz Int16 PCM)
// → 브라우저가 바로 wss://api.elevenlabs.io/v1/speech-to-text/realtime?token=<일회용 토큰>에 보낸다. 토큰은 /api/scribe-token(트랙 B).
// getUserMedia는 A 디렉터리에서만 쓴다(02-SSRD §1). 오디오는 저장하지 않고, 끝나면(정지·취소·30초·오류) 마이크 트랙·AudioContext·
// 소켓을 바로 닫는다. 메시지 처리와 파라미터는 사용자의 SAI 프로젝트(apps/sai/src/server/eleven.ts·web/components/microphone.ts)에서
// 실제로 돌던 것을 옮겼다. SAI는 서버가 중계했지만 Vercel 함수는 웹소켓을 붙들 수 없어 브라우저가 토큰으로 바로 연결한다.

import { lensStore } from '../core/store';
import { SCRIBE } from './config';

export interface ScribeHandlers {
  /** 지금 말하는 중인 글자(통째로 갈아 끼운다). 확정되면 ''. */
  onPartial(text: string): void;
  /** 확정된 한 덩어리(호출자가 이어 붙인다). */
  onCommitted(text: string): void;
  /** 토큰·마이크·연결·제공사 오류. 한 받아쓰기에 한 번만 부른다. 그 뒤 받아쓰기는 이미 닫혀 있다. */
  onError(err: ScribeError): void;
}

export interface ScribeSession {
  /** 남은 오디오를 보내고 마지막을 확정한 뒤(확정 응답 또는 1.5초) 닫는다. 확정 글자 전체(공백으로 이음)를 돌려준다. */
  stop(): Promise<string>;
  /** 바로 닫는다. 콜백은 더 부르지 않는다. */
  cancel(): void;
}

export class ScribeError extends Error {
  constructor(
    /** token | microphone | connection | provider:<message_type> | timeout */
    readonly kind: string,
    message: string,
  ) {
    super(message);
    this.name = 'ScribeError';
  }
}

/** 마이크 → 워크릿 연결. 브라우저 밖 시험에서는 가짜로 바꾼다. */
export interface MicPipe {
  /** 16kHz Int16 PCM 조각. */
  onChunk: ((pcm: ArrayBuffer) => void) | null;
  /** 워크릿에 남은 조각을 내보내게 하고, 다 내보내면(또는 flushWaitMs) 풀린다. */
  flush(): Promise<void>;
  /** 트랙을 멈추고 AudioContext를 닫는다. 여러 번 불러도 된다. */
  close(): void;
}

export interface SocketLike {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string): void;
  close(): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onclose: ((e: unknown) => void) | null;
}

export interface ScribeDeps {
  fetchToken(): Promise<string>;
  openMic(): Promise<MicPipe>;
  connect(url: string): SocketLike;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  onRecording(on: boolean): void;
}

const OPEN = 1;

/** 연결 주소. 토큰은 쿼리 token(공식 문서: 클라이언트 쪽 받아쓰기는 일회용 토큰). */
export function scribeUrl(token: string): string {
  return `${SCRIBE.url}?${new URLSearchParams({ ...SCRIBE.params, token })}`;
}

/** Int16 PCM 바이트 → base64. */
export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const chunkMessage = (pcm: ArrayBuffer, commit: boolean) =>
  JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: toBase64(pcm), commit, sample_rate: SCRIBE.sampleRate });

/** 받아쓰기 하나를 연다. 거부하지 않는다: 실패는 모두 onError로 오고, 돌려받은 stop()은 그때까지 확정된 글자를 준다. */
export async function runScribe(h: ScribeHandlers, deps: ScribeDeps): Promise<ScribeSession> {
  const committed: string[] = [];
  let closed = false;
  let failed = false;
  let mic: MicPipe | null = null;
  let socket: SocketLike | null = null;
  let ready = false;
  let bytesSent = 0;
  const pending: ArrayBuffer[] = [];
  let pendingBytes = 0;
  let capTimer: unknown = null;
  let finalTimer: unknown = null;
  let stopping: Promise<string> | null = null;
  let awaitingFinal = false;
  let resolveFinal: () => void = () => undefined;

  const text = () => committed.join(' ');
  const dispose = () => {
    if (closed) return;
    closed = true;
    if (capTimer !== null) deps.clearTimer(capTimer);
    if (finalTimer !== null) deps.clearTimer(finalTimer);
    mic?.close();
    if (mic) mic.onChunk = null;
    if (socket) {
      socket.onmessage = socket.onerror = socket.onclose = null;
      try {
        socket.close();
      } catch {
        // 이미 닫혔으면 무시한다.
      }
    }
    pending.length = 0;
    deps.onRecording(false);
    resolveFinal();
  };
  const fail = (err: ScribeError) => {
    if (closed || failed) return;
    failed = true;
    dispose();
    // 착용자가 이미 끝낸 뒤(마지막 확정을 기다리는 중)의 오류는 대체 받아쓰기로 넘어갈 일이 아니라 조용히 닫는다.
    if (!awaitingFinal) h.onError(err);
  };
  const send = (data: string) => {
    if (!socket || socket.readyState !== OPEN) return false;
    if (socket.bufferedAmount > SCRIBE.maxBufferedBytes) {
      fail(new ScribeError('connection', '받아쓰기 전송 지연'));
      return false;
    }
    socket.send(data);
    return true;
  };
  const sendAudio = (pcm: ArrayBuffer) => {
    if (send(chunkMessage(pcm, false))) bytesSent += pcm.byteLength;
  };

  const session: ScribeSession = {
    stop() {
      if (stopping) return stopping;
      stopping = (async () => {
        if (closed) return text();
        if (capTimer !== null) deps.clearTimer(capTimer);
        // ① 워크릿에 남은 오디오를 내보내게 하고 받는다. ② 마이크를 바로 멈춘다.
        if (mic) await mic.flush();
        mic?.close();
        if (closed) return text();
        // 연결 전이면 확정할 것이 없다.
        if (!ready || !socket || socket.readyState !== OPEN) {
          dispose();
          return text();
        }
        // ③ 수동 commit. 보낸 오디오가 짧으면 무음으로 채운다(SAI와 같이 2.1초).
        awaitingFinal = true;
        const done = new Promise<void>((r) => (resolveFinal = r));
        finalTimer = deps.setTimer(() => resolveFinal(), SCRIBE.finalWaitMs);
        if (!send(chunkMessage(new ArrayBuffer(Math.max(0, SCRIBE.minCommitBytes - bytesSent)), true))) {
          dispose();
          return text();
        }
        // ④ 확정 응답이나 1.5초.
        await done;
        dispose();
        return text();
      })();
      return stopping;
    },
    cancel() {
      dispose();
    },
  };

  let token: string;
  try {
    token = await deps.fetchToken();
  } catch (e) {
    fail(new ScribeError('token', `받아쓰기 토큰을 받지 못함: ${e instanceof Error ? e.message : String(e)}`));
    return session;
  }
  if (closed) return session;
  try {
    mic = await deps.openMic();
  } catch (e) {
    fail(new ScribeError('microphone', `마이크를 열지 못함: ${e instanceof Error ? e.name || e.message : String(e)}`));
    return session;
  }
  if (closed) {
    mic.close();
    return session;
  }
  deps.onRecording(true);

  // session_started 전 오디오는 쌓아 두었다가 시작되면 보낸다.
  mic.onChunk = (pcm) => {
    if (closed) return;
    if (ready) {
      sendAudio(pcm);
      return;
    }
    pending.push(pcm);
    pendingBytes += pcm.byteLength;
    if (pendingBytes > SCRIBE.preStartBytes) fail(new ScribeError('timeout', '받아쓰기 연결이 늦어 멈춤'));
  };

  try {
    socket = deps.connect(scribeUrl(token));
  } catch (e) {
    fail(new ScribeError('connection', `받아쓰기 연결 실패: ${e instanceof Error ? e.message : String(e)}`));
    return session;
  }
  socket.onmessage = (e) => {
    if (closed) return;
    let m: { message_type?: string; text?: string; error?: string };
    try {
      m = JSON.parse(String(e.data));
    } catch {
      fail(new ScribeError('provider:format', '받아쓰기 응답 형식 오류'));
      return;
    }
    const type = m.message_type ?? '';
    if (type === 'session_started') {
      ready = true;
      for (const pcm of pending.splice(0)) sendAudio(pcm);
      pendingBytes = 0;
    } else if (type === 'partial_transcript') {
      h.onPartial(m.text ?? '');
    } else if (type === 'committed_transcript') {
      const t = (m.text ?? '').trim();
      h.onPartial('');
      if (t) {
        committed.push(t);
        h.onCommitted(t);
      }
      if (awaitingFinal) resolveFinal();
    } else if (type === 'warning' || type.startsWith('committed_transcript_')) {
      // 보관 정책 안내 등은 받아쓰기를 멈추지 않는다.
    } else if (type.includes('error') || m.error || PROVIDER_ERRORS.has(type)) {
      fail(new ScribeError(`provider:${type || 'error'}`, `받아쓰기 제공사 오류(${type || m.error})`));
    }
  };
  socket.onerror = () => fail(new ScribeError('connection', '받아쓰기 연결 오류'));
  socket.onclose = () => {
    if (awaitingFinal) {
      dispose();
      return;
    }
    fail(new ScribeError('connection', '받아쓰기 연결이 끊김'));
  };
  capTimer = deps.setTimer(() => void session.stop(), SCRIBE.maxMs);
  return session;
}

/** 공식 문서의 서버 → 클라이언트 오류 종류. */
const PROVIDER_ERRORS = new Set([
  'error',
  'auth_error',
  'quota_exceeded',
  'commit_throttled',
  'unaccepted_terms',
  'rate_limited',
  'queue_overflow',
  'resource_exhausted',
  'session_time_limit_exceeded',
  'input_error',
  'invalid_request',
  'chunk_size_exceeded',
  'insufficient_audio_activity',
  'transcriber_error',
]);

// ── 브라우저 연결 ──

async function fetchToken(): Promise<string> {
  const res = await fetch(SCRIBE.tokenPath, { method: 'POST', cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { token?: unknown };
  if (typeof body.token !== 'string' || !body.token) throw new Error('토큰 없음');
  return body.token;
}

async function openMic(): Promise<MicPipe> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia 없음(HTTPS가 아니거나 지원하지 않는 브라우저)');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    video: false,
  });
  let ctx: AudioContext | null = null;
  const stopAll = () => {
    for (const t of stream.getTracks()) t.stop();
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined);
  };
  try {
    // 16kHz를 못 여는 브라우저는 기본 표본율로 연다(워크릿이 16kHz로 줄인다).
    try {
      ctx = new AudioContext({ sampleRate: SCRIBE.sampleRate });
    } catch {
      ctx = new AudioContext();
    }
    await ctx.audioWorklet.addModule('/pcm-worklet.js');
    const source = ctx.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(ctx, 'pcm-recorder');
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(worklet);
    worklet.connect(mute);
    mute.connect(ctx.destination);
    let flushed: (() => void) | null = null;
    const pipe: MicPipe = {
      onChunk: null,
      flush: () =>
        new Promise<void>((resolve) => {
          const t = setTimeout(resolve, SCRIBE.flushWaitMs);
          flushed = () => {
            clearTimeout(t);
            resolve();
          };
          worklet.port.postMessage({ type: 'flush' });
        }),
      close: stopAll,
    };
    worklet.port.onmessage = (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type === 'flushed') {
        flushed?.();
        return;
      }
      if (e.data instanceof ArrayBuffer) pipe.onChunk?.(e.data);
    };
    await ctx.resume();
    return pipe;
  } catch (e) {
    stopAll();
    throw e;
  }
}

const recordingListeners = new Set<(on: boolean) => void>();
let recording = false;

function reportRecording(on: boolean) {
  if (recording === on) return;
  recording = on;
  for (const fn of recordingListeners) fn(on);
  // core에 녹음 중 불값이 생기면 쓴다(이름 제안: session.micRecording·setMicRecording). 없으면 subscribeScribe로 본다.
  const store = lensStore.getState() as unknown as { setMicRecording?: (on: boolean) => void };
  store.setMicRecording?.(on);
}

/** 녹음 중 여부가 바뀔 때마다 부른다. 등록할 때 지금 값으로 한 번 부른다. */
export function subscribeScribe(fn: (on: boolean) => void): () => void {
  recordingListeners.add(fn);
  fn(recording);
  return () => recordingListeners.delete(fn);
}

let current: ScribeSession | null = null;

/**
 * 코디 스캔 실시간 받아쓰기를 시작한다(C가 부른다). 한 번에 하나: 이미 받아쓰는 중이면 이전 것을 버리고 새로 연다.
 * 거부하지 않는다. 토큰·마이크·연결 실패는 onError로 오고, C는 그때 브라우저 내장 받아쓰기로 넘어간다.
 */
export async function startScribe(h: ScribeHandlers): Promise<ScribeSession> {
  current?.cancel();
  const s = await runScribe(h, {
    fetchToken,
    openMic,
    connect: (url) => new WebSocket(url) as unknown as SocketLike,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    onRecording: reportRecording,
  });
  current = s;
  return s;
}
