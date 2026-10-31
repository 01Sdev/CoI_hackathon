// 플러그인 확인 화면(F12, FR-030·038): "이 플러그인이 본 것은 이 사진 N장뿐" + 썸네일 그리드 + "요청한 것 / 허용된 것".
// N = Counter 누적 전달 수(selectPluginTotals). 그리드 = 스토어에 남은 dispatched Delivery. 로그가 밀려나 지워진 것은 "외 k장"
// (selectEvictedCount), 비교 모드를 꺼서 썸네일만 해제된 raw는 "해제됨" 칸으로 둬서 그리드 칸 수 + k = N이 되게 한다.
// 켜져 있거나 받은 것이 있는 앱은 모두 한 화면에 나란히 보인다(두 번째 앱 F21). 매니페스트 문자열은 텍스트 노드로만 넣는다.

import { useShallow } from 'zustand/react/shallow';
import { ORIGIN_TOKEN } from '../core/constants';
import { selectEvictedCount, selectPluginTotals } from '../core/selectors';
import { useLensStore } from '../core/store';
import { MANIFEST_SCENE_LABEL, PLUGIN_NAME } from '../ui/labels';

export function ConfirmScreen({ onClose }: { onClose?: () => void }) {
  const ids = useLensStore(
    useShallow((s) => {
      const shown = s.pluginOrder.filter((id) => s.plugins[id]?.enabled || selectPluginTotals(s, id).deliveries > 0);
      return shown.length > 0 ? shown : s.pluginOrder.slice(0, 1);
    }),
  );

  return (
    <section className="fm-confirm" aria-label="플러그인 확인 화면">
      <div className="fm-confirm__apps">
        {ids.map((id) => (
          <ConfirmBody key={id} pluginId={id} />
        ))}
      </div>
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

function ConfirmBody({ pluginId }: { pluginId: string }) {
  const kind = useLensStore((s) => s.plugins[pluginId]?.kind);
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
    <article className="fm-confirm__app" aria-label={`${name} 확인`}>
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
      <div className="fm-readout">얼굴이 담긴 전달 {totals.faceDeliveries}건(세션 누적)</div>
      <RequestGrant pluginId={pluginId} />
    </article>
  );
}

/**
 * FR-030 "요청한 것 / 허용된 것". 요청 = 매니페스트(검증을 통과해 적용된 값), 허용 = 실제로 걸린 제한.
 * 통신은 network ∩ HOST_ALLOWED_ORIGINS($ORIGIN은 배포 주소로 바뀜)이고, 비교 모드의 칼로리는 iframe이 connect-src 'none'이라 없음.
 * 나머지 필드는 검증을 통과한 값이 그대로 적용되므로 같다. 다른 줄은 표시한다.
 */
function RequestGrant({ pluginId }: { pluginId: string }) {
  const p = useLensStore(
    useShallow((s) => {
      const x = s.plugins[pluginId];
      if (!x) return null;
      const m = x.manifest;
      return {
        purpose: m.purpose,
        network: m.network.join('\n'),
        allowed: x.allowedOrigins.join('\n'),
        connectNone: x.runtimePolicy?.connect === 'none',
        scenes: m.scenes.map((sc) => MANIFEST_SCENE_LABEL[sc]).join(', '),
        maxSide: m.maxSide,
        maxPerMinute: m.maxPerMinute,
        quality: m.quality,
        version: m.version,
      };
    }),
  );
  if (!p) return null;

  const reqList = p.network ? p.network.split('\n') : [];
  const allowedList = p.allowed ? p.allowed.split('\n') : [];
  // 요청했지만 허용 목록(HOST_ALLOWED_ORIGINS) 밖이라 막힌 주소. $ORIGIN이 이 서비스 주소로 바뀌는 것은 막힘이 아니다.
  const denied = reqList.filter((o) => !allowedList.includes(o === ORIGIN_TOKEN ? location.origin : o));
  const requested = reqList.length ? reqList.map((o) => (o === ORIGIN_TOKEN ? `${o} (이 서비스 주소)` : o)).join('\n') : '없음';
  const granted = p.connectNone
    ? '없음 · 비교 모드라 통신을 막음'
    : [allowedList.length ? allowedList.join('\n') : '없음', ...(denied.length ? [`막힘: ${denied.join(', ')}`] : [])].join('\n');
  const networkDiffers = p.connectNone || denied.length > 0;
  const rows: Array<[string, string, string]> = [
    ['통신', requested, granted],
    ['장면', p.scenes, p.scenes],
    ['조각 긴 변', `${p.maxSide}px`, `${p.maxSide}px 이하`],
    ['분당 장수', `${p.maxPerMinute}장`, `${p.maxPerMinute}장 이하`],
    ['JPEG 품질', String(p.quality), String(p.quality)],
    ['영역', '대상', '대상 박스 + 10%'],
  ];

  return (
    <div className="fm-grant">
      <div className="fm-readout fm-grant__purpose">
        목적: {p.purpose} · 매니페스트 v{p.version}
      </div>
      <table className="fm-grant__table">
        <thead>
          <tr>
            <th scope="col">
              <span className="fm-visually-hidden">항목</span>
            </th>
            <th scope="col" className="fm-kicker">
              요청한 것
            </th>
            <th scope="col" className="fm-kicker">
              허용된 것
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, req, grant]) => {
            const differs = label === '통신' && networkDiffers;
            return (
              <tr key={label} data-diff={differs}>
                <th scope="row" className="fm-readout">
                  {label}
                </th>
                <td className="fm-grant__v">{req}</td>
                <td className="fm-grant__v">{grant}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
