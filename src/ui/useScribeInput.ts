// 코디 스캔 말 막대의 실시간 받아쓰기: ElevenLabs Scribe(사용자 요청 2026-11-01). A의 startScribe()가 브라우저에서 ElevenLabs에
// 직접 연결한다(토큰은 B의 /api/scribe-token, 마이크·오디오 처리는 A). C는 글자만 받는다: 말하는 동안 onPartial 글자를 막대에 보이고,
// 착용자가 멈추면(탭·Enter·Space) stop()의 확정 글자를 질문으로 쓴다. 그다음 질문을 위해 바로 새로 듣는다.
// A의 scribe.ts는 preview.ts처럼 glob으로 불러서, 아직 없으면 이 경로를 쓰지 않는다(빌드는 그대로 된다).
// 시작 실패(토큰 없음 등)나 onError면 'error'가 되고, 부르는 쪽이 브라우저 음성 인식, 그것도 없으면 글 입력으로 넘긴다.

import { useCallback, useEffect, useRef, useState } from 'react';
import { joinScribe, scribeFinalText } from './scribe';

interface ScribeSession {
  stop(): Promise<string | void> | string | void;
}
interface ScribeHandlers {
  onPartial(text: string): void;
  onCommitted(text: string): void;
  onError(err: unknown): void;
}
type ScribeModule = { startScribe?: (h: ScribeHandlers) => ScribeSession | Promise<ScribeSession> };

const scribeModules = import.meta.glob<ScribeModule>('/src/input/scribe.ts');
const loadScribe = scribeModules['/src/input/scribe.ts'];

/** A의 실시간 받아쓰기 모듈이 이 빌드에 있는가. 없으면 처음부터 브라우저 음성 인식을 쓴다. */
export const scribeAvailable = loadScribe !== undefined;

export type ScribeState = 'off' | 'starting' | 'listening' | 'finishing' | 'error';

export function useScribeInput(enabled: boolean): {
  state: ScribeState;
  /** 확정 + 지금 말하는 중인 글자. */
  text: string;
  /** 멈추고 확정 글자를 돌려준다. 그다음 질문을 위해 다시 듣는다. 듣는 중이 아니면 ''. */
  finish(): Promise<string>;
} {
  const [state, setState] = useState<ScribeState>('off');
  const [text, setText] = useState('');
  const session = useRef<ScribeSession | null>(null);
  const committed = useRef('');
  const partial = useRef('');
  // 세션마다 하나씩 오른다. 멈춘 세션의 늦은 글자나 오류가 새 세션을 덮지 않게 한다.
  const gen = useRef(0);
  const want = useRef(enabled);
  want.current = enabled;

  const show = () => setText(joinScribe(committed.current, partial.current));

  const open = useCallback(async () => {
    if (!loadScribe) return;
    const my = ++gen.current;
    committed.current = partial.current = '';
    setText('');
    setState('starting');
    const fail = () => {
      if (gen.current !== my) return;
      gen.current++;
      const s = session.current;
      session.current = null;
      if (s) void Promise.resolve(s.stop()).catch(() => undefined);
      setState('error');
    };
    try {
      const m = await loadScribe();
      if (!m.startScribe) throw new Error('startScribe 없음');
      const s = await m.startScribe({
        onPartial: (t) => {
          if (gen.current !== my) return;
          partial.current = t;
          show();
        },
        onCommitted: (t) => {
          if (gen.current !== my) return;
          committed.current = joinScribe(committed.current, t);
          partial.current = '';
          show();
        },
        onError: fail,
      });
      if (gen.current !== my || !want.current) {
        void Promise.resolve(s.stop()).catch(() => undefined);
        return;
      }
      session.current = s;
      setState('listening');
    } catch {
      fail();
    }
  }, []);

  const close = useCallback(() => {
    gen.current++;
    const s = session.current;
    session.current = null;
    committed.current = partial.current = '';
    setText('');
    if (s) void Promise.resolve(s.stop()).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!enabled || !loadScribe) {
      close();
      setState((st) => (st === 'error' ? st : 'off'));
      return;
    }
    void open();
    return close;
  }, [enabled, open, close]);

  const finish = useCallback(async () => {
    const s = session.current;
    if (!s) return '';
    const my = gen.current;
    session.current = null;
    setState('finishing');
    let result: unknown;
    try {
      result = await s.stop();
    } catch {
      result = undefined;
    }
    const final = scribeFinalText(result, committed.current, partial.current);
    // 멈추는 사이에 오류가 나거나 화면이 꺼졌으면 다시 듣지 않는다.
    if (gen.current === my && want.current) void open();
    return final;
  }, [open]);

  return { state, text, finish };
}
