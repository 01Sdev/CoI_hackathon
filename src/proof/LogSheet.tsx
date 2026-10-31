// 휴대폰 하단 시트(배치도 휴대폰 3). 접힌 상태는 최근 1건과 버튼 줄, 손잡이를 누르면 펼쳐서 전체와 상세를 본다.
// 버튼 줄: 전달 일시 정지(F22) · 사용 기록(F25) · 앱 관리(F22) · 확인 화면(F12). 사용 기록·앱 관리는 시트를 펼쳐 그 화면을 보이고,
// 한 번 더 누르면 로그로 돌아간다.

import { useState } from 'react';
import { PauseButton, WearerControls } from '../ui/WearerControls';
import { DeliveryDetail } from './DeliveryDetail';
import { LogHeader, LogList } from './ProofLog';
import { UsageHistory } from './UsageHistory';

type View = 'log' | 'usage' | 'controls';

const TITLE: Record<View, string> = { log: '앱이 받은 것', usage: '사용 기록', controls: '착용자 제어' };

export function LogSheet({ onOpenConfirm }: { onOpenConfirm(): void }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('log');
  const [detail, setDetail] = useState<string | null>(null);
  const shown: View = open ? view : 'log';

  const toggle = (v: View) => {
    if (shown === v) setView('log');
    else {
      setView(v);
      setOpen(true);
    }
  };

  return (
    <section className="fm-sheet fm-glass fm-glass--panel" data-open={open} aria-label="증명 로그, 사용 기록, 착용자 제어">
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
          <LogHeader title={TITLE[shown]} />
          <div className="fm-sheet__actions">
            <PauseButton />
            <button type="button" className="fm-btn fm-btn--sm fm-glass" aria-pressed={shown === 'usage'} onClick={() => toggle('usage')}>
              사용 기록
            </button>
            <button type="button" className="fm-btn fm-btn--sm fm-glass" aria-pressed={shown === 'controls'} onClick={() => toggle('controls')}>
              앱 관리
            </button>
            <button type="button" className="fm-btn fm-btn--sm fm-glass" onClick={onOpenConfirm}>
              확인 화면
            </button>
          </div>
          <div className="fm-sheet__scroll">
            {shown === 'controls' ? (
              <WearerControls />
            ) : shown === 'usage' ? (
              <UsageHistory />
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
