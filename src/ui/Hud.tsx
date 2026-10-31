// 글래스 HUD 한 컴포넌트(F8, FR-034·036). 세 화면에 같은 컴포넌트를 쓰고 배치만 variant로 바꾼다.
// 다섯 요소: 장면 · 입력 · 대상 위치 · 카운터(M, "화면 속 N명") · 결과. 요소 밖: 비교 모드 띠, 보류 줄, 전달 신호,
// 전송 범위 프레임(F24, 흰 뷰파인더 틀). 플러그인 결과는 틀과 상관없는 자리에 둔다(PRD F24 표시 규칙).
// 결과는 framelet과 앱을 나눠 보이려고 카운터에서 떼어 앱 카드에 둔다(app-structure §3.1). 휴대폰·데스크톱은
// 카운터 아래 따로 띄운 카드, /hud는 배치를 그대로 두고 앱 이름으로 시작하는 줄이다.
// 사람에게는 박스나 표시를 그리지 않는다(사용자 결정). 대상 프레임은 장면이 음식일 때만 그린다.
// 휴대폰·데스크톱의 "입력" 요소는 위쪽 줄 입력 캡슐(TopBar)이고, /hud에서는 오른쪽 위 글자다.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { selectFaceM } from '../core/selectors';
import { lensStore, useLensStore, type LensState } from '../core/store';
import type { Delivery, PluginKind } from '../core/types';
import { CaptureFrame } from './CaptureFrame';
import { coverBox, faceWindowRemaining, type Size } from './geometry';
import { ago } from '../proof/format';
import { appResultLine, deliverySignalLines, INPUT_LABEL, objectName, PLUGIN_ICON, PLUGIN_NAME, SCENE_LABEL } from './labels';
import { OrbStack } from './OrbStack';
import { sanitizeAppText } from './sanitize';
import { useDeliverySignal, useHoldSignal, useRecent } from './useSignals';

export type HudVariant = 'phone' | 'desktop' | 'hud';

export function Hud({
  variant,
  onOpenConfirm,
  frameEditing,
  onFrameEditing,
}: {
  variant: HudVariant;
  onOpenConfirm?: () => void;
  /** 전송 범위 프레임 조절 중(휴대폰은 이때 하단 시트를 내린다). */
  frameEditing?: boolean;
  onFrameEditing?: (on: boolean) => void;
}) {
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
      <CaptureFrame size={size} adjustable={glass} editing={frameEditing} onEditing={onFrameEditing} />
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
      {glass && showToast && delivery.last && <DeliveryToast key={`toast-${delivery.count}`} d={delivery.last} />}
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
        {glass && <AppResults />}
      </div>
      {delivery.count > 0 && <div key={`flash-${delivery.count}`} className="fm-hud__flash fm-flash" aria-hidden="true" />}
    </div>
  );
}

function useElementSize(ref: RefObject<HTMLElement>): Size {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 처음 크기는 바로 읽는다. ResizeObserver는 다음 렌더링 단계에서야 불리고, 보이지 않는 탭에서는 불리지 않는다.
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
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
  const results = useAppResults();
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
  // /hud만 오브 아래 줄로 둔다. 휴대폰·데스크톱의 결과는 AppResults(카운터와 떨어진 앱 카드)다.
  const resultNode =
    hud && results.length > 0 ? (
      <span className="fm-hud__applines">
        {results.map((r) => (
          <span key={r.pluginId} className="fm-hud__appline">
            {appResultLine(r.name, r.text, r.fallback)}
          </span>
        ))}
      </span>
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

interface AppResult {
  pluginId: string;
  kind: PluginKind;
  name: string;
  text: string;
  fallback: boolean;
}

/**
 * 켜져 있는 앱의 마지막 결과(앱마다 1줄, pluginOrder 순). 문자열은 sanitizeAppText로 거르고, 거른 뒤 비면 카드를 두지 않는다.
 * "고정표"는 칼로리의 미리 정한 표라 칼로리에만 붙인다.
 */
function useAppResults(): AppResult[] {
  const results = useLensStore((s) => s.results);
  const plugins = useLensStore((s) => s.plugins);
  const order = useLensStore((s) => s.pluginOrder);
  const out: AppResult[] = [];
  for (const id of order) {
    const p = plugins[id];
    const r = results[id];
    const text = p?.enabled && r ? sanitizeAppText(r.text) : '';
    if (!p || !r || !text) continue;
    out.push({ pluginId: id, kind: p.kind, name: PLUGIN_NAME[p.kind], text, fallback: p.kind === 'calorie' && r.source === 'fallback' });
  }
  return out;
}

/**
 * 앱 카드(휴대폰·데스크톱). 바깥 칸과 머리줄(글자 아이콘·앱 이름·"앱이 보낸 결과")은 framelet이 그리고,
 * 안쪽 칸에만 앱 문자열이 textContent로 들어간다. 안쪽 칸은 테마와 상관없이 바깥 칸과 밝기가 반대다.
 * 앱이 둘 이상이면 옆으로 넘긴다.
 */
function AppResults() {
  const results = useAppResults();
  if (results.length === 0) return null;
  return (
    <section className="fm-appresults" aria-label="앱 결과">
      {results.map((r) => (
        <article key={r.pluginId} className="fm-appcard fm-glass fm-glass--panel" aria-label={`${r.name} 앱이 보낸 결과`}>
          <div className="fm-appcard__head">
            <span className="fm-appicon" aria-hidden="true">
              {PLUGIN_ICON[r.kind]}
            </span>
            <span className="fm-appcard__name">{r.name}</span>
            <span className="fm-appcard__tag">앱이 보낸 결과</span>
          </div>
          <div className="fm-appcard__body">
            <span className="fm-appcard__text">{r.text}</span>
            {r.fallback && <span className="fm-appcard__note">고정표</span>}
          </div>
        </article>
      ))}
    </section>
  );
}

/** 보조 신호: 위에서 내려와 3초 뒤 사라지는 알림(휴대폰·데스크톱만). */
function DeliveryToast({ d }: { d: Delivery }) {
  const kind = useLensStore((s) => s.plugins[d.pluginId]?.kind);
  const raw = d.branch === 'raw';
  const [who, what] = deliverySignalLines(kind ? PLUGIN_NAME[kind] : d.pluginId, d, ago(performance.now() - d.processedAt));
  return (
    <div className="fm-hud__toast">
      <div className="fm-toast fm-toastcard fm-glass fm-glass--panel" data-tone={raw ? 'exposed' : 'safe'} role="status">
        <span className="fm-thumb">{d.thumbnailRef && <img src={d.thumbnailRef} alt="" />}</span>
        <div>
          <div className="fm-label">{who}</div>
          <div className="fm-readout">{what}</div>
        </div>
        <span className="fm-capsule fm-toastcard__pill">
          <span className="fm-dot" aria-hidden="true" />
          전달됨
        </span>
      </div>
    </div>
  );
}
