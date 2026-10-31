// 휴대폰·데스크톱 화면(/). 배치도 /dev/screens.html "휴대폰"·"데스크톱".
// 휴대폰: 후면 카메라 전체 화면 + HUD + 하단 시트. 데스크톱: 왼쪽 카메라+HUD, 오른쪽 탭, 아래 발표자 컨트롤.

import { useState } from 'react';
import { useLensStore } from '../core/store';
import type { InputKind } from '../core/types';
import { Hud } from './Hud';
import { StartScreen } from './screens/StartScreen';
import { CameraFallbackNotice } from './screens/StatusPanels';
import { unlockAudio } from './signal';
import { EngineGate, Stage } from './Stage';
import { TopBar } from './TopBar';
import { useLayoutMode } from './useLayoutMode';
import { useStoreTick } from './useSignals';

export function MainScreen({ autostart = false }: { autostart?: boolean }) {
  const layout = useLayoutMode();
  const selectInput = useLensStore((s) => s.selectInput);
  const [started, setStarted] = useState(autostart);
  useStoreTick();

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
            <EngineGate ready={<Hud variant="desktop" />} />
            <TopBar layout={layout} />
            <CameraFallbackNotice />
          </Stage>
        </section>
        <div className="fm-desk__presenter" />
        <aside className="fm-desk__side fm-glass fm-glass--panel" aria-label="증명 로그와 설정" />
      </div>
    );
  }

  return (
    <div className="fm-phone">
      <Stage className="fm-phone__stage">
        <EngineGate ready={<Hud variant="phone" />} />
        <TopBar layout={layout} />
        <CameraFallbackNotice />
      </Stage>
    </div>
  );
}
