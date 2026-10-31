// 메인 화면(/). 휴대폰 웹은 스마트 글래스가 없어 그 시야를 휴대폰 브라우저로 그대로 흉내 내는 화면이다(앱 화면이 아니다).
// 기본은 글래스 흐름(GlassFlow): 카메라 허용 → AR 홈 → framelet 런처 → 고른 앱의 글래스 HUD(#44 흰 틀, 플러그인 화면, 코디 스캔).
// 휴대폰·데스크톱 모두 같다(사용자 요구 2026-11-01, docs/designs/glass-home.md. 플랫폼은 #44를 따른다).
// ?tools를 붙이면 예전 시작 화면과 도구 배치(위쪽 줄·하단 시트, 데스크톱은 오른쪽 탭·발표자 컨트롤)를 보인다. 기록·확인 화면·앱 관리·비교 모드는 거기 있다.

import { useState } from 'react';
import { useLensStore } from '../core/store';
import type { InputKind } from '../core/types';
import { ConfirmScreen } from '../proof/ConfirmScreen';
import { GlassFlow } from './GlassFlow';
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

/** 예전 도구 배치를 보일지(?tools). 시연 기본 화면에는 글래스 시야만 둔다. */
const TOOLS = typeof location !== 'undefined' && new URLSearchParams(location.search).has('tools');

export function MainScreen({ autostart = false }: { autostart?: boolean }) {
  const layout = useLayoutMode();
  const selectInput = useLensStore((s) => s.selectInput);
  const [started, setStarted] = useState(autostart);
  const [tab, setTab] = useState<SideTab>('log');
  const [confirmOpen, setConfirmOpen] = useState(false);
  useStoreTick();
  // 바깥 표시(/outward)는 휴대폰·데스크톱 메인 창만 보낸다. /hud 창까지 보내면 두 값이 번갈아 보인다.
  useOutwardPublisher();

  if (!TOOLS) return <GlassFlow layout={layout.mode} autostart={autostart} />;

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
ready={<Hud variant="desktop" />}
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
    <div className="fm-phone">
      <Stage className="fm-phone__stage">
        <EngineGate
ready={<Hud variant="phone" />}
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
