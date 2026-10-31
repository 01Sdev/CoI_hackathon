// design.html의 코디 UI 추출본. 원본 픽셀·제스처 인식·마이크·분석 API는 호출 측에서 연결한다.
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import './outfit-assistant.css';

export interface OutfitPoint { x: number; y: number }
export interface OutfitTarget {
  /** 선택이 바뀔 때 갱신하는 키. 인물 식별자·추적 ID가 아니다. */
  selectionKey: string;
  /** 부모 시야 영역 기준 0~1 좌표. */
  point: OutfitPoint;
}
export interface OutfitMessage {
  id: string;
  role: 'user' | 'assistant';
  selectionKey: string;
  label?: string;
  title?: string;
  text?: string;
  items?: readonly (readonly [string, string])[];
  note?: string;
  actions?: readonly string[];
}
export interface OutfitVoice {
  state: 'idle' | 'starting' | 'listening' | 'finishing' | 'error' | 'unsupported';
  message?: string;
}
export interface OutfitAssistantProps {
  target: OutfitTarget | null;
  draft: string;
  messages: readonly OutfitMessage[];
  onDraftChange(value: string): void;
  /** 위치 선택 요청만 알린다. 실제 사람 판정·가림은 A 런타임이 맡는다. */
  onTargetPick(point: OutfitPoint): void;
  onSubmit(question: string, target: OutfitTarget): void;
  /** 현재는 버튼. 실제 제스처를 연결할 때 값을 증가시키면 같은 입력창이 열린다. */
  openRequest?: number;
  voice?: OutfitVoice;
  onMicToggle?(): void;
  onCancelVoice?(): void;
  /** 부모 영역 기준 0~1. 생략하면 부모 전체에서 점을 선택한다. */
  selectionBounds?: { x: number; y: number; w: number; h: number };
  demo?: boolean;
}

type Mode = 'closed' | 'compact' | 'phone';
type Gesture = { id: number; kind: 'move' | 'resize'; x: number; y: number; left: number; top: number; w: number; h: number };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const themeKey = 'framelet.fashionChat.theme';
function initialTheme(): 'light' | 'dark' {
  try { const saved = localStorage.getItem(themeKey); if (saved === 'light' || saved === 'dark') return saved; } catch { /* private mode */ }
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}
function ThemeIcon() {
  return <><svg className="fashion-theme-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg><svg className="fashion-theme-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" /></svg></>;
}
function MicIcon({ stop = false }: { stop?: boolean }) {
  return stop ? <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2" /></svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></svg>;
}

