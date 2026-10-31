// 코디 스캔 말 막대와 질문·답 패널(파이프라인 2, docs/designs/outfit-pipelines.md).
// 휴대폰 웹은 스마트 글래스 시야를 휴대폰 브라우저로 흉내 내는 화면이라(사용자 2026-11-01), #42의 폰 모양 창 대신
// 글래스 화면에 뜨는 HUD 패널로 그린다. 말풍선 모양은 #42(outfit-assistant.css), 겉 글로우·테두리는 사용자가 준 zip 값이다.
// 막대: 동의가 살아 있고 코디 스캔이 켜져 있으면 시야 아래에 뜨고 음성 인식(ko-KR)을 켠다. 받아 적은 글자가 막대에 보인다.
//   막대를 탭하거나 Enter·Space(글래스 버튼 대용) → askPlugin(코디 스캔 id, 질문). 음성 인식이 없거나 막히면 입력창으로 대신한다.
// 패널: 시야 오른쪽 가장자리. outfitTurns의 질문과 답(묻는 중, 실패 사유, 대체 답변)을 보인다. 답은 플러그인 문자열이라
//   sanitizeAnswerText를 거쳐 텍스트 노드로만 넣는다. 새 질문이 생기면 열리고, ×로 닫으면 다음 질문까지 닫혀 있다.
//   동의가 끝나면 막대만 사라지고 패널은 남는다.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { selectConsentCount } from '../core/selectors';
import { useLensStore } from '../core/store';
import type { OutfitTurn } from '../core/types';
import { isGlassButtonKey } from './glassKeys';
import { sanitizeAnswerText } from './sanitize';
import { useSpeechInput } from './useSpeechInput';
import './outfit-assistant.css';
import './outfit-talk.css';

/** 질문 최대 글자(#42 입력창과 같음). */
const QUESTION_MAX = 300;
/** 막대에 보이는 받아쓰기 글자 수. 길면 앞을 줄이고 최근 말을 보인다. */
const BAR_TAIL = 48;

export function OutfitTalk() {
  const v = useLensStore(
    useShallow((s) => {
      const id = s.pluginOrder.find((x) => s.plugins[x]?.kind === 'outfit') ?? null;
      return { pluginId: id, enabled: id !== null && !!s.plugins[id]?.enabled, consents: selectConsentCount(s) };
    }),
  );
  const allTurns = useLensStore((s) => s.outfitTurns);
  const ask = useLensStore((s) => s.askPlugin);
  const live = v.pluginId !== null && v.enabled && v.consents > 0;
  const speech = useSpeechInput(live);
  const typing = speech.state === 'unsupported' || speech.state === 'error';
  const [draft, setDraft] = useState('');
  const [hint, setHint] = useState('');
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);

  const turns = useMemo(
    () => allTurns.filter((t) => t.pluginId === v.pluginId).sort((a, b) => a.askedAt - b.askedAt),
    [allTurns, v.pluginId],
  );
  const lastId = turns[turns.length - 1]?.id ?? null;
  const panelOpen = lastId !== null && closedAt !== lastId;
  const question = (typing ? draft : speech.text).trim().slice(0, QUESTION_MAX);

  function submit() {
    if (!question || !v.pluginId) return;
    if (!ask(v.pluginId, question)) {
      setHint('아직 보낼 사진이 없어요 · 사람이 흰 틀 안에 있는지 봐 주세요');
      return;
    }
    setHint('');
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

  const shown = question.length > BAR_TAIL ? `…${question.slice(-BAR_TAIL)}` : question;
  const note = hint || (live && speech.state === 'error' ? speech.error : '');

  return (
    <>
      {panelOpen && (
        <section className="fm-talk fm-talkpanel" aria-label="코디 스캔 질문과 답">
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
        <div className="fm-talk fm-talkbar" data-mode={typing ? 'type' : 'speech'}>
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
                  aria-label={question ? `질문 보내기: ${question}` : '듣는 중 · 말한 뒤 탭하거나 Enter'}
                  onClick={submit}
                >
                  <span className="fm-talkbar__dot" data-state={speech.state} aria-hidden="true" />
                  <span className="fm-talkbar__text" data-empty={!question}>
                    {shown || (speech.state === 'listening' ? '듣는 중 · 말한 뒤 탭하세요' : '마이크 켜는 중…')}
                  </span>
                </button>
              )}
            </div>
          </div>
          {note && (
            <p className="fm-talkbar__hint" role="status">
              {note}
            </p>
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
