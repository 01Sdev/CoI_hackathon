// design.html에서 연결선·금빛 상태창만 추출. 인식·스토어·API와 연결하지 않는다.
import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import './food-status-panel.css';

export interface FoodStatusResult {
  /** 새 인식마다 새 ID를 주면, 닫았던 창도 다시 열린다. */
  id: string | number;
  name: string;
  /** 검증된 열량이 없으면 null. 임의의 열량을 채우지 않는다. */
  kcal: number | null;
}

export interface FoodStatusPanelProps {
  result: FoodStatusResult | null;
  /** 부모 영역 기준 0~1 좌표. 이미지 좌표 변환은 호출하는 쪽에서 한다. */
  anchor: { x: number; y: number };
}

const border = 'M32 10H240Q262 10 262 32V186Q262 208 240 208H32Q10 208 10 186V32Q10 10 32 10Z';
const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));

export function FoodStatusPanel({ result, anchor }: FoodStatusPanelProps) {
  const uid = `food-${useId().replace(/:/g, '')}`;
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const frame = useRef<SVGSVGElement>(null);
  const name = useRef<HTMLHeadingElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const [dismissed, setDismissed] = useState<string | number | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0, pw: 0, ph: 0 });
  const visible = result !== null && dismissed !== result.id;

  useLayoutEffect(() => {
    if (name.current) name.current.textContent = result?.name ?? '';
  }, [result?.name]);

  useLayoutEffect(() => {
    const container = root.current, card = panel.current;
    if (!container || !card) return;
    const measure = () => {
      const next = { w: container.clientWidth, h: container.clientHeight, pw: card.offsetWidth, ph: card.offsetHeight };
      setSize(old => old.w === next.w && old.h === next.h && old.pw === next.pw && old.ph === next.ph ? old : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(card);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    const svg = frame.current;
    if (!svg) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      if (!visible || motion.matches || document.hidden) svg.pauseAnimations();
      else svg.unpauseAnimations();
    };
    update();
    motion.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      motion.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [visible]);

  const x = clamp(position?.x ?? (size.w < 680 ? (size.w - size.pw) / 2 : size.w - size.pw - 24), 12, Math.max(12, size.w - size.pw - 12));
  const y = clamp(position?.y ?? size.h * .22, 12, Math.max(12, size.h - size.ph - 12));
  const validAnchor = Number.isFinite(anchor.x) && Number.isFinite(anchor.y);
  const ax = validAnchor ? clamp(anchor.x, 0, 1) * size.w : 0;
  const ay = validAnchor ? clamp(anchor.y, 0, 1) * size.h : 0;
  const left = x + size.pw / 2 >= ax;
  const endX = left ? x : x + size.pw;
  const endY = y + Math.min(64, size.ph / 2);
  const points = `${ax},${ay} ${endX + (left ? -32 : 32)},${endY} ${endX},${endY}`;
  const covered = ax >= x - 4 && ax <= x + size.pw + 4 && ay >= y - 4 && ay <= y + size.ph + 4;
  const hasKcal = typeof result?.kcal === 'number' && Number.isFinite(result.kcal) && result.kcal >= 0;

  function stopDrag(event: PointerEvent<HTMLElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <div ref={root} className="fm-food-status" hidden={!visible}>
      <svg className="fm-food-status__connector" viewBox={`0 0 ${size.w || 1} ${size.h || 1}`} aria-hidden="true" focusable="false" style={{ display: validAnchor && !covered ? undefined : 'none' }}>
        <polyline className="fm-food-status__line-shadow" points={points} />
        <polyline className="fm-food-status__line" points={points} />
        <circle className="fm-food-status__anchor" cx={ax} cy={ay} r="4" />
        <rect className="fm-food-status__end" x={endX - 2} y={endY - 2} width="4" height="4" />
      </svg>
      <aside ref={panel} className="fm-food-status__panel" data-dragging={dragging} style={{ transform: `translate3d(${x}px,${y}px,0)` }} tabIndex={0} aria-labelledby={`${uid}-name`} aria-describedby={`${uid}-help`}
        onPointerDown={event => {
          if (event.button !== 0 || drag.current || (event.target as Element).closest('button')) return;
          event.preventDefault();
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: x, top: y };
          setDragging(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          const start = drag.current;
          if (start?.id !== event.pointerId) return;
          setPosition({ x: start.left + event.clientX - start.x, y: start.top + event.clientY - start.y });
        }}
        onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={stopDrag}
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return;
          const step = event.shiftKey ? 24 : 8;
          const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
          const move = moves[event.key];
          if (!move) return;
          event.preventDefault();
          setPosition({ x: x + move[0], y: y + move[1] });
        }}>
        <button type="button" className="fm-food-status__close" aria-label="음식 정보창 닫기" title="닫기" onClick={() => { if (result) setDismissed(result.id); }}><span aria-hidden="true">×</span></button>
        <svg ref={frame} className="fm-food-status__frame" viewBox="0 0 272 218" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <defs>
            <radialGradient id={`${uid}-falloff`}><stop offset="0" stopColor="white" /><stop offset=".4" stopColor="white" stopOpacity=".95" /><stop offset="1" stopColor="white" stopOpacity="0" /></radialGradient>
            <filter id={`${uid}-blur`} filterUnits="userSpaceOnUse" x="-8" y="-8" width="288" height="234"><feGaussianBlur stdDeviation="2.5" /></filter>
            <mask id={`${uid}-mask`} maskUnits="userSpaceOnUse" x="-8" y="-8" width="288" height="234">
              <circle className="fm-food-status__orbit" r="28" fill={`url(#${uid}-falloff)`}><animateMotion dur="8s" repeatCount="indefinite" calcMode="paced" path={border} /></circle>
            </mask>
          </defs>
          <path className="fm-food-status__backdrop" d={border} />
          <path className="fm-food-status__outer" d="M114 10H32Q10 10 10 32V186Q10 208 32 208H114M158 208H240Q262 208 262 186V32Q262 10 240 10H158" />
          <rect className="fm-food-status__inner" x="16" y="16" width="240" height="186" rx="2" />
          <path className="fm-food-status__corner" d="M10 42V22Q10 10 22 10H42M10 31Q26 31 26 15M230 10H250Q262 10 262 22V42M246 15Q246 31 262 31M262 176V196Q262 208 250 208H230M262 187Q246 187 246 203M42 208H22Q10 208 10 196V176M26 203Q26 187 10 187" />
          <path className="fm-food-status__gem" d="M136 4L142 10L136 16L130 10ZM136 202L142 208L136 214L130 208Z" />
          <path className="fm-food-status__outer" d="M118 10H128M144 10H154M118 208H128M144 208H154" />
          <g className="fm-food-status__glow" mask={`url(#${uid}-mask)`}>
            <path className="fm-food-status__halo" d={border} filter={`url(#${uid}-blur)`} />
            <path className="fm-food-status__core" d={border} />
          </g>
        </svg>
        <h3 ref={name} id={`${uid}-name`} className="fm-food-status__name" />
        <div className="fm-food-status__divider" aria-hidden="true"><span /></div>
        <div className="fm-food-status__energy"><output aria-label={hasKcal ? `${Math.round(result!.kcal!)} 킬로칼로리` : '열량 미확인'}>{hasKcal ? Math.round(result!.kcal!).toLocaleString('ko-KR') : '—'}</output><span>kcal</span></div>
        <span id={`${uid}-help`} className="fm-food-status__help">빈 곳을 잡거나 방향키로 이동합니다. 오른쪽 위 닫기 버튼으로 숨길 수 있습니다.</span>
      </aside>
    </div>
  );
}
