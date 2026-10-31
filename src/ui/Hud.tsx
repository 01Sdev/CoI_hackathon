// 글래스 시야 HUD 한 컴포넌트(F8, FR-034·036). 휴대폰 웹은 스마트 글래스 시야를 그대로 흉내 내는 화면이다(앱 화면이 아니다).
// framelet이 카메라 위에 그리는 것은 #44 흰 틀과 그 오른쪽 위 사람 아이콘·숫자(동의한 사람 수)뿐이다(사용자 결정 2026-11-01).
// 코디 스캔: 응시 대상 위 "마스크 해제" 칩(GazeChip), 동의가 살아 있으면 시야 아래 말 막대와 오른쪽 가장자리 질문·답 패널(OutfitTalk).
// 앱 결과는 플러그인 종류마다 호스트가 고른 화면이 그린다(PluginViews.tsx). 요소 밖: 비교 모드 띠, 일시 정지 알림, 전달 테두리 점멸(F9).
// 사람에게는 박스나 표시를 그리지 않는다(사용자 결정). 칩은 상자 위쪽 바깥에 뜨는 버튼 하나다.

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useLensStore } from '../core/store';
import { CaptureFrame } from './CaptureFrame';
import { GazeChip } from './GazeChip';
import type { Size } from './geometry';
import { OutfitTalk } from './OutfitTalk';
import { PluginViews } from './PluginViews';
import { useDeliverySignal } from './useSignals';

export type HudVariant = 'phone' | 'desktop' | 'hud';

export function Hud({ variant }: { variant: HudVariant }) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useElementSize(ref);
  const compare = useLensStore((s) => s.session.compareMode);
  const paused = useLensStore((s) => s.session.paused);
  const delivery = useDeliverySignal();
  const glass = variant !== 'hud';

  return (
    <div ref={ref} className="fm-hud" data-variant={variant} data-signals={delivery.count}>
      <CaptureFrame size={size} adjustable={glass} />
      <PluginViews size={size} />
      {glass && <GazeChip size={size} />}
      {glass && <OutfitTalk />}
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
