// 증명 로그 목록(F6). 화면 로그는 스토어의 최근 100건 그대로이고, 최신이 위다.
// 썸네일은 플러그인에 보낸 것과 같은 Blob의 object URL(Delivery.thumbnailRef). 밀려나면 스토어가 해제한다.

import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { LOG_LIMIT } from '../core/constants';
import { useLensStore } from '../core/store';
import type { Delivery, LogEntry } from '../core/types';
import { ago, entryCode, entryMeta, entryTitle, entryTone } from './format';

/** 1초마다 바뀌는 performance.now(). "14초 전" 같은 상대 시각용. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(performance.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

export function LogHeader({ title = '앱이 받은 것' }: { title?: string }) {
  const c = useLensStore(
    useShallow((s) => {
      let deliver = 0;
      let hold = 0;
      let blocked = 0;
      for (const l of s.logs) {
        if (l.kind === 'deliver') deliver += 1;
        else if (l.kind === 'violation') blocked += 1;
        else hold += 1;
      }
      return { deliver, hold, blocked, n: s.logs.length };
    }),
  );
  return (
    <div className="fm-loghead">
      <span className="fm-label">{title}</span>
      <span className="fm-readout">
        전달 {c.deliver} · 보류 {c.hold} · 차단 {c.blocked}
        {c.n >= LOG_LIMIT ? ` · 최근 ${LOG_LIMIT}건` : ''}
      </span>
    </div>
  );
}

export function LogList({ limit, onOpen }: { limit?: number; onOpen?: (entryId: string) => void }) {
  const logs = useLensStore((s) => s.logs);
  const now = useNow();
  if (logs.length === 0) {
    return <p className="fm-empty fm-readout">아직 넘어간 것이 없습니다 · 전달 0건</p>;
  }
  const shown: LogEntry[] = [];
  for (let i = logs.length - 1; i >= 0 && shown.length < (limit ?? logs.length); i--) shown.push(logs[i]!);
  return (
    <ol className="fm-log">
      {shown.map((e) => (
        <li key={e.id}>
          <LogCard entry={e} now={now} onOpen={onOpen} />
        </li>
      ))}
    </ol>
  );
}

export function Thumb({ entry, delivery }: { entry: LogEntry; delivery: Delivery | null }) {
  if (entry.kind !== 'deliver') return <span className="fm-thumb fm-thumb--empty" data-kind={entry.kind} />;
  const masked = delivery?.branch === '2b' ? 'face' : delivery?.branch === '2c' ? 'head' : undefined;
  return (
    <span className="fm-thumb" data-masked={masked}>
      {delivery?.thumbnailRef ? <img src={delivery.thumbnailRef} alt="" /> : <span className="fm-thumb__gone">해제됨</span>}
    </span>
  );
}

function LogCard({ entry, now, onOpen }: { entry: LogEntry; now: number; onOpen?: (entryId: string) => void }) {
  const d = useLensStore((s) => (entry.deliveryId ? (s.deliveries[entry.deliveryId] ?? null) : null));
  const kind = useLensStore((s) => s.plugins[entry.pluginId]?.kind);
  const code = entryCode(entry);
  const body = (
    <>
      <Thumb entry={entry} delivery={d} />
      <span className="fm-logcard__main">
        <span className="fm-logcard__title fm-label">
          <span className="fm-dot" aria-hidden="true" />
          {entryTitle(entry, d, kind)}
          {code && <span className="fm-tag">{code}</span>}
        </span>
        <span className="fm-readout fm-logcard__meta">{entryMeta(entry, d)}</span>
      </span>
      <span className="fm-readout fm-logcard__when">{ago(now - entry.at)}</span>
    </>
  );
  return onOpen ? (
    <button type="button" className="fm-logcard fm-glass" data-tone={entryTone(entry, d)} onClick={() => onOpen(entry.id)}>
      {body}
    </button>
  ) : (
    <div className="fm-logcard fm-glass" data-tone={entryTone(entry, d)}>
      {body}
    </div>
  );
}
