// 규약 보기(안 B, app-structure §3.2, F12·F22). 앱 관리의 앱 줄에서 연다. 위에서부터 앱 신원, framelet이 늘 지키는 것,
// 이 앱이 받는 것(앱이 요청 / framelet이 허용), 그리고 지금 확인 화면의 "본 것은 이 사진 N장뿐"이다.
// 결정 N12(승인 화면 없음)를 지켜 허용/거절 버튼 없이 닫기만 둔다. 켜기·끄기는 앱 관리의 스위치다.
// purpose는 앱이 쓴 문자열이라 sanitizeAppText를 거친다.

import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { APP_NAME } from '../core/constants';
import { useLensStore } from '../core/store';
import { PLUGIN_ICON, PLUGIN_NAME } from '../ui/labels';
import { sanitizeAppText } from '../ui/sanitize';
import { ConfirmBody } from './ConfirmScreen';
import { GUARANTEE_EXCEPTION, GUARANTEES, NO_RECALL_NOTE, protocolRows, receiverText, SERVER_UPSTREAM, serverNote, SPEECH_NOTE } from './protocol';

export function ProtocolView({ pluginId, onClose }: { pluginId: string; onClose(): void }) {
  const ref = useRef<HTMLElement>(null);
  // 앱 관리 목록을 내려 본 채로 열어도 맨 위(앱 신원)부터 보이게 둘러싼 스크롤을 올리고, 키보드 초점을 옮긴다.
  useEffect(() => {
    const root = ref.current;
    for (let el = root?.parentElement; el; el = el.parentElement) {
      if (getComputedStyle(el).overflowY === 'auto') {
        el.scrollTop = 0;
        break;
      }
    }
    root?.focus({ preventScroll: true });
  }, [pluginId]);
  const p = useLensStore(
    useShallow((s) => {
      const x = s.plugins[pluginId];
      if (!x) return null;
      return {
        kind: x.kind,
        purpose: sanitizeAppText(x.manifest.purpose),
        scenes: x.manifest.scenes.join(','),
        maxSide: x.manifest.maxSide,
        maxPerMinute: x.manifest.maxPerMinute,
        network: x.manifest.network.join('\n'),
        allowed: x.allowedOrigins.join('\n'),
        connectNone: x.runtimePolicy?.connect === 'none',
      };
    }),
  );
  if (!p) return null;

  const name = PLUGIN_NAME[p.kind];
  const split = (v: string) => (v ? v.split('\n') : []);
  const receiver = receiverText(split(p.network), split(p.allowed), location.origin, p.connectNone, SERVER_UPSTREAM[p.kind]);
  const rows = protocolRows(
    { scenes: p.scenes.split(',') as Array<'food' | 'person'>, maxSide: p.maxSide, maxPerMinute: p.maxPerMinute },
    receiver,
    p.kind,
  );

  return (
    <section ref={ref} tabIndex={-1} className="fm-protocol" aria-label={`${name} 규약 보기`}>
      <header className="fm-protocol__id">
        <span className="fm-appicon fm-appicon--lg" aria-hidden="true">
          {PLUGIN_ICON[p.kind]}
        </span>
        <span className="fm-protocol__who">
          <span className="fm-protocol__name">{name}</span>
          <span className="fm-readout">{p.purpose}</span>
        </span>
      </header>

      <section className="fm-protocol__card" aria-label={`${APP_NAME}이 늘 지키는 것`}>
        <div className="fm-protocol__cardhead">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          <span className="fm-label">{APP_NAME}이 늘 지키는 것</span>
          <span className="fm-protocol__fixed">앱이 바꿀 수 없어요</span>
        </div>
        <ol className="fm-protocol__list">
          {GUARANTEES.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ol>
        <p className="fm-protocol__small">{GUARANTEE_EXCEPTION}</p>
      </section>

      <section className="fm-protocol__receives" aria-label="이 앱이 받는 것">
        <span className="fm-label">이 앱이 받는 것</span>
        <table className="fm-grant__table fm-protocol__table">
          <thead>
            <tr>
              <th scope="col">
                <span className="fm-visually-hidden">항목</span>
              </th>
              <th scope="col" className="fm-protocol__th">
                앱이 요청
              </th>
              <th scope="col" className="fm-protocol__th">
                {APP_NAME}이 허용
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, req, grant]) => (
              <tr key={label}>
                <th scope="row" className="fm-readout">
                  {label}
                </th>
                <td>{req}</td>
                <td>{grant}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {receiver.viaServer && <p className="fm-protocol__note">{serverNote(p.kind)}</p>}
        {p.kind === 'outfit' && <p className="fm-protocol__note">{SPEECH_NOTE}</p>}
        <p className="fm-protocol__small">{NO_RECALL_NOTE}</p>
      </section>

      <ConfirmBody pluginId={pluginId} showGrant={false} />

      <div className="fm-confirm__actions">
        <button type="button" className="fm-btn fm-btn--primary fm-protocol__close" onClick={onClose}>
          닫기
        </button>
      </div>
    </section>
  );
}
