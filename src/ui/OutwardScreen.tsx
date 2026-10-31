// 바깥 표시(/outward). 스토어 없이 IF-07 BroadcastChannel만 듣는 창이다. 동기화는 다음 PR에서 붙인다.

export function OutwardScreen() {
  return (
    <main className="fm-outward" data-stale="true">
      <span className="fm-kicker fm-outward__kicker">connection pending</span>
      <h1 className="fm-outward__title">지금 당신의 얼굴을 본 앱</h1>
      <div className="fm-outward__num fm-num">–</div>
      <div className="fm-readout fm-outward__sub">메인 창 신호를 기다리는 중</div>
    </main>
  );
}
