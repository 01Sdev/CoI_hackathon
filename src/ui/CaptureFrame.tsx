// 전송 범위 프레임(F24·F24a, FR-061). 흰색 뷰파인더 틀이고, 틀 밖 픽셀은 어떤 플러그인에도 가지 않는다(자르기는 A).
// 소스 0~1 → 화면 px 변환은 대상 위치(targetBox)와 같은 cover 변환이다. 틀 밖은 살짝 어둡게 해서 보내는 범위를 보인다.
// 조절: 크기 표시를 누르면 조절 모드가 되고 네 꼭짓점을 끈다(터치·마우스·화살표 키). 끌기 규칙은 core dragCorner
// (맞은편 꼭짓점 고정, 0~1 안, 최소 0.1에서 멈춤)이고, 끄는 동안 미리 보인 뒤 손을 떼면 setCaptureFrame으로 한 번 쓴다. A는 포착을 시작할 때 한 번 읽는다. 틀 위에서는 스크롤·확대를 막는다(touch-action: none).
// /hud는 틀만 그린다(어둡게 하지 않음, 조절 없음).

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { frameToPx, type FrameCorner } from '../core/frame';
import { useLensStore } from '../core/store';
import type { Box } from '../core/types';
import { coverBox, cornerPoint, dragCornerFromScreen, nudgeCorner, type Size } from './geometry';

const CORNERS: FrameCorner[] = ['tl', 'tr', 'bl', 'br'];
const CORNER_LABEL: Record<FrameCorner, string> = { tl: '왼쪽 위', tr: '오른쪽 위', bl: '왼쪽 아래', br: '오른쪽 아래' };
/** 화살표 키 한 번에 옮기는 양(소스 0~1). */
const KEY_STEP = 0.02;

export function CaptureFrame({
  size,
  adjustable,
  editing = false,
  onEditing,
}: {
  size: Size;
  /** 휴대폰·데스크톱은 true, /hud는 false. */
  adjustable: boolean;
  editing?: boolean;
  onEditing?: (on: boolean) => void;
}) {
  const v = useLensStore(
    useShallow((s) => ({
      frame: s.session.captureFrame,
      srcW: s.session.input?.width ?? 0,
      srcH: s.session.input?.height ?? 0,
    })),
  );
  const setCaptureFrame = useLensStore((s) => s.setCaptureFrame);
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ corner: FrameCorner; start: Box; pointerId: number } | null>(null);
  const [draft, setDraft] = useState<Box | null>(null);

  if (size.w === 0) return null;
  const src = v.srcW > 0 ? { w: v.srcW, h: v.srcH } : null;
  const shown = draft ?? v.frame;
  const r = coverBox(shown, src, size);
  const px = src ? frameToPx(shown, src.w, src.h) : null;
  const sizeText = px ? `${px.w}×${px.h}` : `${Math.round(shown.w * 100)}%×${Math.round(shown.h * 100)}%`;

  const onDown = (corner: FrameCorner) => (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { corner, start: v.frame, pointerId: e.pointerId };
  };
  const onMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const box = rootRef.current!.getBoundingClientRect();
    setDraft(dragCornerFromScreen(d.start, d.corner, { x: e.clientX - box.left, y: e.clientY - box.top }, src, size));
  };
  const onUp = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (draft) setCaptureFrame(draft);
    setDraft(null);
  };
  const onKey = (corner: FrameCorner) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const dx = e.key === 'ArrowLeft' ? -KEY_STEP : e.key === 'ArrowRight' ? KEY_STEP : 0;
    const dy = e.key === 'ArrowUp' ? -KEY_STEP : e.key === 'ArrowDown' ? KEY_STEP : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    setCaptureFrame(nudgeCorner(v.frame, corner, dx, dy));
  };

  return (
    <div ref={rootRef} className="fm-capture" data-adjustable={adjustable} data-editing={editing}>
      <div className="fm-capture__rect" style={{ left: r.left, top: r.top, width: r.width, height: r.height }} aria-hidden="true" />
      {adjustable && (
        <button
          type="button"
          className="fm-capsule fm-glass fm-glass--panel fm-capture__label"
          style={{ left: r.left + 10, top: r.top + 10 }}
          aria-pressed={editing}
          onClick={() => onEditing?.(!editing)}
        >
          {editing ? '조절 끝내기' : '전송 범위'}
          <span className="fm-readout">{editing ? '꼭짓점을 끄세요' : `${sizeText} · 조절`}</span>
        </button>
      )}
      {adjustable &&
        editing &&
        CORNERS.map((c) => {
          const at = cornerPoint(shown, c);
          const pos = coverBox({ x: at.x, y: at.y, w: 0, h: 0 }, src, size);
          return (
            <button
              key={c}
              type="button"
              className="fm-capture__handle"
              data-corner={c}
              style={{ left: pos.left, top: pos.top }}
              aria-label={`전송 범위 ${CORNER_LABEL[c]} 꼭짓점. 화살표 키로 옮김. 지금 ${sizeText}`}
              onPointerDown={onDown(c)}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onKeyDown={onKey(c)}
            />
          );
        })}
    </div>
  );
}
