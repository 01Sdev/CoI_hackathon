// 착용자 제어(F22, FR-058): 휴대폰 하단 시트의 "전달 일시 정지"와 앱별 끄기.
// 발표자 화면(F20)과 같은 스토어 상태를 쓴다: setPaused(selectCanSend가 막음), setPluginEnabled(끄면 B가 그 앱의 iframe을 종료).
// 이미 보낸 데이터는 되돌릴 수 없으므로 그 사실을 같이 보인다.

import { useShallow } from 'zustand/react/shallow';
import { useLensStore } from '../core/store';
import { PLUGIN_NAME, PLUGIN_STATUS } from './labels';

/** 시트 머리의 빠른 일시 정지 버튼. */
export function PauseButton() {
  const paused = useLensStore((s) => s.session.paused);
  const setPaused = useLensStore((s) => s.setPaused);
  return (
    <button type="button" className="fm-btn fm-btn--sm fm-glass fm-pause" aria-pressed={paused} onClick={() => setPaused(!paused)}>
      {paused && <span className="fm-dot" data-tone="hold" aria-hidden="true" />}
      {paused ? '다시 전달' : '전달 일시 정지'}
    </button>
  );
}

export function WearerControls() {
  const paused = useLensStore((s) => s.session.paused);
  const setPaused = useLensStore((s) => s.setPaused);
  const ids = useLensStore(useShallow((s) => s.pluginOrder));
  return (
    <section className="fm-wearer" aria-label="착용자 제어">
      <div className="fm-wearer__row">
        <span className="fm-wearer__text">
          <span className="fm-label">전달 일시 정지</span>
          <span className="fm-readout">{paused ? '지금 어떤 앱에도 보내지 않습니다' : '켜면 모든 앱에 보내지 않습니다'}</span>
        </span>
        <label className="fm-switch">
          <input type="checkbox" role="switch" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
          <span aria-hidden="true" />
          <span className="fm-visually-hidden">전달 일시 정지</span>
        </label>
      </div>
      <span className="fm-kicker fm-wearer__head">apps</span>
      {ids.map((id) => (
        <AppRow key={id} id={id} />
      ))}
      <p className="fm-readout fm-wearer__note" role="note">
        이미 받은 데이터는 회수하지 않습니다. 끄면 그 앱을 종료하고 다음부터 보내지 않습니다.
      </p>
    </section>
  );
}

function AppRow({ id }: { id: string }) {
  const p = useLensStore(
    useShallow((s) => {
      const x = s.plugins[id];
      return { kind: x?.kind, status: x?.status ?? 'terminated', enabled: x?.enabled ?? false, purpose: x?.manifest.purpose ?? '' };
    }),
  );
  const setEnabled = useLensStore((s) => s.setPluginEnabled);
  const [label, tone] = PLUGIN_STATUS[p.status];
  const name = p.kind ? PLUGIN_NAME[p.kind] : id;
  return (
    <div className="fm-wearer__row" data-tone={tone}>
      <span className="fm-wearer__text">
        <span className="fm-label">
          <span className="fm-dot" aria-hidden="true" />
          {name}
        </span>
        <span className="fm-readout">
          {label} · {p.purpose}
        </span>
      </span>
      <label className="fm-switch">
        <input type="checkbox" role="switch" checked={p.enabled} onChange={(e) => setEnabled(id, e.target.checked)} />
        <span aria-hidden="true" />
        <span className="fm-visually-hidden">{name} 켜기</span>
      </label>
    </div>
  );
}
