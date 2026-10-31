// design.html의 범위 선택·인원 수 표시만 추출. 검출 모델·카메라·기존 보호 카운터 M을 호출하지 않는다.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import type { Box } from '../core/types';
import { fitSelection, moveSelection, resizeSelection, selectionHandlePoint, selectionLimits, type SelectionHandle } from './selection-frame';
import './selection-frame.css';

export interface SelectionFrameProps {
  /** 부모 시야 영역 기준 0~1. 원본 프레임 좌표와 다를 수 있다. */
  value: Box;
  onChange(value: Box): void;
  /** 외부에서 계산한 인원수. 이 컴포넌트는 표시만 한다. null이면 미확인. */
  peopleCount: number | null;
  /** false면 테두리·손잡이 없이 틀만 그린다(HUD의 조절 모드 밖). 기본 true. */
  editable?: boolean;
  /** 숫자 읽기 문구. 기본 "사람 N명". */
  countLabel?: (count: number) => string;
  /** 있으면 숫자가 1 이상일 때 숫자를 버튼으로 그린다(HUD: 눌러서 동의 끄기). */
  onCountPress?: () => void;
  countPressLabel?: string;
}
const handles: readonly SelectionHandle[] = ['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e'];
const labels: Record<SelectionHandle, string> = { nw: '왼쪽 위 모서리', ne: '오른쪽 위 모서리', sw: '왼쪽 아래 모서리', se: '오른쪽 아래 모서리', n: '위쪽 중간점', s: '아래쪽 중간점', w: '왼쪽 중간점', e: '오른쪽 중간점' };
const edges = [['n', '위쪽'], ['s', '아래쪽'], ['w', '왼쪽'], ['e', '오른쪽']] as const;
const personIcon = <svg className="fm-selection__person" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><circle cx="16" cy="8" r="8" /><path d="M0 32v-1c0-7.7 6.3-14 14-14h4c7.7 0 14 6.3 14 14v1Z" /></svg>;
const same = (a: Box, b: Box) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9 && Math.abs(a.w - b.w) < 1e-9 && Math.abs(a.h - b.h) < 1e-9;

export function SelectionFrame({ value, onChange, peopleCount, editable = true, countLabel = (n) => `사람 ${n}명`, onCountPress, countPressLabel }: SelectionFrameProps) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; handle: SelectionHandle | null; x: number; y: number; frame: Box; element: HTMLButtonElement } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 }), [mode, setMode] = useState<'move' | 'resize' | null>(null);
  const limit = selectionLimits(size.w, size.h), frame = fitSelection(value, limit);
  useLayoutEffect(() => {
    const el = root.current; if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure(); const observer = new ResizeObserver(measure); observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (size.w > 0 && size.h > 0 && !same(value, frame)) onChange(frame); }, [size.w, size.h, value, frame.x, frame.y, frame.w, frame.h, onChange]);

  function start(event: PointerEvent<HTMLButtonElement>, handle: SelectionHandle | null) {
    if (event.button !== 0 || drag.current) return;
    event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
    drag.current = { id: event.pointerId, handle, x: event.clientX, y: event.clientY, frame, element: event.currentTarget };
    setMode(handle ? 'resize' : 'move'); event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const d = drag.current, el = root.current; if (d?.id !== event.pointerId || !el) return;
    const r = el.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return;
    const dx = (event.clientX - d.x) / r.width, dy = (event.clientY - d.y) / r.height;
    const at = d.handle ? selectionHandlePoint(d.frame, d.handle) : null;
    onChange(d.handle && at ? resizeSelection(d.frame, d.handle, { x: at.x + dx, y: at.y + dy }, limit) : moveSelection(d.frame, dx, dy, limit));
  }
  function stop(event: PointerEvent<HTMLButtonElement>) {
    const d = drag.current; if (d?.id !== event.pointerId) return;
    drag.current = null; setMode(null);
    if (d.element.hasPointerCapture(d.id)) d.element.releasePointerCapture(d.id);
  }
  return <div ref={root} className="fm-selection" data-mode={mode ?? 'idle'}>
    {size.w > 0 && size.h > 0 && <div className="fm-selection__frame" role="group" aria-label={editable ? '테두리로 이동하고 손잡이로 크기를 조절하는 선택 범위' : '선택 범위'} tabIndex={editable ? 0 : undefined} data-editable={editable} style={{ left: `${frame.x * 100}%`, top: `${frame.y * 100}%`, width: `${frame.w * 100}%`, height: `${frame.h * 100}%` }} onKeyDown={event => {
      const step = event.shiftKey ? .04 : .01;
      const directions: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const d = directions[event.key]; if (!d || !editable) return; event.preventDefault(); event.stopPropagation();
      const handle = (event.target as HTMLElement).dataset.handle as SelectionHandle | undefined;
      if (handle) { const p = selectionHandlePoint(frame, handle); onChange(resizeSelection(frame, handle, { x: p.x + d[0], y: p.y + d[1] }, limit)); }
      else onChange(moveSelection(frame, d[0], d[1], limit));
    }}>
      {editable && edges.map(([edge, name]) => <button key={edge} type="button" className="fm-selection__edge" data-edge={edge} aria-label={`선택 범위 이동: ${name} 테두리`} title="테두리를 끌어 범위 이동" onPointerDown={e => start(e, null)} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} />)}
      {onCountPress && peopleCount !== null && peopleCount > 0
        ? <button type="button" className="fm-selection__count" data-pressable="true" aria-label={`${countLabel(peopleCount)}${countPressLabel ? ` · ${countPressLabel}` : ''}`} onClick={onCountPress}>{personIcon}<output aria-hidden="true">{peopleCount}</output></button>
        : <span className="fm-selection__count">{personIcon}<output aria-live="polite" aria-label={peopleCount === null ? '인원 미확인' : countLabel(peopleCount)}>{peopleCount ?? '—'}</output></span>}
      {editable && handles.map(handle => <button key={handle} type="button" className="fm-selection__handle" data-handle={handle} aria-label={`${labels[handle]} 크기 조절`} title="드래그하거나 방향키로 크기 조절" onPointerDown={e => start(e, handle)} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} />)}
    </div>}
  </div>;
}
