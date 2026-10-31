// 카메라 무대: 미리보기 + 옅은 주사선 + 엔진 상태에 따른 위층(로딩·실패·HUD).

import type { ReactNode } from 'react';
import { useLensStore } from '../core/store';
import { Preview } from './Preview';
import { EngineFailPanel, LoadingPanel } from './screens/StatusPanels';
import { useEngineView } from './useEngineView';

export function Stage({ children, className = '' }: { children?: ReactNode; className?: string }) {
  // 비교 모드 띠가 위에 붙으면 위쪽 줄·장면이 띠 높이만큼 내려간다(app.css).
  const compare = useLensStore((s) => s.session.compareMode);
  return (
    <div className={`fm-stage ${className}`} data-compare={compare}>
      <Preview />
      <div className="fm-stage__lines fm-scanlines" aria-hidden="true" />
      {children}
    </div>
  );
}

/** 엔진이 준비되기 전에는 로딩, 실패하면 전달 정지 안내, 준비되면 ready(HUD). */
export function EngineGate({ ready }: { ready: ReactNode }) {
  const engine = useEngineView();
  if (engine === 'failed') return <EngineFailPanel />;
  if (engine !== 'ready') return <LoadingPanel />;
  return <>{ready}</>;
}
