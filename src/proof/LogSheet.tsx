// 휴대폰 하단 시트(배치도 휴대폰 3). 접힌 상태는 최근 2건, 손잡이를 누르면 펼쳐서 전체와 상세를 본다.

import { useState } from 'react';
import { DeliveryDetail } from './DeliveryDetail';
import { LogHeader, LogList } from './ProofLog';

export function LogSheet({ onOpenConfirm }: { onOpenConfirm(): void }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);

  return (
    <section className="fm-sheet fm-glass fm-glass--panel" data-open={open} aria-label="증명 로그">
      <button
        type="button"
        className="fm-sheet__handle"
        aria-expanded={open}
        aria-label={open ? '로그 접기' : '로그 펼치기'}
        onClick={() => {
          setOpen((o) => !o);
          setDetail(null);
        }}
      >
        <span />
      </button>
      {detail ? (
        <div className="fm-sheet__scroll">
          <DeliveryDetail entryId={detail} onBack={() => setDetail(null)} />
        </div>
      ) : (
        <>
          <div className="fm-sheet__head">
            <LogHeader />
            <button type="button" className="fm-btn fm-btn--sm fm-glass" onClick={onOpenConfirm}>
              확인 화면
            </button>
          </div>
          <div className="fm-sheet__scroll">
            <LogList
              limit={open ? undefined : 2}
              onOpen={(id) => {
                setDetail(id);
                setOpen(true);
              }}
            />
          </div>
        </>
      )}
    </section>
  );
}
