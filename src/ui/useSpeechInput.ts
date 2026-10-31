// 코디 스캔 말 막대의 받아쓰기(파이프라인 2, outfit-pipelines.md). 브라우저 SpeechRecognition(ko-KR, 중간 결과)을 enabled일 때만 켠다.
// Chrome의 음성 인식은 소리를 Google 서버로 보내 글자로 바꾼다(규약 보기에 적음). framelet 서버로는 소리를 보내지 않는다.
// 말이 끊기면 브라우저가 인식을 끝내므로 enabled인 동안 다시 켠다. 받아 적은 글자는 다시 켜도 이어 붙여 둔다(보낼 때 비움).
// 권한 거부·마이크 없음이면 멈추고 'error'로 남는다.
// 음성 인식이 없는 브라우저는 'unsupported'라 부르는 쪽이 입력창을 보인다.

import { useCallback, useEffect, useRef, useState } from 'react';

export type SpeechState = 'off' | 'starting' | 'listening' | 'error' | 'unsupported';

interface RecognitionResult {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}
interface RecognitionEvent {
  readonly results: { readonly length: number; readonly [i: number]: RecognitionResult };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** 인식 결과 목록 → 막대에 보일 글자(확정 + 중간). */
export function transcriptOf(results: RecognitionEvent['results']): string {
  let text = '';
  for (let i = 0; i < results.length; i++) text += results[i]?.[0].transcript ?? '';
  return text.replace(/\s+/g, ' ').trim();
}

export function joinSpeech(a: string, b: string): string {
  return [a, b].filter(Boolean).join(' ');
}

const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported']);
const ERROR_TEXT: Record<string, string> = {
  'not-allowed': '마이크 권한이 없어요 · 글자로 물어보세요',
  'service-not-allowed': '이 브라우저에서 음성 인식을 쓸 수 없어요 · 글자로 물어보세요',
  'audio-capture': '마이크를 찾지 못했어요 · 글자로 물어보세요',
  'language-not-supported': '한국어 음성 인식을 쓸 수 없어요 · 글자로 물어보세요',
};

export function useSpeechInput(enabled: boolean): {
  state: SpeechState;
  text: string;
  error: string;
  /** 보낸 뒤 받아 적은 글자를 비우고 새로 듣는다. */
  clear(): void;
} {
  const supported = recognitionCtor() !== null;
  const [state, setState] = useState<SpeechState>(supported ? 'off' : 'unsupported');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const rec = useRef<Recognition | null>(null);
  // 앞서 끝난 인식에서 받아 적은 글자와 지금 인식의 글자. 다시 켜도 이어 붙인다.
  const carry = useRef('');
  const current = useRef('');

  useEffect(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return setState('unsupported');
    if (!enabled) {
      setState((s) => (s === 'error' ? s : 'off'));
      carry.current = current.current = '';
      setText('');
      return;
    }
    let live = true;
    let restart = 0;
    const r = new Ctor();
    r.lang = 'ko-KR';
    r.continuous = true;
    r.interimResults = true;
    r.onstart = () => live && setState('listening');
    r.onresult = (e) => {
      if (!live) return;
      current.current = transcriptOf(e.results);
      setText(joinSpeech(carry.current, current.current));
    };
    r.onerror = (e) => {
      if (!live || !FATAL.has(e.error)) return;
      live = false;
      setError(ERROR_TEXT[e.error] ?? '음성 인식이 멈췄어요 · 글자로 물어보세요');
      setState('error');
    };
    r.onend = () => {
      if (!live) return;
      // 말이 끊겨 끝난 것. 다음 인식은 결과 목록이 비어 시작하니 지금까지 글자를 carry로 넘긴다.
      carry.current = joinSpeech(carry.current, current.current);
      current.current = '';
      restart = window.setTimeout(() => {
        try {
          if (live) r.start();
        } catch {
          /* 이미 켜져 있음 */
        }
      }, 250);
    };
    rec.current = r;
    setState('starting');
    setError('');
    try {
      r.start();
    } catch {
      /* 이미 켜져 있음 */
    }
    return () => {
      live = false;
      window.clearTimeout(restart);
      rec.current = null;
      r.onend = null;
      try {
        r.abort();
      } catch {
        /* 꺼져 있음 */
      }
    };
  }, [enabled]);

  const clear = useCallback(() => {
    carry.current = current.current = '';
    setText('');
    // abort → onend → 다시 켬. 새 결과 목록이라 보낸 질문이 다음 막대에 남지 않는다.
    try {
      rec.current?.abort();
    } catch {
      /* 꺼져 있음 */
    }
  }, []);

  return { state, text, error, clear };
}
