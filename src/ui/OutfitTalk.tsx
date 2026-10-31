// 코디 스캔 말 막대와 질문·답 패널(파이프라인 2, docs/designs/outfit-pipelines.md).
// 휴대폰 웹은 스마트 글래스 시야를 휴대폰 브라우저로 흉내 내는 화면이라(사용자 2026-11-01), #42의 폰 모양 창 대신
// 글래스 화면에 뜨는 HUD 패널로 그린다. 말풍선 모양은 #42(outfit-assistant.css), 겉 글로우·테두리는 사용자가 준 zip 값이다.
// 막대: 동의가 살아 있고 코디 스캔이 켜져 있으면 시야 아래에 뜬다. 받아쓰기는 세 단계로 넘어간다(사용자 요청 2026-11-01).
//   1) 실시간 받아쓰기 ElevenLabs Scribe(useScribeInput, A의 startScribe): 말하는 동안 글자가 막대에 실시간으로 보이고,
//      막대를 탭하거나 Enter·Space(글래스 버튼 대용)로 멈추면 확정 글자로 묻는다. 막대 위에 받아쓰기 서비스 고지를 둔다.
//   2) 그게 실패(토큰 없음·연결 오류)하거나 A의 모듈이 없으면 브라우저 음성 인식(useSpeechInput). 보이는 모양과 조작은 같다.
//   3) 그것도 없으면 입력창. 묻기는 모두 askPlugin(코디 스캔 id, 질문).
// 패널: 시야 오른쪽 가장자리. outfitTurns의 질문과 답(묻는 중, 실패 사유, 대체 답변)을 보인다. 답은 플러그인 문자열이라
//   sanitizeAnswerText를 거쳐 텍스트 노드로만 넣는다. 새 질문이 생기면 열리고, ×로 닫으면 다음 질문까지 닫혀 있다.
//   패널도 막대처럼 코디 스캔이 켜진 앱에서만 보인다(outfitPanelOpen). 앱을 다시 열면 지난 대화는 닫힌 채로 시작한다(closedOnEnter).
//   동의가 끝나면 막대만 사라지고 패널은 남는다. 패널은 흰 틀의 사람 수를 덮지 않게 그 위나 아래에 둔다(talkPanelPlacement).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { selectConsentCount } from '../core/selectors';
import { useLensStore } from '../core/store';
import type { OutfitTurn } from '../core/types';
import { sourceToView, talkPanelPlacement, type Size } from './geometry';
import { isGlassButtonKey } from './glassKeys';
import { closedOnEnter, outfitPanelOpen } from './outfitView';
import { fitSelection, selectionLimits } from './selection-frame';
import { sanitizeAnswerText } from './sanitize';
import { STT_NOTICE } from './scribe';
import { scribeAvailable, useScribeInput } from './useScribeInput';
import { useSpeechInput } from './useSpeechInput';
import './outfit-assistant.css';
import './outfit-talk.css';

/** 질문 최대 글자(#42 입력창과 같음). */
const QUESTION_MAX = 300;
/** 막대에 보이는 받아쓰기 글자 수. 길면 앞을 줄이고 최근 말을 보인다. */
const BAR_TAIL = 48;

type SttEngine = 'scribe' | 'browser' | 'type';