export function OutfitAssistant({ target, draft, messages, onDraftChange, onTargetPick, onSubmit, openRequest = 0, voice = { state: 'idle' }, onMicToggle, onCancelVoice, selectionBounds, demo = false }: OutfitAssistantProps) {
  const uid = `outfit-${useId().replace(/:/g, '')}`;
  const root = useRef<HTMLDivElement>(null), chat = useRef<HTMLElement>(null), head = useRef<HTMLElement>(null);
  const entry = useRef<HTMLInputElement>(null), mic = useRef<HTMLButtonElement>(null), picker = useRef<HTMLButtonElement>(null), launcher = useRef<HTMLButtonElement>(null), log = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('closed'), [picking, setPicking] = useState(false);
  const [theme, setTheme] = useState(initialTheme), [cursor, setCursor] = useState<OutfitPoint>({ x: .5, y: .5 });
  const [size, setSize] = useState({ w: 0, h: 0 }), [phoneSize, setPhoneSize] = useState({ w: 320, h: 680 });
  const [position, setPosition] = useState<OutfitPoint | null>(null), [dragHeight, setDragHeight] = useState(84);
  const [gestureKind, setGestureKind] = useState<Gesture['kind'] | null>(null);
  const gesture = useRef<Gesture | null>(null), returnToPhone = useRef(false), composing = useRef(false);
  const previousRequest = useRef(openRequest), actions = useRef({ open: () => {}, cancel: onCancelVoice });
  const active = ['starting', 'listening', 'finishing'].includes(voice.state);
  const bounds = selectionBounds ?? { x: 0, y: 0, w: 1, h: 1 };
  const compact = size.h < 420 || size.w < 360;
  const pw = Math.min(phoneSize.w, Math.max(1, size.w - 24)), ph = Math.min(phoneSize.h, Math.max(1, size.h - 24));
  const left = position ? clamp(position.x, 12, Math.max(12, size.w - pw - 12)) : null;
  const top = position ? clamp(position.y, 12, Math.max(12, size.h - ph - 12)) : null;

  useLayoutEffect(() => {
    const el = root.current; if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure(); const observer = new ResizeObserver(measure); observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const h = head.current, card = chat.current, host = root.current;
    if (mode !== 'phone' || !h || !card || !host) return;
    const measure = () => {
      const r = host.getBoundingClientRect();
      setDragHeight((h.getBoundingClientRect().bottom - card.getBoundingClientRect().top) * host.clientHeight / (r.height || 1));
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(h);
    return () => observer.disconnect();
  }, [mode, compact]);
  useLayoutEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages, mode]);
  useEffect(() => {
    if (previousRequest.current === openRequest) return;
    previousRequest.current = openRequest; actions.current.open();
  }, [openRequest]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) actions.current.cancel?.(); };
    document.addEventListener('visibilitychange', hidden);
    return () => { document.removeEventListener('visibilitychange', hidden); actions.current.cancel?.(); };
  }, []);

  function stopGesture() {
    const id = gesture.current?.id; gesture.current = null; setGestureKind(null);
    if (id !== undefined && chat.current?.hasPointerCapture(id)) chat.current.releasePointerCapture(id);
  }
  function beginPick() {
    onCancelVoice?.(); stopGesture(); returnToPhone.current = mode === 'phone';
    setMode('compact'); setPicking(true); setCursor({ x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 });
    requestAnimationFrame(() => picker.current?.focus({ preventScroll: true }));
  }
  function open() {
    if (!target) beginPick(); else { setMode('compact'); onMicToggle?.(); }
  }
  actions.current = { open, cancel: onCancelVoice };
  function fold() { onCancelVoice?.(); stopGesture(); setMode('compact'); requestAnimationFrame(() => mic.current?.focus({ preventScroll: true })); }
  function close() { onCancelVoice?.(); stopGesture(); setPicking(false); setMode('closed'); requestAnimationFrame(() => launcher.current?.focus({ preventScroll: true })); }
  function cancelPick() {
    setPicking(false); if (returnToPhone.current) setMode('phone'); returnToPhone.current = false;
    requestAnimationFrame(() => entry.current?.focus({ preventScroll: true }));
  }
  function choose(point: OutfitPoint) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < bounds.x || point.x > bounds.x + bounds.w || point.y < bounds.y || point.y > bounds.y + bounds.h) return;
    onTargetPick(point); setPicking(false); if (returnToPhone.current) setMode('phone'); returnToPhone.current = false;
    // 지정·재지정으로 draft를 지우지 않는다. 실제 대상 확인·음성 시작은 호출 측에서 연결한다.
  }
  function submit(text = draft) {
    const question = text.trim().slice(0, 300); if (!question || composing.current) return;
    if (!target || picking) { onDraftChange(text); beginPick(); return; }
    onCancelVoice?.(); onSubmit(question, target); onDraftChange(''); setMode('phone');
    requestAnimationFrame(() => entry.current?.focus({ preventScroll: true }));
  }
  function resizePhone(w: number, h: number, requestedScale: number) {
    const maxW = Math.max(1, size.w - 24), maxH = Math.max(1, size.h - 24);
    const min = Math.max(Math.min(260, maxW) / w, Math.min(compact ? 160 : 360, maxH) / h), max = Math.min(maxW / w, maxH / h);
    const scale = clamp(requestedScale, Math.min(min, max), max); setPhoneSize({ w: w * scale, h: h * scale });
  }
  function phoneStart(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || mode !== 'phone' || !root.current || !chat.current) return;
    const el = event.target as Element, resizing = !!el.closest('.fm-outfit-chat__resize');
    if (!resizing && (!el.closest('.fm-outfit-chat__drag-zone, .fm-outfit-chat__head-actions') || el.closest('button'))) return;
    event.preventDefault(); stopGesture();
    const s = root.current.getBoundingClientRect(), r = chat.current.getBoundingClientRect();
    const sx = size.w / (s.width || 1), sy = size.h / (s.height || 1);
    const point = { x: (r.left - s.left) * sx, y: (r.top - s.top) * sy };
    setPosition(point); const kind = resizing ? 'resize' : 'move'; setGestureKind(kind);
    gesture.current = { id: event.pointerId, kind, x: event.clientX, y: event.clientY, left: point.x, top: point.y, w: r.width * sx, h: r.height * sy };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function phoneMove(event: PointerEvent<HTMLElement>) {
    const start = gesture.current, host = root.current; if (start?.id !== event.pointerId || !host) return;
    const r = host.getBoundingClientRect(), dx = (event.clientX - start.x) * size.w / (r.width || 1), dy = (event.clientY - start.y) * size.h / (r.height || 1);
    if (start.kind === 'move') setPosition({ x: start.left + dx, y: start.top + dy });
    else resizePhone(start.w, start.h, 1 + (dx * start.w + dy * start.h) / (start.w ** 2 + start.h ** 2));
  }
  function phoneEnd(event: PointerEvent<HTMLElement>) { if (gesture.current?.id === event.pointerId) stopGesture(); }
  const themeButton = () => <button type="button" className="fm-outfit-chat__theme-toggle" aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'} title={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'} onClick={() => { const next = theme === 'dark' ? 'light' : 'dark'; setTheme(next); try { localStorage.setItem(themeKey, next); } catch { /* private mode */ } }}><ThemeIcon /></button>;
  const marker = picking ? cursor : target?.point;
  const phoneStyle = { '--fashion-phone-width': `${phoneSize.w}px`, '--fashion-phone-height': `${phoneSize.h}px`, '--fashion-drag-height': `${dragHeight}px`, ...(mode === 'phone' && left !== null && top !== null ? { left, top, right: 'auto', bottom: 'auto', transform: 'none' } : {}) } as CSSProperties;
  const micLabel = active ? '말하기 마치기' : voice.state === 'error' ? '마이크 다시 켜기' : '마이크 켜기';

  return <div ref={root} className="fm-outfit" data-compact={compact} onKeyDown={event => {
    if (mode === 'closed' || event.nativeEvent.isComposing || event.key !== 'Escape') return;
    event.preventDefault(); event.stopPropagation();
    if (active) onCancelVoice?.(); else if (picking) cancelPick(); else if (mode === 'phone') fold(); else close();
  }}>
    <button ref={picker} type="button" className="fm-outfit-pick-layer" hidden={!picking} aria-label="질문할 대상 위치 선택. 방향키로 이동하고 Enter로 지정합니다." onClick={event => {
      if (event.detail === 0) { choose(cursor); return; }
      const r = root.current!.getBoundingClientRect(); choose({ x: (event.clientX - r.left) / r.width, y: (event.clientY - r.top) / r.height });
    }} onKeyDown={event => {
      const move: Record<string, [number, number]> = { ArrowLeft: [-.02, 0], ArrowRight: [.02, 0], ArrowUp: [0, -.02], ArrowDown: [0, .02] };
      const d = move[event.key]; if (!d) return; event.preventDefault(); event.stopPropagation();
      setCursor(p => ({ x: clamp(p.x + d[0], bounds.x, bounds.x + bounds.w), y: clamp(p.y + d[1], bounds.y, bounds.y + bounds.h) }));
    }} />
    {mode !== 'closed' && marker && <span className="fm-outfit-target-marker" aria-hidden="true" style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }} />}
    <button ref={launcher} type="button" className="fm-outfit-launcher" data-chat-theme={theme} hidden={mode !== 'closed'} aria-controls={uid} aria-expanded={mode !== 'closed'} title="제스처 대신 버튼으로 질문 시작" onClick={open}><MicIcon />질문하기</button>
    <section ref={chat} id={uid} className={`fm-outfit-chat${mode === 'phone' ? ' is-expanded' : ''}`} data-chat-theme={theme} data-has-text={!!draft.trim()} data-voice-state={voice.state} data-dragging={gestureKind === 'move'} data-resizing={gestureKind === 'resize'} role={mode === 'phone' ? 'dialog' : 'region'} aria-label="코디 스캔 질문" hidden={mode === 'closed'} style={phoneStyle} onPointerDown={phoneStart} onPointerMove={phoneMove} onPointerUp={phoneEnd} onPointerCancel={phoneEnd} onLostPointerCapture={phoneEnd}>
      <div className="fm-outfit-chat__voice-status" data-state={voice.state} role="status" hidden={!voice.message}>{voice.message}</div>
      <div className="fm-outfit-chat__hints" role="group" aria-label="대화 도구">
        <button type="button" className="fm-outfit-chat__text-button" disabled={!messages.length} onClick={() => { onCancelVoice?.(); setPicking(false); setMode('phone'); }}>이전 대화</button>
        <span className="fm-outfit-chat__tool-divider" aria-hidden="true" />
        <button type="button" className="fm-outfit-chat__text-button" aria-pressed={picking} onClick={() => picking ? cancelPick() : beginPick()}>대상 바꾸기</button>
        <span className="fm-outfit-chat__tool-divider" aria-hidden="true" />{themeButton()}
      </div>
      <div className="fm-outfit-chat__drag-zone" aria-hidden="true" />
      <button type="button" className="fm-outfit-chat__resize" aria-label="폰 창 크기 조절" title="모서리 드래그 또는 방향키로 크기 조절" onKeyDown={event => {
        const d: Record<string, number> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }; const sign = d[event.key];
        if (!sign) return; event.preventDefault(); event.stopPropagation();
        resizePhone(pw, ph, 1 + sign * (event.shiftKey ? .1 : .025));
      }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M12 18l6-6" /></svg></button>
      <div className="fm-outfit-chat__glow" aria-hidden="true" />
      <div className="fm-outfit-chat__ring"><div className="fm-outfit-chat__inner">
        <div className="fm-outfit-chat__speaker" aria-hidden="true" />
        <header ref={head} className="fm-outfit-chat__head"><div className="fm-outfit-chat__heading"><h2>코디 스캔</h2>{demo && <span className="fm-outfit-chat__demo">UI 예시</span>}</div><div className="fm-outfit-chat__head-actions">{themeButton()}<button type="button" className="fm-outfit-chat__fold" aria-label="대화창 접기" onClick={fold}>×</button></div></header>
        <div className="fm-outfit-chat__target"><button type="button" className="fm-outfit-chat__retarget" onClick={beginPick}>다시 지정</button></div>
        <div ref={log} className="fm-outfit-chat__log" role="log" aria-label="코디 질문과 답변" aria-live="polite" aria-relevant="additions">
          {messages.map(message => <div key={message.id} className={`fm-outfit-message${message.role === 'user' ? ' fm-outfit-message--user' : ''}`} data-selection={message.selectionKey}><div className="fm-outfit-message__bubble">
            {message.label && <div className="fm-outfit-message__label">{message.label}</div>}{message.title && <h3>{message.title}</h3>}{message.text && <p>{message.text}</p>}
            {message.items && <dl>{message.items.map(([key, value], i) => <div className="fm-outfit-message__item" key={`${key}-${i}`}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>}
            {message.note && <p className="fm-outfit-message__note">{message.note}</p>}
            {message.actions && <div className="fm-outfit-chat__quick">{message.actions.map(action => <button type="button" className="fm-outfit-chat__chip" key={action} onClick={() => submit(action)}>{action}</button>)}</div>}
          </div></div>)}
        </div>
        <div className="fm-outfit-chat__voice-status fm-outfit-chat__voice-status--phone" data-state={voice.state} role="status" hidden={!voice.message}>{voice.message}</div>
        <form className="fm-outfit-chat__form" onSubmit={event => { event.preventDefault(); submit(); }}>
          <input ref={entry} className="fm-outfit-chat__input" aria-label="선택한 사람의 옷에 관한 질문" placeholder="지정한 사람의 옷에 대해 물어보세요" autoComplete="off" maxLength={300} value={draft} onChange={event => { if (active) onCancelVoice?.(); onDraftChange(event.target.value); }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} />
          <button ref={mic} type="button" className="fm-outfit-chat__mic" aria-label={micLabel} title={!onMicToggle ? '음성 입력 연결 전' : !target ? '먼저 대상을 지정해 주세요' : micLabel} aria-pressed={active} disabled={!target || picking || !onMicToggle || voice.state === 'finishing' || voice.state === 'unsupported'} onClick={onMicToggle}><MicIcon stop={active} /></button>
          <button type="button" className="fm-outfit-chat__dismiss" aria-label="입력창 닫기" onClick={close}>×</button><button type="submit" className="fm-outfit-chat__send" aria-label="질문 보내기" disabled={!draft.trim()}>↑</button>
        </form><div className="fm-outfit-chat__home" aria-hidden="true" />
      </div></div>
    </section>
  </div>;
}
