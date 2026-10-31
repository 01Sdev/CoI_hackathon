// 처리량 패널(F16, FR-046)과 3단계 안내(F19). 데스크톱 오른쪽 "처리량" 탭.
// 숫자는 selectThroughput(직전 60초 합)과 Counter 그대로다. 배터리 수치는 보이지 않는다.
// 스파크라인은 화면이 1초마다 숫자를 받아 적은 기록(최근 60개, 숫자만)이고, 스토어에 남기지 않는다.
// 기업 서버 재검사는 켜는 토글 없이 비활성 "미구현" 안내만 둔다. 요청을 만들지 않는다.

import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { THROUGHPUT_WINDOW_MS } from '../core/constants';
import { selectThroughput } from '../core/selectors';
import { lensStore, useLensStore } from '../core/store';

const SAMPLES = 60;
const BINS = 12;

function useHistory(): { stage0: number[]; face: number[] } {
  const [h, setH] = useState<{ stage0: number[]; face: number[] }>({ stage0: [], face: [] });
  useEffect(() => {
    const take = () => {
      const t = selectThroughput(lensStore.getState());
      setH((p) => ({ stage0: [...p.stage0, t.stage0Runs].slice(-SAMPLES), face: [...p.face, t.faceDetectRuns].slice(-SAMPLES) }));
    };
    take();
    const id = window.setInterval(take, 1000);
    return () => window.clearInterval(id);
  }, []);
  return h;
}

/** 직전 60초를 5초 칸 12개로 나눈 전달·보류 수(그림용). */
function useBins(now: number): { deliveries: number[]; holds: number[] } {
  const records = useLensStore((s) => s.counter.window60s);
  const deliveries = new Array<number>(BINS).fill(0);
  const holds = new Array<number>(BINS).fill(0);
  const span = THROUGHPUT_WINDOW_MS / BINS;
  for (const r of records) {
    const age = now - r.at;
    if (age < 0 || age >= THROUGHPUT_WINDOW_MS) continue;
    const i = BINS - 1 - Math.floor(age / span);
    deliveries[i]! += r.deliveries;
    holds[i]! += r.holds;
  }
  return { deliveries, holds };
}

function Spark({ values, stroke = 'var(--fm-lens)', label }: { values: number[]; stroke?: string; label: string }) {
  const max = Math.max(1, ...values);
  const n = Math.max(2, values.length);
  const pts = values.map((v, i) => `${((i / (n - 1)) * 200).toFixed(1)},${(44 - (v / max) * 38).toFixed(1)}`).join(' ');
  return (
    <svg className="fm-spark" viewBox="0 0 200 48" preserveAspectRatio="none" role="img" aria-label={label}>
      {values.length > 1 && <polyline fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" points={pts} />}
    </svg>
  );
}

function Bars({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values);
  return (
    <svg className="fm-spark" viewBox="0 0 240 48" preserveAspectRatio="none" role="img" aria-label={label}>
      {values.map((v, i) => (
        <rect key={i} x={i * 20 + 4} y={46 - (v / max) * 40} width="12" height={(v / max) * 40} rx="2" fill="var(--fm-text)" />
      ))}
    </svg>
  );
}

export function ThroughputPanel() {
  const t = useLensStore(useShallow((s) => selectThroughput(s)));
  const sends = useLensStore(useShallow((s) => ({ raw: s.counter.rawServerSends, api: s.counter.apiSends })));
  const history = useHistory();
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(performance.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const bins = useBins(now);
  const ratio = t.ratio;

  return (
    <div className="fm-throughput">
      <div className="fm-grid3">
        <div className="fm-metric fm-glass fm-grid">
          <span className="fm-kicker">0단계 판정</span>
          <span className="fm-metric__v">
            {t.stage0Runs}
            <span className="fm-readout"> /분</span>
          </span>
          <Spark values={history.stage0} label="0단계 판정 수 추이" />
        </div>
        <div className="fm-metric fm-glass fm-grid">
          <span className="fm-kicker">얼굴 검출</span>
          <span className="fm-metric__v">
            {t.faceDetectRuns}
            <span className="fm-readout"> /분</span>
          </span>
          <Spark values={history.face} label="얼굴 검출 수 추이" />
        </div>
        <div className="fm-metric fm-glass fm-grid">
          <span className="fm-kicker">모델 호출 비율</span>
          <span className="fm-metric__v">{ratio === null ? '–' : ratio.toFixed(2)}</span>
          <div className="fm-bar">
            <i style={{ width: `${Math.min(100, (ratio ?? 0) * 100)}%` }} />
          </div>
          <span className="fm-readout">매 프레임 두 모델 = 1.00 · 입력 {t.sourceFrames}프레임</span>
        </div>
      </div>
      <div className="fm-grid3">
        <div className="fm-metric fm-glass" data-tone={sends.raw === 0 ? 'safe' : 'blocked'}>
          <span className="fm-kicker">원본 서버 전송</span>
          <span className="fm-metric__v fm-metric__v--tone">
            {sends.raw}
            <span className="fm-readout">건</span>
          </span>
        </div>
        <div className="fm-metric fm-glass">
          <span className="fm-kicker">가린 조각 API 전송</span>
          <span className="fm-metric__v">
            {sends.api}
            <span className="fm-readout">건 · 플러그인 자기 보고</span>
          </span>
        </div>
        <div className="fm-metric fm-glass" aria-disabled="true" data-off="true">
          <span className="fm-kicker">기업 서버 재검사</span>
          <span className="fm-metric__v fm-metric__v--sm">미구현</span>
          <span className="fm-readout">켜는 토글 없음 · 요청 0건(F19)</span>
        </div>
      </div>
      <div className="fm-metric fm-glass fm-grid">
        <span className="fm-kicker">
          직전 60초 · 전달 {t.deliveries} · 보류 {t.holds}
        </span>
        <Bars values={bins.deliveries} label="5초 칸별 전달 수" />
      </div>
      <p className="fm-readout fm-side__note">60초 창의 합 · 1초마다 다시 셈 · 배터리 수치는 재지 않습니다</p>
    </div>
  );
}
