// /hud D-pad(FR-037, K-16): 좌우 = 최근 전달물 선택, 선택(Enter) = 그 전달물 상세, 뒤로 = 닫기.
// Ray-Ban Display는 터치패드 방향을 ArrowLeft·Right·Enter keydown으로 주고, 뒤로는 브라우저 history로 준다
// (Wearables WebApps 문서 "Input and navigation"). 그래서 선택·상세를 열 때 history 항목을 넣고 popstate로 닫는다.
// 데스크톱에서는 Esc·Backspace가 history.back()을 부른다. 글자는 24px 이상(NFR-040), 썸네일은 보이지 않는다.

import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useLensStore } from '../core/store';
import { ago, percent } from '../proof/format';
import { useNow } from '../proof/ProofLog';
import { formatBytes, PLUGIN_NAME } from './labels';

const BRANCH_TEXT: Record<string, string> = { '2a': '그대로', '2b': '얼굴 가림', '2c': '머리 넓게 가림', raw: '원본 전체' };
const ACK_TEXT = { pending: '확인 기다리는 중', match: '수신 확인', mismatch: '해시 불일치', timeout: '수신 미확인' };
const MAX = 20;

export function HudBrowser() {
  const ids = useLensStore(
    useShallow((s) =>
      Object.values(s.deliveries)
        .filter((d) => d.sendStatus === 'dispatched')
        .sort((a, b) => b.processedAt - a.processedAt)
        .slice(0, MAX)
        .map((d) => d.id),
    ),
  );
  const [sel, setSel] = useState<number | null>(null);
  const [detail, setDetail] = useState(false);

  // 뒤로(history) = 한 단계 닫기. state.fmHud: 1 = 선택 열림, 2 = 상세 열림, 없으면 모두 닫힘.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const depth = (e.state as { fmHud?: number } | null)?.fmHud ?? 0;
      setDetail(depth >= 2);
      if (depth < 1) setSel(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = ids.length;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // 기본 공간 탐색(포커스 이동·스크롤)을 막고 선택만 옮긴다. 오른쪽 = 더 오래된 것.
        e.preventDefault();
        if (sel === null) {
          history.pushState({ fmHud: 1 }, '');
          setSel(0);
          return;
        }
        setSel(n === 0 ? 0 : Math.max(0, Math.min(n - 1, sel + (e.key === 'ArrowRight' ? 1 : -1))));
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (sel !== null && n > 0 && !detail) {
          e.preventDefault();
          history.pushState({ fmHud: 2 }, '');
          setDetail(true);
        }
      } else if (e.key === 'Escape' || e.key === 'Backspace') {
        if (sel !== null) {
          e.preventDefault();
          history.back();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ids.length, sel, detail]);

  if (sel === null) return null;
  const index = Math.min(sel, Math.max(0, ids.length - 1));
  return (
    <div className="fm-hudpick" role="dialog" aria-label="최근 전달물">
      {ids.length === 0 ? (
        <>
          <span className="fm-scene">최근 전달 없음</span>
          <span className="fm-result">전달 0건 · 뒤로 = 닫기</span>
        </>
      ) : (
        <Picked id={ids[index]!} index={index} total={ids.length} detail={detail} />
      )}
    </div>
  );
}

function Picked({ id, index, total, detail }: { id: string; index: number; total: number; detail: boolean }) {
  const d = useLensStore((s) => s.deliveries[id] ?? null);
  const kind = useLensStore((s) => (d ? s.plugins[d.pluginId]?.kind : undefined));
  const now = useNow();
  if (!d) return null;
  const name = kind ? PLUGIN_NAME[kind] : d.pluginId;
  const faces = d.faceCheck.status === 'checked' ? `${d.faceCheck.detectedFaces}개` : '검사 실패';
  if (!detail) {
    return (
      <>
        <span className="fm-label fm-hudpick__count">
          ◀ 최근 전달 {index + 1}/{total} ▶
        </span>
        <span className="fm-scene">
          {name} · {BRANCH_TEXT[d.branch]}
        </span>
        <span className="fm-result">
          {formatBytes(d.bytes)} · {ago(now - d.processedAt)}
        </span>
        <span className="fm-caption">선택 = 상세 · 뒤로 = 닫기</span>
      </>
    );
  }
  return (
    <>
      <span className="fm-scene">
        {name} · {d.branch} · {BRANCH_TEXT[d.branch]}
      </span>
      <span className="fm-result">
        {formatBytes(d.bytes)} · 원본의 {percent(d.areaRatio)}
      </span>
      <span className="fm-result">
        가린 얼굴 {d.facesMasked}개 · 재검사 얼굴 {faces}
      </span>
      <span className="fm-result">
        {ACK_TEXT[d.ackStatus]} · {d.branch === 'raw' ? '서버로 안 감' : '이 기기에서 가림'}
      </span>
      <span className="fm-caption">뒤로 = 목록</span>
    </>
  );
}
