// 코디 스캔 말 막대의 받아쓰기: 녹음 → ElevenLabs(사용자 요청 2026-11-01). 말 막대를 누르면 A의 startMic()으로 녹음하고,
// 다시 누르거나(탭) 놓으면(꾹 누름) stop()으로 오디오 Blob을 받아 POST /api/stt(본문 = 오디오 그대로)로 보낸다. 응답 {text}가 질문이다.
// 마이크·getUserMedia는 A가 한다(C는 원본에 닿지 않는다). A의 mic.ts는 preview.ts처럼 glob으로 불러서, 아직 없으면 이 경로를 쓰지 않는다.
// 실패(마이크 거부, /api/stt 오류·503, 네트워크)면 부르는 쪽이 브라우저 음성 인식, 그것도 없으면 글 입력으로 넘긴다. 중간 결과(실시간 글자)는 없다.

import { useCallback, useEffect, useRef, useState } from 'react';
import { transcribe } from './stt';

interface MicRecording {
  stop(): Blob | Promise<Blob>;
}
type MicModule = { startMic?: () => MicRecording | Promise<MicRecording> };

const micModules = import.meta.glob<MicModule>('/src/input/mic.ts');
const loadMic = micModules['/src/input/mic.ts'];

/** A의 녹음 모듈이 이 빌드에 있는가. 없으면 처음부터 브라우저 음성 인식을 쓴다. */
export const recordedSttAvailable = loadMic !== undefined && typeof fetch === 'function';

export type RecordState = 'idle' | 'starting' | 'recording' | 'transcribing';

/**
 * 녹음 한 번 = 질문 한 번. toggle()은 쉬면 녹음을 시작하고, 녹음 중이면 끝내고 받아쓴다. enabled가 꺼지면 녹음을 버린다.
 * onText는 받아쓴 글자(빈 글자 포함), onFail은 이 경로를 더 쓸 수 없을 때(마이크 실패, /api/stt 실패) 부른다.
 */
export function useRecordedStt(enabled: boolean, onText: (text: string) => void, onFail: (reason: string) => void) {
  const [state, setState] = useState<RecordState>('idle');
  const stateRef = useRef<RecordState>('idle');
  const rec = useRef<MicRecording | null>(null);
  // 녹음을 시작하는 사이에 끝내라고 하면(꾹 눌렀다 바로 놓음) 시작이 끝나자마자 끝낸다.
  const stopAfterStart = useRef(false);
  const cbs = useRef({ onText, onFail });
  cbs.current = { onText, onFail };

  const set = (s: RecordState) => {
    stateRef.current = s;
    setState(s);
  };

  const stop = useCallback(async () => {
    if (stateRef.current === 'starting') {
      stopAfterStart.current = true;
      return;
    }
    const r = rec.current;
    if (stateRef.current !== 'recording' || !r) return;
    rec.current = null;
    set('transcribing');
    try {
      const text = await transcribe(await r.stop());
      set('idle');
      cbs.current.onText(text);
    } catch (e) {
      set('idle');
      cbs.current.onFail(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const start = useCallback(async () => {
    if (stateRef.current !== 'idle' || !loadMic) return;
    set('starting');
    stopAfterStart.current = false;
    try {
      const m = await loadMic();
      if (!m.startMic) throw new Error('startMic 없음');
      rec.current = await m.startMic();
      set('recording');
      if (stopAfterStart.current) void stop();
    } catch (e) {
      rec.current = null;
      set('idle');
      cbs.current.onFail(e instanceof Error ? e.message : String(e));
    }
  }, [stop]);

  const toggle = useCallback(() => {
    if (stateRef.current === 'idle') void start();
    else void stop();
  }, [start, stop]);

  // 동의가 끝나거나 화면이 사라지면 녹음을 버린다(보내지 않는다).
  useEffect(() => {
    if (enabled) return;
    const r = rec.current;
    rec.current = null;
    stopAfterStart.current = false;
    if (r) void Promise.resolve(r.stop()).catch(() => undefined);
    if (stateRef.current !== 'transcribing') set('idle');
  }, [enabled]);
  useEffect(
    () => () => {
      const r = rec.current;
      rec.current = null;
      if (r) void Promise.resolve(r.stop()).catch(() => undefined);
    },
    [],
  );

  return { state, start, stop, toggle };
}
