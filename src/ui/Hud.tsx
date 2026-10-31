// 글래스 HUD 한 컴포넌트(F8, FR-034·036). 세 화면에 같은 컴포넌트를 쓰고 배치만 variant로 바꾼다.
// 다섯 요소: 장면 · 입력 · 대상 위치 · 카운터(M, "화면 속 N명") · 결과. 요소 밖: 비교 모드 띠, 보류 줄, 전달 신호.
// 사람에게는 박스나 표시를 그리지 않는다(사용자 결정). 대상 프레임은 장면이 음식일 때만 그린다.
// 휴대폰·데스크톱의 "입력" 요소는 위쪽 줄 입력 캡슐(TopBar)이고, /hud에서는 오른쪽 위 글자다.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { selectFaceM } from '../core/selectors';
import { lensStore, useLensStore, type LensState } from '../core/store';
import type { Delivery } from '../core/types';
import { coverBox, faceWindowRemaining, type Size } from './geometry';
import { formatBytes, INPUT_LABEL, objectName, PLUGIN_NAME, SCENE_LABEL } from './labels';
import { OrbStack } from './OrbStack';
import { useDeliverySignal, useHoldSignal, useRecent } from './useSignals';

export type HudVariant = 'phone' | 'desktop' | 'hud';

export function Hud({ variant, onOpenConfirm }: { variant: HudVariant; onOpenConfirm?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useElementSize(ref);
  const compare = useLensStore((s) => s.session.compareMode);
  const paused = useLensStore((s) => s.session.paused);
  const delivery = useDeliverySignal();
  const hold = useHoldSignal();
  const showDelivered = useRecent(delivery.count, 1200);
  const showToast = useRecent(delivery.count, 3800);
  const showHold = useRecent(hold.count, 3000);
  const glass = variant !== 'hud';

  return (
    <div ref={ref} className="fm-hud" data-variant={variant} data-signals={delivery.count}>
      {compare && (
        <div className={glass ? 'fm-band fm-hud__band' : 'fm-band fm-band--line fm-hud__band'} role="status">
          {glass ? '비교 모드 · 원본 전체가 칼로리에 갑니다 · 통신은 막혀 있음' : '비교 모드'}
        </div>
      )}
      <TargetFrame size={size} tagged={glass} />
      <SceneCapsule readout={glass} />
      {paused && (
        <div className="fm-hud__paused">
          <span className={glass ? 'fm-capsule fm-glass fm-glass--panel' : 'fm-capsule fm-label'} data-tone="hold" role="status">
            <span className="fm-dot" aria-hidden="true" />
            전달 일시 정지 · 아무것도 보내지 않음
          </span>
        </div>
      )}
      {!glass && <HudInputLabel />}
      {glass && showToast && delivery.last && <DeliveryToast key={delivery.count} d={delivery.last} />}
      {!glass && showDelivered && (
        <span className="fm-hud__delivered fm-label" role="status">
          전달됨
        </span>
      )}
      <div className="fm-hud__bottom">
        <Counter variant={variant} onOpenConfirm={onOpenConfirm} />
        {showHold && (
          <span className={glass ? 'fm-capsule fm-glass fm-glass--panel' : 'fm-capsule fm-hud__hold'} data-tone="hold" role="status">
            <span className="fm-dot" aria-hidden="true" />
            보류{glass && hold.last?.reason ? ` · ${hold.last.reason}` : ''}
          </span>
        )}
      </div>
      {delivery.count > 0 && <div key={delivery.count} className="fm-hud__flash fm-flash" aria-hidden="true" />}
    </div>
  );
}

function useElementSize(ref: RefObject<HTMLElement>): Size {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** 0단계 장면과 같은 라벨로 확정된 최근 판정의 점수. 없으면 null. */
function latestScore(s: LensState, objectLabel: string | null | undefined): number | null {
  if (!objectLabel) return null;
  let best: { at: number; score: number } | null = null;
  for (const d of Object.values(s.sceneDecisions)) {
    if (d.objectLabel === objectLabel && (!best || d.confirmedAt > best.at)) best = { at: d.confirmedAt, score: d.score };
  }
  return best?.score ?? null;
}

function SceneCapsule({ readout }: { readout: boolean }) {
  const v = useLensStore(
    useShallow((s) => ({
      label: s.liveObservation?.label ?? 'none',
      people: s.liveObservation?.peopleCount ?? 0,
      score: latestScore(s, s.liveObservation?.objectLabel),
    })),
  );
  return (
    <div className="fm-hud__scene">
      <span className="fm-capsule fm-glass fm-glass--panel fm-hud__scenecap">
        <span className="fm-dot" aria-hidden="true" />
        <span className="fm-scene">{SCENE_LABEL[v.label]}</span>
        {readout && (
          <span className="fm-readout">
            {v.label !== 'none' && v.score !== null ? `${v.score.toFixed(2)} · ` : ''}화면 속 {v.people}명
          </span>
        )}
      </span>
    </div>
  );
}

function HudInputLabel() {
  const kind = useLensStore((s) => s.session.input?.kind ?? s.session.inputRequest?.kind ?? null);
  return <span className="fm-hud__input fm-label">{kind ? INPUT_LABEL[kind] : '입력 없음'}</span>;
}

function TargetFrame({ size, tagged }: { size: Size; tagged: boolean }) {
  const v = useLensStore(
    useShallow((s) => ({
      label: s.liveObservation?.label ?? 'none',
      box: s.liveObservation?.targetBox ?? null,
      object: s.liveObservation?.objectLabel ?? null,
      srcW: s.session.input?.width ?? 0,
      srcH: s.session.input?.height ?? 0,
      score: latestScore(s, s.liveObservation?.objectLabel),
    })),
  );
  // 사람 장면의 박스는 그리지 않는다.
  if (v.label !== 'food' || !v.box || size.w === 0) return null;
  const r = coverBox(v.box, v.srcW > 0 ? { w: v.srcW, h: v.srcH } : null, size);
  return (
    <span className="fm-frame fm-hud__frame" style={{ left: r.left, top: r.top, width: r.width, height: r.height }}>
      {tagged && v.object && (
        <span className="fm-frame__tag">
          {objectName(v.object)}
          {v.score !== null ? ` ${v.score.toFixed(2)}` : ''}
        </span>
      )}
    </span>
  );
}

function Counter({ variant, onOpenConfirm }: { variant: HudVariant; onOpenConfirm?: () => void }) {
  const m = useLensStore((s) => selectFaceM(s));
  // 차단 수는 오브 숫자가 아니라 배지에. 세션의 violation 로그 수라 100건에서 밀려나면 줄 수 있다(design-system §4 #5).
  const blocked = useLensStore((s) => s.logs.reduce((n, l) => n + (l.kind === 'violation' ? 1 : 0), 0));
  const result = useLensStore(
    useShallow((s) => {
      const id = s.pluginOrder.find((pid) => s.plugins[pid]?.kind === 'calorie');
      const r = id ? s.results[id] : undefined;
      return { text: r?.text ?? null, fallback: r?.source === 'fallback' };
    }),
  );
  const orbRef = useRef<HTMLDivElement>(null);

  // 10초 창 남은 시간 호. 다시 그리지 않고 CSS 변수만 바꾼다.
  useEffect(() => {
    const t = window.setInterval(() => {
      orbRef.current?.style.setProperty(
        '--fm-window',
        faceWindowRemaining(lensStore.getState().counter.recent10s, performance.now()).toFixed(3),
      );
    }, 100);
    return () => window.clearInterval(t);
  }, []);

  const hud = variant === 'hud';
  const tone = m > 0 ? 'exposed' : 'safe';
  const caption = `앱에 반영된 사람 ${m}명 · ${m > 0 ? '노출' : '보호됨'}`;
  const badge =
    blocked > 0 ? (
      <span className={hud ? 'fm-badge fm-capsule fm-label' : 'fm-badge fm-capsule fm-glass fm-glass--panel'} data-tone="blocked">
        <span className="fm-dot" aria-hidden="true" />
        차단 {blocked}
      </span>
    ) : undefined;
  const resultNode = result.text ? (
    hud ? (
      <span className="fm-result">
        {result.text}
        {result.fallback ? ' · 고정표' : ''}
      </span>
    ) : (
      <span className="fm-capsule fm-glass fm-glass--panel">
        <span className="fm-result">{result.text}</span>
        {result.fallback && <span className="fm-readout">고정표</span>}
      </span>
    )
  ) : undefined;

  return (
    <OrbStack
      value={m}
      tone={tone}
      caption={hud ? null : caption}
      badge={badge}
      result={resultNode}
      orbRef={orbRef}
      orbLabel={`${caption}. 확인 화면 열기`}
      onOrbClick={m > 0 && onOpenConfirm ? onOpenConfirm : undefined}
    />
  );
}

/** 보조 신호: 위에서 내려와 3초 뒤 사라지는 알림(휴대폰·데스크톱만). */
function DeliveryToast({ d }: { d: Delivery }) {
  const kind = useLensStore((s) => s.plugins[d.pluginId]?.kind);
  const raw = d.branch === 'raw';
  const faces = d.faceCheck.status === 'checked' ? d.faceCheck.detectedFaces : null;
  return (
    <div className="fm-hud__toast">
      <div className="fm-toast fm-toastcard fm-glass fm-glass--panel" data-tone={raw ? 'exposed' : 'safe'} role="status">
        <span className="fm-thumb">{d.thumbnailRef && <img src={d.thumbnailRef} alt="" />}</span>
        <div>
          <div className="fm-label">
            {kind ? PLUGIN_NAME[kind] : d.pluginId}에 {raw ? '원본 전체' : '사진 1장'} 전달
          </div>
          <div className="fm-readout">
            {formatBytes(d.bytes)} · 얼굴 {faces ?? '?'}
            {d.facesMasked > 0 ? ` · ${d.facesMasked}개 가림` : ''} · 방금
          </div>
        </div>
        <span className="fm-capsule fm-toastcard__pill">
          <span className="fm-dot" aria-hidden="true" />
          전달됨
        </span>
      </div>
    </div>
  );
}
