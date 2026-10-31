// 휴대폰·데스크톱 화면(/). 배치도 /dev/screens.html "휴대폰"·"데스크톱".
// 휴대폰: 후면 카메라 전체 화면 + HUD + 하단 시트. 데스크톱: 왼쪽 카메라+HUD, 오른쪽 탭, 아래 발표자 컨트롤.

import { useState } from 'react';
import { useLensStore } from '../core/store';
import type { InputKind } from '../core/types';
import { ConfirmScreen } from '../proof/ConfirmScreen';
import { LogSheet } from '../proof/LogSheet';
import { Hud } from './Hud';
import { useOutwardPublisher } from './outward';
import { PresenterBar } from './PresenterBar';
import { StartScreen } from './screens/StartScreen';
import { CameraFallbackNotice } from './screens/StatusPanels';
import { SidePanel, type SideTab } from './SidePanel';
import { unlockAudio } from './signal';
import { EngineGate, Stage } from './Stage';
import { TopBar } from './TopBar';
import { useLayoutMode } from './useLayoutMode';
import { useStoreTick } from './useSignals';

export function MainScreen({ autostart = false }: { autostart?: boolean }) {
  const layout = useLayoutMode();
  const selectInput = useLensStore((s) => s.selectInput);
  const [started, setStarted] = useState(autostart);
  const [tab, setTab] = useState<SideTab>('log');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [frameEditing, setFrameEditing] = useState(false);
  useStoreTick();
  // 바깥 표시(/outward)는 휴대폰·데스크톱 메인 창만 보낸다. /hud 창까지 보내면 두 값이 번갈아 보인다.
  useOutwardPublisher();

  if (!started) {
    const start = (kind: InputKind) => {
      unlockAudio();
      selectInput(kind);
      setStarted(true);
    };
    return <StartScreen layout={layout.mode} onStart={start} />;
  }

  if (layout.mode === 'desktop') {
    return (
      <div className="fm-desk">
        <section className="fm-desk__stage" aria-label="카메라와 HUD">
          <Stage>
            <div className="fm-hud-guide" aria-hidden="true" />
            <EngineGate
              ready={
                <Hud variant="desktop" onOpenConfirm={() => setTab('confirm')} frameEditing={frameEditing} onFrameEditing={setFrameEditing} />
              }
            />
            <TopBar layout={layout} />
            <CameraFallbackNotice />
          </Stage>
        </section>
        <div className="fm-desk__presenter">
          <PresenterBar />
        </div>
        <aside className="fm-desk__side fm-glass fm-glass--panel" aria-label="증명 로그와 설정">
          <SidePanel tab={tab} onTab={setTab} />
        </aside>
      </div>
    );
  }

  return (
    <div className="fm-phone" data-frame-editing={frameEditing}>
      <Stage className="fm-phone__stage">
        <EngineGate
          ready={
            <Hud variant="phone" onOpenConfirm={() => setConfirmOpen(true)} frameEditing={frameEditing} onFrameEditing={setFrameEditing} />
          }
        />
        <TopBar layout={layout} />
        <CameraFallbackNotice />
      </Stage>
      <LogSheet onOpenConfirm={() => setConfirmOpen(true)} />
      {confirmOpen && (
        <div className="fm-overlay" role="dialog" aria-modal="true" aria-label="플러그인 확인 화면">
          <div className="fm-overlay__panel fm-glass fm-glass--panel">
            <ConfirmScreen onClose={() => setConfirmOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
