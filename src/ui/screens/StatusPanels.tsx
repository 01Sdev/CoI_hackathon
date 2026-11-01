// 로딩·엔진 실패·카메라 자동 전환. 배치도 /dev/screens.html 휴대폰 2·5·6.
// 숫자는 모두 실제 값이다: 카메라 해상도는 session.input, 진행은 engine 바이트(모르면 경과 초), 전달 수는 Counter.

import { useState, type CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useLensStore } from '../../core/store';
import type { InputSource } from '../../core/types';
import { INPUT_LABEL, josa, modelProgressText } from '../labels';
import { OrbStack } from '../OrbStack';
import { useElapsedSeconds, useTotalDeliveries } from '../useEngineView';

export function LoadingPanel() {
  const input = useLensStore((s) => s.session.input);
  const engine = useLensStore(useShallow((s) => s.engine));
  const sent = useTotalDeliveries();
  const sec = useElapsedSeconds();
  const known = engine.loadedBytes !== null && engine.totalBytes !== null && engine.totalBytes > 0;
  const pct = known ? Math.min(100, (100 * engine.loadedBytes!) / engine.totalBytes!) : 0;

  return (
    <>
      <div className="fm-stage__dim" />
      <div className="fm-stage__scan fm-scan" />
      <section className="fm-status fm-glass fm-glass--panel" aria-live="polite">
        <span className="fm-kicker">preparing on-device models</span>
        <h2 className="fm-status__title">판정 모델 받는 중</h2>
        <div className="fm-check">
          <span className={input ? 'fm-check__ok' : 'fm-readout'}>{input ? '✓' : '··'}</span>
          <span>{input ? `${INPUT_LABEL[input.kind]} 연결` : '카메라 연결'}</span>
          <span className="fm-readout">{input ? `${input.width}×${input.height}` : '대기'}</span>
        </div>
        <div className="fm-check">
          <span className="fm-readout">··</span>
          <span>물체·얼굴 판정 모델</span>
          <span className="fm-readout">{engine.status === 'idle' && !known ? '대기' : modelProgressText(engine.loadedBytes, engine.totalBytes, sec)}</span>
        </div>
        <div className={known ? 'fm-bar' : 'fm-bar fm-bar--indeterminate'}>
          <i style={known ? { width: `${pct}%` } : undefined} />
        </div>
        <div className="fm-readout">보통 10초 안팎 · {sent === 0 ? '아직 아무것도 보내지 않았습니다' : `전달 ${sent}건`}</div>
      </section>
      <div className="fm-stage__bottom">
        <OrbStack value="–" tone="hold" caption={`준비 중 · 전달 ${sent}`} />
      </div>
    </>
  );
}

export function EngineFailPanel() {
  const detail = useLensStore((s) => s.engine.detail);
  const sent = useTotalDeliveries();
  return (
    <>
      <div className="fm-stage__dim" />
      <section className="fm-status fm-glass fm-glass--panel" role="alert">
        <span className="fm-kicker">delivery stopped</span>
        <h2 className="fm-status__title">판정 엔진을 불러오지 못했어요</h2>
        <p className="fm-status__body">판정이 없으면 무엇이 찍혔는지 알 수 없어서, 어떤 앱에도 아무것도 보내지 않습니다.</p>
        <div className="fm-readout">
          {detail ?? '로컬 분석 불가'} · 전달 {sent}건
        </div>
        <button type="button" className="fm-btn fm-btn--primary" onClick={() => location.reload()}>
          다시 불러오기
        </button>
      </section>
      <div className="fm-stage__bottom">
        <OrbStack value="–" tone="hold" caption="전달 멈춤" />
      </div>
    </>
  );
}

/**
 * 글래스 흐름(/)의 로딩. 휴대폰 웹은 글래스 시야를 흉내 내므로 카드·어둡게·큰 원 카운터 없이 카메라 위 작은 글자 한 줄만 둔다
 * (사용자 결정 2026-11-01: 앱 같은 화면을 걷어 냄). 같은 사실을 말한다: 모델 진행, 준비될 때까지 아무것도 보내지 않음.
 */
export function GlassLoading() {
  const engine = useLensStore(useShallow((s) => s.engine));
  const sec = useElapsedSeconds();
  const known = engine.loadedBytes !== null && engine.totalBytes !== null && engine.totalBytes > 0;
  const pct = known ? Math.round(Math.min(100, (100 * engine.loadedBytes!) / engine.totalBytes!)) : null;
  const progress = engine.status === 'idle' ? '대기' : modelProgressText(engine.loadedBytes, engine.totalBytes, sec);
  return (
    <section className="fm-glassload" role="status" aria-live="polite">
      <span className="fm-glassload__spin" aria-hidden="true" style={pct !== null ? ({ '--p': `${pct}%` } as CSSProperties) : undefined} data-known={pct !== null} />
      <span className="fm-glassload__line">판정 모델 받는 중 · {progress}</span>
      <span className="fm-glassload__sub">준비될 때까지 아무것도 보내지 않아요</span>
    </section>
  );
}

/** 글래스 흐름의 엔진 실패. 같은 톤의 글자 두 줄과 다시 불러오기 버튼 하나. */
export function GlassEngineFail() {
  const detail = useLensStore((s) => s.engine.detail);
  return (
    <section className="fm-glassload" role="alert">
      <span className="fm-glassload__line">판정 엔진을 불러오지 못했어요</span>
      <span className="fm-glassload__sub">무엇이 찍혔는지 알 수 없어 아무것도 보내지 않아요{detail ? ` · ${detail}` : ''}</span>
      <button type="button" className="fm-glassload__retry" onClick={() => location.reload()}>
        다시 불러오기
      </button>
    </section>
  );
}

/** F1 자동 전환을 숨기지 않고 한 줄로 알린다. 닫으면 같은 전환에 대해서는 다시 뜨지 않는다. */
export function CameraFallbackNotice() {
  const input = useLensStore((s) => s.session.input);
  const selectInput = useLensStore((s) => s.selectInput);
  const [dismissed, setDismissed] = useState<InputSource | null>(null);
  if (!input?.fallbackFrom || dismissed === input) return null;
  const from = input.fallbackFrom;
  return (
    <section className="fm-notice fm-glass fm-glass--panel" role="status">
      <div className="fm-label">카메라를 쓸 수 없어 {josa(INPUT_LABEL[input.kind], '으로/로')} 바꿨어요</div>
      <div className="fm-readout">{josa(INPUT_LABEL[from], '을/를')} 열지 못함 · 같은 판정과 가림을 그대로 적용합니다</div>
      <div className="fm-notice__actions">
        <button type="button" className="fm-btn fm-btn--sm fm-glass" onClick={() => selectInput(from)}>
          카메라 다시 허용
        </button>
        <button type="button" className="fm-btn fm-btn--sm fm-glass" onClick={() => setDismissed(input)}>
          닫기
        </button>
      </div>
    </section>
  );
}
