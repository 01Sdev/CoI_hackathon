// 응시 동의 칩(코디 스캔 파이프라인 1, docs/designs/outfit-pipelines.md). A가 시야 가운데 사람을 3초 확인해 gaze를 세우면
// 그 사람 상자 위쪽 바깥에 "마스크 해제" 칩 하나를 띄운다. 누르거나 Enter(글래스 물리 버튼 대용) → grantConsent(trackId).
// 동의는 그 사람의 몸(옷)을 코디 스캔에 보내도 된다는 착용자의 허락이고, 얼굴은 동의해도 계속 가린다.
// 사람 상자·테두리·점은 그리지 않는다(사용자 결정). 이미 동의한 사람이면 칩을 띄우지 않는다.

import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useLensStore } from '../core/store';
import { gazeChipPoint, type Size } from './geometry';
import { isGlassButtonKey } from './glassKeys';

export function GazeChip({ size }: { size: Size }) {
  const v = useLensStore(
    useShallow((s) => {
      const g = s.gaze && !s.consents[s.gaze.trackId] ? s.gaze : null;
      return {
        trackId: g?.trackId ?? null,
        box: g?.box ?? null,
        srcW: s.session.input?.width ?? 0,
        srcH: s.session.input?.height ?? 0,
      };
    }),
  );
  const grant = useLensStore((s) => s.grantConsent);
  const trackId = v.trackId;

  useEffect(() => {
    if (!trackId) return;
    // 캡처 단계라 말 막대의 Enter보다 먼저 받는다. 칩이 떠 있으면 Enter는 동의다.
    const onKey = (e: KeyboardEvent) => {
      if (!isGlassButtonKey(e, ['Enter'])) return;
      e.preventDefault();
      grant(trackId);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [trackId, grant]);

  if (!trackId || !v.box || size.w === 0) return null;
  const at = gazeChipPoint(v.box, v.srcW > 0 ? { w: v.srcW, h: v.srcH } : null, size);
  return (
    <button
      type="button"
      className="fm-gazechip"
      style={{ left: at.x, top: at.y }}
      aria-label="마스크 해제 · 이 사람의 옷을 코디 스캔에 보내요. 얼굴은 계속 가려요 · Enter"
      onClick={() => grant(trackId)}
    >
      마스크 해제
    </button>
  );
}
