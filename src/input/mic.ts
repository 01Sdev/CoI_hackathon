// 마이크 녹음(코디 스캔 받아쓰기 → /api/stt, 트랙 B의 ElevenLabs). getUserMedia는 A 디렉터리에서만 쓴다(02-SSRD §1).
// C가 startMic()으로 녹음을 시작하고 stop()으로 받은 Blob을 /api/stt에 POST한다. A는 오디오를 저장하거나 보내지 않는다.
// 녹음이 끝나면(정지·취소·MIC_MAX_MS 자동 정지·오류) 마이크 트랙을 바로 멈추고 모아 둔 조각 배열을 비운다.
// 스토어에는 녹음 중 여부와 시작 시각(불값·숫자)만 알린다. core에 setMic이 있으면 그것으로, 없으면 subscribeMic으로 본다.

import { lensStore } from '../core/store';
import { MIC_MAX_MS, MIC_MIME_TYPES } from './config';

export interface MicState {
  recording: boolean;
  /** 녹음을 시작한 시각(performance.now). 녹음 중이 아니면 null. */
  startedAt: number | null;
  /** 자동 정지까지의 상한(ms). */
  maxMs: number;
}

export interface MicRecording {
  /** 실제 녹음 형식(MediaRecorder.mimeType). */
  readonly mimeType: string;
  /** 녹음을 끝내고 Blob을 받는다. 이미 자동 정지됐으면 그 Blob. 취소·오류였으면 reject. */
  stop(): Promise<Blob>;
  /** 녹음을 버린다. 트랙을 바로 멈추고 Blob은 만들지 않는다. */
  cancel(): void;
  /** 녹음이 끝나면 풀린다. 정지·자동 정지는 Blob, 취소·오류는 null. */
  readonly ended: Promise<Blob | null>;
}

/** 브라우저 객체 대신 넣을 수 있는 최소 모양(scripts/check-runtime.ts가 가짜로 시험한다). */
export interface RecorderLike {
  readonly state: string;
  readonly mimeType: string;
  start(timeslice?: number): void;
  stop(): void;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
}

export interface StreamLike {
  getTracks(): { stop(): void }[];
}

export interface MicDeps {
  getUserMedia(c: MediaStreamConstraints): Promise<StreamLike>;
  createRecorder(stream: StreamLike, mimeType: string | undefined): RecorderLike;
  isTypeSupported(type: string): boolean;
  /** WebKit(Safari, iOS의 모든 브라우저)이면 audio/mp4를 먼저 본다. */
  webkit: boolean;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  onState(s: MicState): void;
}

/** isTypeSupported로 녹음 형식을 고른다. 고를 것이 없으면 undefined(브라우저 기본). */
export function pickMimeType(isTypeSupported: (t: string) => boolean, webkit: boolean): string | undefined {
  for (const t of webkit ? MIC_MIME_TYPES.webkit : MIC_MIME_TYPES.other) if (isTypeSupported(t)) return t;
  return undefined;
}

const IDLE: MicState = { recording: false, startedAt: null, maxMs: MIC_MAX_MS };

