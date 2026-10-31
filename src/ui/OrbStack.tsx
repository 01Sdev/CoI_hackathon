// 카운터 오브 + 캡션 캡슐 + 결과 캡슐. 상태색 글자는 오브의 큰 숫자에만 쓰고, 캡션은 Text 색 + 상태 점이다(design-system §2).

import type { CSSProperties, ReactNode, Ref } from 'react';

export type Tone = 'safe' | 'exposed' | 'blocked' | 'hold';

export function OrbStack({
  value,
  tone,
  caption,
  badge,
  result,
  orbRef,
  onOrbClick,
  orbLabel,
}: {
  value: ReactNode;
  tone: Tone;
  caption: ReactNode;
  /** 오브 옆 배지(차단 수). 오브 숫자와 섞지 않는다. */
  badge?: ReactNode;
  result?: ReactNode;
  orbRef?: Ref<HTMLDivElement>;
  /** M ≥ 1이면 확인 화면으로 이어진다(FR-038). */
  onOrbClick?: () => void;
  orbLabel?: string;
}) {
  const orb = (
    <div ref={orbRef} className="fm-orb fm-glass fm-glass--panel" data-tone={tone} style={{ '--orb': 'var(--fm-orb-size)' } as CSSProperties}>
      {value}
    </div>
  );
  return (
    <div className="fm-orbstack">
      <div className="fm-orbstack__orb">
        {onOrbClick ? (
          <button type="button" className="fm-orb-btn" onClick={onOrbClick} aria-label={orbLabel}>
            {orb}
          </button>
        ) : (
          orb
        )}
        {badge}
      </div>
      <div className="fm-orbstack__row">
        <span className="fm-capsule fm-glass fm-glass--panel" data-tone={tone}>
          <span className="fm-dot" aria-hidden="true" />
          {caption}
        </span>
        {result}
      </div>
    </div>
  );
}
