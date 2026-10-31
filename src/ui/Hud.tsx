// 글래스 HUD 한 컴포넌트(F8, FR-034·036). 세 화면에 같은 컴포넌트를 쓰고 배치만 variant로 바꾼다.
// framelet이 카메라 위에 그리는 것은 흰 전송 범위 틀(F24)과 그 오른쪽 위 가장자리의 사람 아이콘·숫자(카운터 M) 하나뿐이다
// (사용자 결정 2026-11-01). 앱 결과는 플러그인 종류마다 호스트가 고른 화면이 그린다(PluginViews.tsx).
// 요소 밖: 비교 모드 띠, 일시 정지 알림, 전달 테두리 점멸(F9). 보류는 HUD에 띄우지 않고 기록에만 남긴다.
// 휴대폰·데스크톱의 입력은 위쪽 줄 입력 캡슐(TopBar)이다. 사람에게는 박스나 표시를 그리지 않는다(사용자 결정).

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { selectFaceM } from '../core/selectors';
import { useLensStore } from '../core/store';
import { CaptureFrame } from './CaptureFrame';
import type { Size } from './geometry';
import { PluginViews } from './PluginViews';
import { useDeliverySignal } from './useSignals';

export type HudVariant = 'phone' | 'desktop' | 'hud';

export function Hud({
  variant,
  onOpenConfirm,
  frameEditing,
  onFrameEditing,
}: {
  variant: HudVariant;
  onOpenConfirm?: () => void;
  /** 전송 범위 프레임 조절 중(휴대폰은 이때 하단 시트를 내린다). */
  frameEditing?: boolean;
  onFrameEditing?: (on: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useElementSize(ref);
  const compare = useLensStore((s) => s.session.compareMode);
  const paused = useLensStore((s) => s.session.paused);
  const delivery = useDeliverySignal();
  const glass = variant !== 'hud';

  return (
    <div ref={ref} className="fm-hud" data-variant={variant} data-signals={delivery.count}>
      <CaptureFrame
        size={size}
        adjustable={glass}
        editing={frameEditing}
        onEditing={onFrameEditing}
        badge={<PersonCount onOpenConfirm={onOpenConfirm} />}
      />
      <PluginViews size={size} />
      {compare && (
        <div className={glass ? 'fm-band fm-hud__band' : 'fm-band fm-band--line fm-hud__band'} role="status">
          {glass ? '비교 모드 · 원본 전체가 칼로리에 갑니다 · 통신은 막혀 있음' : '비교 모드'}
        </div>
      )}
      {paused && (
        <div className="fm-hud__paused">
          <span className={glass ? 'fm-capsule fm-glass fm-glass--panel' : 'fm-capsule fm-label'} data-tone="hold" role="status">
            <span className="fm-dot" aria-hidden="true" />
            전달 일시 정지 · 아무것도 보내지 않음
          </span>
        </div>
      )}
      {delivery.count > 0 && <div key={`flash-${delivery.count}`} className="fm-hud__flash fm-flash" aria-hidden="true" />}
    </div>
  );
}

function useElementSize(ref: RefObject<HTMLElement>): Size {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 처음 크기는 바로 읽는다. ResizeObserver는 다음 렌더링 단계에서야 불리고, 보이지 않는 탭에서는 불리지 않는다.
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * 카운터(FR-035): 선 사람 아이콘 + M. 평소에는 틀과 같은 흰색, M ≥ 1이면 주황이고 누르면 확인 화면이다(FR-038).
 * 화면에 보이는 것은 아이콘과 숫자뿐이고, 읽기 프로그램에는 "앱에 반영된 사람 M명"으로 읽힌다.
 */
function PersonCount({ onOpenConfirm }: { onOpenConfirm?: () => void }) {
  const m = useLensStore((s) => selectFaceM(s));
  const exposed = m > 0;
  const body = (
    <>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-1a8 8 0 0 1 16 0v1" />
      </svg>
      <span className="fm-visually-hidden">앱에 반영된 사람 </span>
      <span className="fm-num">{m}</span>
      <span className="fm-visually-hidden">명</span>
    </>
  );
  if (exposed && onOpenConfirm)
    return (
      <button type="button" className="fm-person" data-tone="exposed" onClick={onOpenConfirm}>
        {body}
        <span className="fm-visually-hidden"> · 확인 화면 열기</span>
      </button>
    );
  return (
    <span className="fm-person" data-tone={exposed ? 'exposed' : undefined} role="status">
      {body}
    </span>
  );
}
