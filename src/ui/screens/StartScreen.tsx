// 시작 화면(배치도 휴대폰 1). 시작 버튼 하나로 오디오 잠금 해제(FR-039)와 카메라 요청을 같이 한다.
// 카메라 요청은 selectInput 의도만 남기고, 실제 getUserMedia는 A가 한다.

import { APP_NAME } from '../../core/constants';
import type { InputKind } from '../../core/types';
import type { LayoutMode } from '../useLayoutMode';

export function StartScreen({ layout, onStart }: { layout: LayoutMode; onStart(kind: InputKind): void }) {
  const camera: InputKind = layout === 'desktop' ? 'webcam' : 'rear';
  return (
    <main className="fm-start" data-layout={layout}>
      <div className="fm-start__bg fm-grid" aria-hidden="true" />
      <div className="fm-start__hero">
        <span className="fm-kicker">first-person vision broker</span>
        <h1 className="fm-start__brand">
          <span className="fm-brand__dot" aria-hidden="true" />
          {APP_NAME}
        </h1>
        <p className="fm-start__lines">
          앱에는 필요한 조각 한 장만.
          <br />
          찍힌 사람의 얼굴은 가려서.
          <br />
          넘어간 것은 전부 로그로.
        </p>
      </div>
      <div className="fm-start__actions">
        <button type="button" className="fm-btn fm-btn--primary fm-btn--lg" onClick={() => onStart(camera)}>
          시작하기
        </button>
        <button type="button" className="fm-btn fm-glass" onClick={() => onStart('video')}>
          녹화 영상으로 보기
        </button>
        <span className="fm-readout fm-start__note">카메라 권한과 소리를 한 번에 켭니다 · 판정은 이 기기 안에서</span>
      </div>
    </main>
  );
}