/** 녹음기 하나. 한 번에 녹음 하나만 한다(녹음 중에 startMic을 다시 부르면 같은 녹음을 돌려준다). */
export function createMic(deps: MicDeps) {
  let state: MicState = IDLE;
  let current: MicRecording | null = null;
  let pending: Promise<MicRecording> | null = null;
  /** 시작하는 중(권한 창 등)에 cancelMic이 오면 켜진다. */
  let cancelPending = false;

  const set = (s: MicState) => {
    state = s;
    deps.onState(s);
  };
  const stopTracks = (stream: StreamLike) => {
    for (const t of stream.getTracks()) t.stop();
  };

  async function begin(): Promise<MicRecording> {
    const stream = await deps.getUserMedia({ audio: true, video: false });
    if (cancelPending) {
      stopTracks(stream);
      throw new Error('녹음 시작 전에 취소됨');
    }
    const mime = pickMimeType((t) => deps.isTypeSupported(t), deps.webkit);
    let rec: RecorderLike;
    try {
      rec = deps.createRecorder(stream, mime);
    } catch (e) {
      stopTracks(stream);
      throw e;
    }

    let chunks: Blob[] = [];
    let settled = false;
    let cancelled = false;
    let timer: unknown = null;
    let resolveEnded: (b: Blob | null) => void = () => undefined;
    const ended = new Promise<Blob | null>((r) => (resolveEnded = r));
    const finish = (blob: Blob | null) => {
      if (settled) return;
      settled = true;
      if (timer !== null) deps.clearTimer(timer);
      stopTracks(stream);
      chunks = [];
      current = null;
      set(IDLE);
      resolveEnded(blob);
    };

    rec.ondataavailable = (e) => {
      if (!cancelled && !settled && e.data && e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => finish(cancelled ? null : new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' }));
    rec.onerror = (e) => {
      console.warn('[input] 녹음 오류', e);
      finish(null);
    };
    try {
      rec.start(1000);
    } catch (e) {
      stopTracks(stream);
      throw e;
    }
    set({ recording: true, startedAt: deps.now(), maxMs: MIC_MAX_MS });
    // 상한이 지나면 스스로 멈춘다. Blob은 ended와 stop()으로 받는다.
    timer = deps.setTimer(() => {
      if (rec.state !== 'inactive') rec.stop();
    }, MIC_MAX_MS);

    const handle: MicRecording = {
      mimeType: rec.mimeType || mime || '',
      ended,
      stop() {
        if (!settled && rec.state !== 'inactive') rec.stop();
        return ended.then((b) => b ?? Promise.reject(new Error('녹음이 취소되었거나 실패했습니다')));
      },
      cancel() {
        if (settled) return;
        cancelled = true;
        try {
          if (rec.state !== 'inactive') rec.stop();
        } catch {
          // 이미 멈췄으면 무시한다. 트랙은 아래에서 멈춘다.
        }
        finish(null);
      },
    };
    current = handle;
    return handle;
  }

  /** 녹음을 시작한다. 마이크 권한을 묻는 것도 여기서다. 거부·미지원이면 reject하고 상태는 그대로 쉰다. */
  function startMic(): Promise<MicRecording> {
    if (current) return Promise.resolve(current);
    if (pending) return pending;
    cancelPending = false;
    pending = begin().finally(() => {
      pending = null;
    });
    return pending;
  }

  /** 지금 녹음(또는 시작 중인 녹음)을 버린다. 화면을 떠날 때 부른다. */
  function cancelMic(): void {
    if (current) current.cancel();
    else if (pending) cancelPending = true;
  }

  return { startMic, cancelMic, getMicState: () => state };
}

const listeners = new Set<(s: MicState) => void>();
let lastState: MicState = IDLE;

function reportMic(s: MicState) {
  lastState = s;
  for (const fn of listeners) fn(s);
  // C·허브가 core에 넣을 녹음 상태(불값·숫자만). 아직 없으면 부르지 않는다.
  const store = lensStore.getState() as unknown as { setMic?: (p: MicState) => void };
  store.setMic?.(s);
}

/** 녹음 상태가 바뀔 때마다 부른다. 등록할 때 지금 상태로 한 번 부른다. */
export function subscribeMic(fn: (s: MicState) => void): () => void {
  listeners.add(fn);
  fn(lastState);
  return () => listeners.delete(fn);
}

let browserMic: ReturnType<typeof createMic> | null = null;

function mic() {
  if (browserMic) return browserMic;
  browserMic = createMic({
    getUserMedia: (c) =>
      navigator.mediaDevices?.getUserMedia
        ? navigator.mediaDevices.getUserMedia(c)
        : Promise.reject(new Error('getUserMedia 없음(HTTPS가 아니거나 지원하지 않는 브라우저)')),
    createRecorder: (stream, mimeType) => {
      if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder 없음');
      return new MediaRecorder(stream as MediaStream, mimeType ? { mimeType } : undefined) as unknown as RecorderLike;
    },
    isTypeSupported: (t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t),
    webkit: /Apple/.test(navigator.vendor ?? ''),
    now: () => performance.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    onState: reportMic,
  });
  return browserMic;
}

/** 코디 스캔 받아쓰기 녹음을 시작한다. 돌려받은 stop()의 Blob을 호출자가 /api/stt로 보낸다. */
export function startMic(): Promise<MicRecording> {
  return mic().startMic();
}

/** 지금 녹음을 버린다(트랙 즉시 정지). */
export function cancelMic(): void {
  mic().cancelMic();
}

export function getMicState(): MicState {
  return lastState;
}
