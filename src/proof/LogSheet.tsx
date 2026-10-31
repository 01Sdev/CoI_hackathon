// 휴대폰 하단 시트(배치도 휴대폰 3). 접힌 상태는 최근 1건과 착용자 제어 버튼, 손잡이를 누르면 펼쳐서 전체와 상세를 본다.
// "앱 켜고 끄기"는 시트를 펼쳐 착용자 제어(F22)를 보인다. 일시 정지는 접힌 상태에서도 바로 누를 수 있다.

import { useState } from 'react';
import { PauseButton, WearerControls } from '../ui/WearerControls';
import { DeliveryDetail } from './DeliveryDetail';
import { LogHeader, LogList } from './ProofLog';

type View = 'log' | 'controls';

export function LogSheet({ onOpenConfirm }: { onOpenConfirm(): void }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('log');
  const [detail, setDetail] = useState<string | null>(null);
  const controls = open && view === 'controls';

  return (
    <section className="fm-sheet fm-glass fm-glass--panel" data-open={open} aria-label="증명 로그와 착용자 제어">
      <button
        type="button"
        className="fm-sheet__handle"
        aria-expanded={open}
        aria-label={open ? '시트 접기' : '로그 펼치기'}
        onClick={() => {
          setOpen((o) => !o);
          setView('log');
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
          <LogHeader title={controls ? '착용자 제어' : '앱이 받은 것'} />
          <div className="fm-sheet__actions">
            <PauseButton />
            <button
              type="button"
              className="fm-btn fm-btn--sm fm-glass"
              aria-pressed={controls}
              onClick={() => {
                if (controls) setView('log');
                else {
                  setView('controls');
                  setOpen(true);
                }
              }}
            >
              {controls ? '로그 보기' : '앱 켜고 끄기'}
            </button>
            <button type="button" className="fm-btn fm-btn--sm fm-glass" onClick={onOpenConfirm}>
              확인 화면
            </button>
          </div>
          <div className="fm-sheet__scroll">
            {controls ? (
              <WearerControls />
            ) : (
              <LogList
                limit={open ? undefined : 1}
                onOpen={(id) => {
                  setDetail(id);
                  setOpen(true);
                }}
              />
            )}
          </div>
        </>
      )}
    </section>
  );
}
