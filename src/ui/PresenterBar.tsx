// 발표자 컨트롤(F17·F20, FR-047). 데스크톱 화면에만 있다. 상태는 스토어에만 있으므로 새로고침하면 비교 모드·일시 정지가 꺼진다.
// 스위치·버튼은 스토어 의도만 바꾼다: setCompareMode(칼로리 게이트 닫기 → B가 connect 'none'으로 다시 만듦),
// setPaused(selectCanSend가 막음), startNewSession(모든 게이트 닫기·로그·Counter 비우기).
// 새 세션은 실수로 누르면 데모 숫자가 사라지므로 두 번 눌러야 한다.

import { useEffect, useState } from 'react';
import { useLensStore } from '../core/store';
import { INPUT_LABEL } from './labels';

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function PresenterBar() {
  const compare = useLensStore((s) => s.session.compareMode);
  const paused = useLensStore((s) => s.session.paused);
  const startedAt = useLensStore((s) => s.session.startedAt);
  const input = useLensStore((s) => s.session.input?.kind ?? null);
  const setCompareMode = useLensStore((s) => s.setCompareMode);
  const setPaused = useLensStore((s) => s.setPaused);
  const startNewSession = useLensStore((s) => s.startNewSession);
  const [armed, setArmed] = useState(false);
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(performance.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(t);
  }, [armed]);

  return (
    <div className="fm-presenter fm-glass fm-glass--panel" role="toolbar" aria-label="발표자 컨트롤">
      <span className="fm-kicker">발표자</span>
      <label className="fm-toggle">
        <span className="fm-switch fm-switch--exposed">
          <input type="checkbox" role="switch" checked={compare} onChange={(e) => setCompareMode(e.target.checked)} />
          <span aria-hidden="true" />
        </span>
        <span className="fm-label">비교 모드</span>
      </label>
      <button type="button" className="fm-btn fm-btn--sm fm-glass" aria-pressed={paused} onClick={() => setPaused(!paused)}>
        {paused ? '전달 다시 시작' : '전달 일시 정지'}
      </button>
      <button
        type="button"
        className="fm-btn fm-btn--sm fm-glass"
        data-armed={armed}
        onClick={() => {
          if (!armed) {
            setArmed(true);
            return;
          }
          setArmed(false);
          startNewSession();
        }}
      >
        {armed ? '한 번 더 누르면 새 세션' : '새 세션 시작'}
      </button>
      <button type="button" className="fm-btn fm-btn--sm fm-glass" onClick={() => window.open('/outward', 'famelet-outward', 'popup')}>
        바깥 표시 열기
      </button>
      <span className="fm-readout fm-presenter__meta">
        세션 {clock(now - startedAt)} · 입력 {input ? INPUT_LABEL[input] : '없음'}
      </span>
    </div>
  );
}
