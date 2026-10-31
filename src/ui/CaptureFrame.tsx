// 전송 범위 흰 틀(F24·F24a, FR-061)과 그 오른쪽 위 사람 아이콘·숫자. 모양과 조작은 #44 SelectionFrame 그대로다
// (사용자 결정 2026-11-01: 플랫폼은 #44를 최대한 따른다). 틀 밖 픽셀은 어떤 플러그인에도 가지 않는다(자르기는 A).
// SelectionFrame은 화면(부모) 0~1 값을 쓰고 스토어의 captureFrame은 소스 0~1이라, cover 변환(sourceToView·viewToSource)으로 오간다.
// 휴대폰·데스크톱은 늘 조절할 수 있다(테두리 끌기 = 이동, 모서리·중간점 = 크기, 방향키). 화면에 들어가게 맞춘 값도 그대로 쓴다.
// 그래서 흰 틀이 곧 보내는 범위다(화면 밖으로 잘린 부분까지 보내지 않는다). /hud는 틀만 그리고 스토어에 쓰지 않는다.
// 숫자(FR-035) = 지금 가림 없이 앱에 넘어가는 사람 수 = 살아 있는 코디 스캔 동의(selectConsentCount, 몸만 보이고 얼굴은 가림)
// + 최근 10초 가림 없이 넘어간 얼굴(selectFaceM, 비교 모드에서만 1 이상). 보호 모드 평소에는 0이다.
// 동의가 1 이상일 때만 숫자가 버튼이 되고, 누르면 모든 동의를 끈다(revokeConsent). 비교 모드 얼굴은 눌러서 끌 수 없다.

import { useShallow } from 'zustand/react/shallow';
import { selectConsentCount, selectFaceM } from '../core/selectors';
import { lensStore, useLensStore } from '../core/store';
import type { Box } from '../core/types';
import { sameBox, sourceToView, viewToSource, type Size } from './geometry';
import { SelectionFrame } from './SelectionFrame';

export function CaptureFrame({ size, adjustable }: { size: Size; /** 휴대폰·데스크톱은 true, /hud는 false. */ adjustable: boolean }) {
  const v = useLensStore(
    useShallow((s) => ({
      frame: s.session.captureFrame,
      srcW: s.session.input?.width ?? 0,
      srcH: s.session.input?.height ?? 0,
    })),
  );
  const consents = useLensStore((s) => selectConsentCount(s));
  const faces = useLensStore((s) => selectFaceM(s));
  const setCaptureFrame = useLensStore((s) => s.setCaptureFrame);

  if (size.w === 0 || size.h === 0) return null;
  const src = v.srcW > 0 ? { w: v.srcW, h: v.srcH } : null;
  const onChange = (next: Box) => {
    if (!adjustable) return;
    const f = viewToSource(next, src, size);
    if (!sameBox(f, v.frame)) setCaptureFrame(f);
  };

  return (
    <div className="fm-capture" data-adjustable={adjustable}>
      <SelectionFrame
        value={sourceToView(v.frame, src, size)}
        onChange={onChange}
        peopleCount={consents + faces}
        editable={adjustable}
        countLabel={(n) => `가림 없이 넘어가는 사람 ${n}명`}
        onCountPress={adjustable && consents > 0 ? revokeAll : undefined}
        countPressLabel="눌러서 동의 끄기"
      />
    </div>
  );
}

function revokeAll() {
  const s = lensStore.getState();
  for (const id of Object.keys(s.consents)) s.revokeConsent(id);
}
