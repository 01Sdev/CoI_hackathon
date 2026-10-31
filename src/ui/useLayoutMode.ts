// 휴대폰·데스크톱 배치 고르기(K-13): 폭 768px 자동 + 수동 전환. 수동 선택은 localStorage에 남긴다.
// 실제로 쓰는 배치는 스토어 session.viewMode에도 적는다(A가 기본 입력을 고를 때 읽을 수 있게).

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLensStore } from '../core/store';

export type LayoutMode = 'phone' | 'desktop';
export type LayoutChoice = 'auto' | LayoutMode;

const KEY = 'framelet.layout';
const WIDE = '(min-width: 768px)';

function readChoice(): LayoutChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'phone' || v === 'desktop' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

function subscribeWide(cb: () => void) {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

export function useLayoutMode(): { mode: LayoutMode; choice: LayoutChoice; setChoice(c: LayoutChoice): void } {
  const [choice, setChoiceState] = useState<LayoutChoice>(readChoice);
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches);
  const mode: LayoutMode = choice === 'auto' ? (wide ? 'desktop' : 'phone') : choice;
  const setViewMode = useLensStore((s) => s.setViewMode);

  useEffect(() => setViewMode(mode), [mode, setViewMode]);

  const setChoice = (c: LayoutChoice) => {
    setChoiceState(c);
    try {
      if (c === 'auto') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, c);
    } catch {
      // 저장이 막혀도 이번 화면에서는 바뀐다.
    }
  };
  return { mode, choice, setChoice };
}
