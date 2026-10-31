// 사용 기록(F25, FR-064): "OO 플러그인에서 사용됨 · 시각 · 대상 · 바이트 · 프레임 W×H". 휴대폰 하단 시트의 한 화면.
// 줄은 이미지 없는 Counter.usage에서 만든다. 화면 로그 100건이 밀려나도 세션 동안 남는다.
// 대표 조각은 usageSamples(앱마다 최근 3장)이고, 가린 뒤의 조각(2a·2b·2c)만 있다. raw(비교 모드 원본)는 스토어가 넣지 않는다.
// 플러그인 이름은 텍스트 노드로만 넣는다.

import { useShallow } from 'zustand/react/shallow';
import { USAGE_SAMPLES_PER_PLUGIN } from '../core/constants';
import { useLensStore } from '../core/store';
import { PLUGIN_NAME } from '../ui/labels';
import { usageMeta, wallClock } from './format';
import { useNow } from './ProofLog';

export function UsageHistory() {
  const usage = useLensStore((s) => s.counter.usage);
  const samples = useLensStore((s) => s.usageSamples);
  const order = useLensStore(useShallow((s) => s.pluginOrder));
  const kinds = useLensStore(useShallow((s) => Object.fromEntries(s.pluginOrder.map((id) => [id, s.plugins[id]?.kind ?? null]))));
  const perfNow = useNow();
  const dateNow = Date.now() - (performance.now() - perfNow);
  const nameOf = (id: string) => {
    const k = kinds[id];
    return k ? PLUGIN_NAME[k] : id;
  };
  const sampled = order.filter((id) => (samples[id]?.length ?? 0) > 0);

  return (
    <section className="fm-usage" aria-label="사용 기록">
      <p className="fm-readout fm-usage__note">
        이 세션에서 앱이 받은 기록 {usage.length}건 · 새로고침하거나 새 세션을 시작하면 지웁니다
      </p>

      <span className="fm-kicker fm-usage__head">samples</span>
      {sampled.length === 0 ? (
        <p className="fm-readout fm-usage__note">아직 남긴 조각이 없습니다</p>
      ) : (
        sampled.map((id) => (
          <div key={id} className="fm-usage__samples">
            <span className="fm-label">{nameOf(id)}</span>
            <ul className="fm-usage__thumbs">
              {[...samples[id]!].reverse().map((x) => (
                <li key={x.deliveryId} className="fm-thumb">
                  <img src={x.thumbnailRef} alt="" />
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      <p className="fm-readout fm-usage__note">
        가린 뒤의 조각만 앱마다 최근 {USAGE_SAMPLES_PER_PLUGIN}장 남깁니다 · 비교 모드의 원본 전체는 남기지 않습니다
      </p>

      <span className="fm-kicker fm-usage__head">usage</span>
      {usage.length === 0 ? (
        <p className="fm-empty fm-readout">아직 어떤 앱도 데이터를 받지 않았습니다</p>
      ) : (
        <ol className="fm-log">
          {[...usage].reverse().map((r) => (
            <li key={r.deliveryId} className="fm-usage__row fm-glass">
              <span className="fm-label">{nameOf(r.pluginId)} 플러그인에서 사용됨</span>
              <span className="fm-readout">{usageMeta(r, wallClock(r.at, perfNow, dateNow))}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
