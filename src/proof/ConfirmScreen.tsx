// 플러그인 확인 화면(F12, FR-038): "이 플러그인이 본 것은 이 사진 N장뿐" + 썸네일 그리드.
// N = Counter 누적 전달 수(selectPluginTotals). 그리드 = 스토어에 남은 dispatched Delivery. 로그가 밀려나 지워진 것은 "외 k장"
// (selectEvictedCount), 비교 모드를 꺼서 썸네일만 해제된 raw는 "해제됨" 칸으로 둬서 그리드 칸 수 + k = N이 되게 한다.

import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { selectEvictedCount, selectPluginTotals } from '../core/selectors';
import { useLensStore } from '../core/store';
import { PLUGIN_NAME } from '../ui/labels';

export function ConfirmScreen({ onClose }: { onClose?: () => void }) {
  const ids = useLensStore(useShallow((s) => s.pluginOrder));
  const [picked, setPicked] = useState<string | null>(null);
  const withDeliveries = useLensStore(
    useShallow((s) => s.pluginOrder.filter((id) => selectPluginTotals(s, id).deliveries > 0)),
  );
  const pluginId = picked ?? withDeliveries[0] ?? ids[0] ?? null;
  if (!pluginId) return null;

  return (
    <section className="fm-confirm" aria-label="플러그인 확인 화면">
      {withDeliveries.length > 1 && (
        <div className="fm-seg" role="tablist">
          {withDeliveries.map((id) => (
            <PluginTab key={id} id={id} on={id === pluginId} onPick={setPicked} />
          ))}
        </div>
      )}
      <ConfirmBody pluginId={pluginId} />
      {onClose && (
        <div className="fm-confirm__actions">
          <button type="button" className="fm-btn fm-btn--primary" onClick={onClose}>
            닫기
          </button>
        </div>
      )}
    </section>
  );
}

function PluginTab({ id, on, onPick }: { id: string; on: boolean; onPick(id: string): void }) {
  const kind = useLensStore((s) => s.plugins[id]?.kind);
  return (
    <button type="button" role="tab" aria-selected={on} className="fm-seg__item" onClick={() => onPick(id)}>
      {kind ? PLUGIN_NAME[kind] : id}
    </button>
  );
}

function ConfirmBody({ pluginId }: { pluginId: string }) {
  const kind = useLensStore((s) => s.plugins[pluginId]?.kind);
  const manifest = useLensStore((s) => s.plugins[pluginId]?.manifest ?? null);
  const totals = useLensStore(useShallow((s) => selectPluginTotals(s, pluginId)));
  const evicted = useLensStore((s) => selectEvictedCount(s, pluginId));
  const thumbs = useLensStore(
    useShallow((s) =>
      Object.values(s.deliveries)
        .filter((d) => d.pluginId === pluginId && d.sendStatus === 'dispatched')
        .sort((a, b) => b.processedAt - a.processedAt)
        .map((d) => `${d.id}|${d.thumbnailRef ?? ''}|${d.branch}`),
    ),
  );
  const name = kind ? PLUGIN_NAME[kind] : pluginId;

  return (
    <>
      <div className="fm-loghead">
        <span className="fm-label">
          {name} 플러그인이 본 것은 이 사진 {totals.deliveries}장뿐
        </span>
        <span className="fm-readout">외 {evicted}장(썸네일 해제됨)</span>
      </div>
      {thumbs.length > 0 ? (
        <ul className="fm-thumbs">
          {thumbs.map((t) => {
            const [id, url, branch] = t.split('|') as [string, string, string];
            return (
              <li key={id} className="fm-thumb fm-thumb--grid" data-masked={branch === '2b' ? 'face' : branch === '2c' ? 'head' : undefined}>
                {url ? <img src={url} alt="" /> : <span className="fm-thumb__gone">해제됨</span>}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="fm-empty fm-readout">이 세션에서 이 플러그인에 보낸 사진이 없습니다.</p>
      )}
      <div className="fm-readout">
        얼굴이 담긴 전달 {totals.faceDeliveries}건(세션 누적)
        {manifest && (
          <>
            {' · '}목적: {manifest.purpose} · 장면: {manifest.scenes.join(', ')} · 긴 변 {manifest.maxSide}px · 분당 {manifest.maxPerMinute}장
          </>
        )}
      </div>
    </>
  );
}
