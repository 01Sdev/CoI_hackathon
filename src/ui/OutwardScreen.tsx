// 바깥 표시(/outward, F15, FR-044·045). 찍히는 사람을 향한 화면. 스토어 없이 IF-07 BroadcastChannel만 듣는다.
// 같은 브라우저의 창끼리만 동기화된다(심사위원 폰과는 연결되지 않음, M-21).
// 0이면 초록, 1 이상이면 주황. 신호가 5초 넘게 없으면 낡은 숫자로 거짓 안심을 주지 않도록 회색 "–".

import { useEffect, useState } from 'react';
import { APP_NAME, OUTWARD_CHANNEL } from '../core/constants';
import type { OutwardMessage } from '../core/messages';
import { outwardView, parseOutwardMessage } from './outward';

export function OutwardScreen() {
  const [last, setLast] = useState<OutwardMessage | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(OUTWARD_CHANNEL);
    ch.onmessage = (e: MessageEvent) => {
      const m = parseOutwardMessage(e.data);
      if (m) setLast(m);
    };
    return () => ch.close();
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);

  const view = outwardView(last, now);
  const live = view.state === 'live';
  const apps = live ? view.last.apps : null;
  const tone = apps === null ? undefined : apps > 0 ? 'exposed' : 'safe';

  let kicker = `${APP_NAME} · outward`;
  let sub = '최근 10초 기준 · 메인 창과 동기화됨';
  if (view.state === 'pending') {
    kicker = 'connection pending';
    sub = '메인 창 신호를 기다리는 중';
  } else if (view.state === 'stale') {
    kicker = 'connection lost';
    sub = '메인 창 신호가 5초 넘게 없습니다';
  } else if (view.last.compareMode) {
    sub = apps && apps > 0 ? '비교 모드 · 끄면 10초 안에 0으로 돌아갑니다' : '비교 모드 켜짐 · 최근 10초 기준';
  } else if (apps && apps > 0) {
    sub = '비교 모드 꺼짐 · 10초 안에 0으로 돌아갑니다';
  }

  return (
    <main className="fm-outward" data-state={view.state} data-tone={tone} aria-live="polite">
      <span className="fm-kicker fm-outward__kicker">{kicker}</span>
      <h1 className="fm-outward__title">지금 당신의 얼굴을 본 앱</h1>
      <div className="fm-outward__num fm-num" aria-label={apps === null ? '알 수 없음' : `${apps}개`}>
        {apps === null ? '–' : apps}
        {apps !== null && <span className="fm-outward__unit">개</span>}
      </div>
      <div className="fm-readout fm-outward__sub">{sub}</div>
    </main>
  );
}