export function OutfitTalk({ size }: { size: Size }) {
  const v = useLensStore(
    useShallow((s) => {
      const id = s.pluginOrder.find((x) => s.plugins[x]?.kind === 'outfit') ?? null;
      return {
        pluginId: id,
        enabled: id !== null && !!s.plugins[id]?.enabled,
        consents: selectConsentCount(s),
        frame: s.session.captureFrame,
        srcW: s.session.input?.width ?? 0,
        srcH: s.session.input?.height ?? 0,
      };
    }),
  );
  const allTurns = useLensStore((s) => s.outfitTurns);
  const ask = useLensStore((s) => s.askPlugin);
  const live = v.pluginId !== null && v.enabled && v.consents > 0;
  const [engine, setEngine] = useState<SttEngine>(scribeAvailable ? 'scribe' : 'browser');
  const scribe = useScribeInput(live && engine === 'scribe');
  const speech = useSpeechInput(live && engine === 'browser');
  const typing = engine === 'type' || (engine === 'browser' && (speech.state === 'unsupported' || speech.state === 'error'));
  const [draft, setDraft] = useState('');
  const [hint, setHint] = useState('');
  // 실시간 받아쓰기가 실패하면(토큰 없음·연결 오류) 브라우저 음성 인식, 그것도 없으면 입력창으로 넘어간다.
  useEffect(() => {
    if (scribe.state !== 'error') return;
    const next: SttEngine = speech.state === 'unsupported' ? 'type' : 'browser';
    setEngine(next);
    setHint(next === 'browser' ? '받아쓰기 서비스를 쓸 수 없어 브라우저 음성 인식으로 바꿨어요' : '받아쓰기를 쓸 수 없어요 · 글로 물어보세요');
  }, [scribe.state, speech.state]);
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);

  const turns = useMemo(
    () => allTurns.filter((t) => t.pluginId === v.pluginId).sort((a, b) => a.askedAt - b.askedAt),
    [allTurns, v.pluginId],
  );
  const lastId = turns[turns.length - 1]?.id ?? null;
  // 코디 스캔이 켜지는 순간(앱을 열 때) 지난 대화를 닫힌 기준으로 둔다. 렌더 중에 바꿔 지난 패널이 한 번도 그려지지 않게 한다.
  const [enteredOn, setEnteredOn] = useState(false);
  if (v.enabled !== enteredOn) {
    setEnteredOn(v.enabled);
    if (v.enabled) setClosedAt(closedOnEnter(lastId));
  }
  const panelOpen = outfitPanelOpen(v.enabled, lastId, closedAt);
  const question = (typing ? draft : engine === 'scribe' ? scribe.text : speech.text).trim().slice(0, QUESTION_MAX);

  /** 질문 하나를 묻는다. 보낼 조각이 없으면(askPlugin null) 알림만. */
  function send(text: string): boolean {
    const q = text.trim().slice(0, QUESTION_MAX);
    if (!q || !v.pluginId) return false;
    if (!ask(v.pluginId, q)) {
      setHint('아직 보낼 사진이 없어요 · 사람이 흰 틀 안에 있는지 봐 주세요');
      return false;
    }
    setHint('');
    return true;
  }
  function submit() {
    if (engine === 'scribe') {
      // 멈추고 확정 글자로 묻는다. 받아쓰기는 바로 다시 듣는다.
      if (scribe.state !== 'listening' && scribe.state !== 'paused') return;
      void scribe.finish().then((t) => (t ? send(t) : setHint('못 알아들었어요 · 다시 말해 주세요')));
      return;
    }
    if (!send(question)) return;
    setDraft('');
    speech.clear();
  }
  const submitRef = useRef(submit);
  submitRef.current = submit;

  useEffect(() => {
    if (!live) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isGlassButtonKey(e, ['Enter', ' '])) return;
      e.preventDefault();
      submitRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [live]);

  useEffect(() => {
    if (!hint) return;
    const t = window.setTimeout(() => setHint(''), 4000);
    return () => window.clearTimeout(t);
  }, [hint]);

  useLayoutEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [turns, panelOpen]);

  // 흰 틀은 SelectionFrame이 화면에 맞춰 그린 자리에 있다(CaptureFrame과 같은 변환).
  const view = fitSelection(sourceToView(v.frame, v.srcW > 0 ? { w: v.srcW, h: v.srcH } : null, size), selectionLimits(size.w, size.h));
  const place = talkPanelPlacement({ top: view.y * size.h, right: (view.x + view.w) * size.w }, size);
  const shown = question.length > BAR_TAIL ? `…${question.slice(-BAR_TAIL)}` : question;
  const note = hint || (live && engine === 'browser' && speech.state === 'error' ? speech.error : '');
  const liveState = engine === 'scribe' ? scribe.state : speech.state;
  const finishing = engine === 'scribe' && scribe.state === 'finishing';

  return (
    <>
      {panelOpen && (
        <section className="fm-talk fm-talkpanel" aria-label="코디 스캔 질문과 답" style={{ top: place.top, maxHeight: place.maxHeight }}>
          <div className="fm-talk__glow" aria-hidden="true" />
          <div className="fm-talk__ring">
            <div className="fm-talk__inner">
              <header className="fm-talkpanel__head">
                <span className="fm-talkpanel__title">코디 스캔</span>
                <button type="button" className="fm-talkpanel__close" aria-label="질문과 답 닫기" onClick={() => setClosedAt(lastId)}>
                  ×
                </button>
              </header>
              <div ref={log} className="fm-talkpanel__log" role="log" aria-live="polite" aria-relevant="additions text">
                {turns.map((t) => (
                  <Turn key={t.id} turn={t} />
                ))}
              </div>
            </div>
          </div>
        </section>
      )}
      {live && (
        <div className="fm-talk fm-talkbar" data-mode={typing ? 'type' : engine}>
          <div className="fm-talk__glow" aria-hidden="true" />
          <div className="fm-talk__ring">
            <div className="fm-talk__inner">
              {typing ? (
                <form
                  className="fm-talkbar__form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit();
                  }}
                >
                  <input
                    className="fm-talkbar__input"
                    aria-label="동의한 사람의 옷에 관한 질문"
                    placeholder="이 사람 옷에 대해 물어보세요"
                    autoComplete="off"
                    enterKeyHint="send"
                    maxLength={QUESTION_MAX}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <button type="submit" className="fm-talkbar__send" aria-label="질문 보내기" disabled={!draft.trim()}>
                    ↑
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  className="fm-talkbar__speech"
                  aria-label={finishing ? '받아쓰는 중' : question ? `질문 보내기: ${question}` : '듣는 중 · 말한 뒤 탭하거나 Enter'}
                  aria-busy={finishing}
                  onClick={submit}
                >
                  <span className="fm-talkbar__dot" data-state={finishing ? 'transcribing' : liveState} aria-hidden="true" />
                  <span className="fm-talkbar__text" data-empty={!question || finishing}>
                    {finishing ? '받아쓰는 중…' : shown || (liveState === 'listening' ? '듣는 중 · 말한 뒤 탭하세요' : liveState === 'paused' ? '멈췄어요 · 탭하면 보내요' : '마이크 켜는 중…')}
                  </span>
                </button>
              )}
            </div>
          </div>
          {(note || engine === 'scribe') && (
            <div className="fm-talkbar__above">
              {note && (
                <p className="fm-talkbar__hint" role="status">
                  {note}
                </p>
              )}
              {engine === 'scribe' && <p className="fm-talkbar__notice">{STT_NOTICE}</p>}
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** 질문 하나와 그 답. 질문은 착용자의 말, 답은 플러그인 문자열(텍스트 노드로만). */
function Turn({ turn: t }: { turn: OutfitTurn }) {
  const answer = t.status === 'answered' ? sanitizeAnswerText(t.answer ?? '') : '';
  return (
    <>
      <div className="fm-outfit-message fm-outfit-message--user">
        <div className="fm-outfit-message__bubble">{t.question}</div>
      </div>
      <div className="fm-outfit-message">
        <div className="fm-outfit-message__bubble" data-status={t.status}>
          {t.status === 'asking' ? '보는 중…' : t.status === 'failed' ? `답을 받지 못했어요${t.failReason ? ` · ${t.failReason}` : ''}` : answer || '빈 답이 왔어요'}
          {t.status === 'answered' && t.source === 'fallback' && (
            <p className="fm-outfit-message__note">대체 답변 · AI 답을 받지 못했어요</p>
          )}
        </div>
      </div>
    </>
  );
}
