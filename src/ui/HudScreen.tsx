// 글래스 HUD(/hud): 600×600 단독, 검은 배경(가산형 디스플레이에서 투명), 항상 다크, 입력은 녹화 영상(FR-037).
// 화면이 600보다 작으면 비례 축소한다(K-14). 시작은 선택 버튼(Enter)이나 탭 한 번 — 오디오 잠금 해제에 제스처가 필요하다.

import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { APP_NAME } from '../core/constants';
import { useLensStore } from '../core/store';
import { unlockAudio } from './signal';
import { applyTheme } from './theme';
import { useElapsedSeconds, useEngineView } from './useEngineView';

const SIZE = 600;

function useFitScale(): number {
  const fit = () => Math.min(1, window.innerWidth / SIZE, window.innerHeight / SIZE);
  const [scale, setScale] = useState(fit);
  useEffect(() => {
    const on = () => setScale(fit());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return scale;
}

export function HudScreen({ autostart = false, children }: { autostart?: boolean; children?: ReactNode }) {
  const setViewMode = useLensStore((s) => s.setViewMode);
  const selectInput = useLensStore((s) => s.selectInput);
  const [started, setStarted] = useState(autostart);
  const scale = useFitScale();

  useLayoutEffect(() => {
    const root = document.documentElement;
    applyTheme('dark', false);
    root.dataset.view = 'hud';
    return () => {
      delete root.dataset.view;
    };
  }, []);
  useEffect(() => setViewMode('hud'), [setViewMode]);

  useEffect(() => {
    if (started) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') start();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function start() {
    unlockAudio();
    selectInput('video');
    setStarted(true);
  }

  return (
    <div className="fm-hudroute">
      <div className="fm-hudroute__frame" style={{ transform: `scale(${scale})` }}>
        {started ? <HudGate>{children}</HudGate> : <HudStart onStart={start} />}
      </div>
    </div>
  );
}

function HudStart({ onStart }: { onStart(): void }) {
  return (
    <button type="button" className="fm-hudstart" onClick={onStart}>
      <span className="fm-scene">{APP_NAME}</span>
      <span className="fm-result">선택 버튼으로 시작</span>
      <span className="fm-caption">입력: 녹화 영상</span>
    </button>
  );
}

/** /hud의 로딩·실패는 큰 글자 한두 줄만(본문 24px 이상). */
function HudGate({ children }: { children?: ReactNode }) {
  const engine = useEngineView();
  const sec = useElapsedSeconds();
  if (engine === 'ready') return <>{children}</>;
  const failed = engine === 'failed';
  return (
    <div className="fm-hudstart" role={failed ? 'alert' : 'status'}>
      <span className="fm-scene">{failed ? '판정 엔진 실패' : '판정 모델 받는 중'}</span>
      <span className="fm-result">{failed ? '전달 멈춤 · 아무것도 보내지 않습니다' : `${sec}초 · 아직 보낸 것 없음`}</span>
    </div>
  );
}
