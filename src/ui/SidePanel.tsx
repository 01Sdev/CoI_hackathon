// 데스크톱 오른쪽 탭(FR-036): 로그 / 확인 화면 / 매니페스트 / 처리량.

import { useState, type ReactNode } from 'react';
import { ConfirmScreen } from '../proof/ConfirmScreen';
import { DeliveryDetail } from '../proof/DeliveryDetail';
import { LogHeader, LogList } from '../proof/ProofLog';

export type SideTab = 'log' | 'confirm';

const TABS: Array<[SideTab, string]> = [
  ['log', '로그'],
  ['confirm', '확인 화면'],
];

export function SidePanel({ tab, onTab }: { tab: SideTab; onTab(t: SideTab): void }) {
  const [detail, setDetail] = useState<string | null>(null);
  let body: ReactNode;
  if (tab === 'confirm') body = <ConfirmScreen />;
  else if (detail) body = <DeliveryDetail entryId={detail} onBack={() => setDetail(null)} />;
  else
    body = (
      <>
        <LogHeader />
        <LogList onOpen={setDetail} />
        <p className="fm-readout fm-side__note">해시는 항목을 눌러 상세에서 · 2초 안에 수신 확인이 없으면 "수신 미확인"</p>
      </>
    );

  return (
    <>
      <div className="fm-tabs fm-glass" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className="fm-tabs__item" onClick={() => onTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="fm-side__body" role="tabpanel">
        {body}
      </div>
    </>
  );
}
