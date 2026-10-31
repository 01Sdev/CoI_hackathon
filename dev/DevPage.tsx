// /dev/ 화면. 제품 UI가 아니라 트랙 A 동작을 눈으로 확인하는 표다. 스토어를 읽고 A의 export만 쓴다.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { GAZE_CENTER_RADIUS } from '../src/core/constants';
import { selectConsentCount, selectFaceM, selectOutwardApps, selectThroughput } from '../src/core/selectors';
import { lensStore, useLensStore } from '../src/core/store';
import type { InputKind } from '../src/core/types';
import { getVideoUrl, setVideoUrl } from '../src/input/adapter';
import { MODEL_PATHS } from '../src/vision/config';
import { loadModels, loadSegmenter, mountPreview, subscribeModelState, subscribeSegmenterState, type ModelState, type SegmenterState } from '../src/vision';
import { getStage0Stats } from '../src/vision/stage0';
import { getTracks } from '../src/vision/gaze';

const box: CSSProperties = { border: '1px solid #333', borderRadius: 6, padding: 8, marginBottom: 8 };
const mono: CSSProperties = { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, whiteSpace: 'pre-wrap' };

export function DevPage() {
  // 1초마다 다시 그려 60초 창 숫자와 tick을 갱신한다(C의 tick 역할을 여기서 대신한다).
  const [, setNow] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      lensStore.getState().tick();
      setNow(performance.now());
    }, 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 12, display: 'grid', gap: 12, gridTemplateColumns: 'minmax(320px, 1fr) minmax(320px, 1fr)' }}>
      <section>
        <Controls />
        <Preview />
        <Presenter />
      </section>
      <section>
        <ModelStatus />
        <LiveObservation />
        <GazeConsent />
        <SceneDecisions />
        <Throughput />
        <Plugins />
        <Logs />
      </section>
    </main>
  );
}

function Controls() {
  const input = useLensStore((s) => s.session.input);
  const [url, setUrl] = useState(getVideoUrl());
  const pick = (kind: InputKind) => lensStore.getState().selectInput(kind);
  return (
    <div style={box}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => pick('webcam')}>웹캠</button>
        <button onClick={() => pick('rear')}>후면</button>
        <button
          onClick={() => {
            setVideoUrl(url);
            pick('video');
          }}
        >
          녹화
        </button>
        <input value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
      </div>
      <div style={mono}>
        입력: {input ? `${input.kind} ${input.width}×${input.height} fps=${input.fps || '?'}${input.fallbackFrom ? ` (${input.fallbackFrom} 실패 → 대체)` : ''}` : '없음'}
      </div>
    </div>
  );
}

function Preview() {
  const ref = useRef<HTMLDivElement>(null);
  const input = useLensStore((s) => s.session.input);
  const obs = useLensStore((s) => s.liveObservation);
  const frame = useLensStore((s) => s.session.captureFrame);
  useEffect(() => (ref.current ? mountPreview(ref.current) : undefined), []);
  const aspect = input && input.height > 0 ? `${input.width} / ${input.height}` : '16 / 9';
  const color = obs?.label === 'food' ? '#3c3' : obs?.label === 'person' ? '#39f' : '#fc3';
  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: aspect, maxHeight: '75vh', background: '#000' }}>
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} />
      {obs?.targetBox && (
        <div
          style={{
            position: 'absolute',
            left: `${obs.targetBox.x * 100}%`,
            top: `${obs.targetBox.y * 100}%`,
            width: `${obs.targetBox.w * 100}%`,
            height: `${obs.targetBox.h * 100}%`,
            border: `2px ${obs.label === 'none' ? 'dashed' : 'solid'} ${color}`,
            pointerEvents: 'none',
          }}
        >
          <span style={{ background: color, color: '#000', fontSize: 12, padding: '0 4px' }}>{obs.objectLabel}</span>
        </div>
      )}
      {/* F24 전송 범위 프레임(흰색) */}
      <div
        data-capture-frame=""
        style={{
          position: 'absolute',
          left: `${frame.x * 100}%`,
          top: `${frame.y * 100}%`,
          width: `${frame.w * 100}%`,
          height: `${frame.h * 100}%`,
          border: '2px solid #fff',
          pointerEvents: 'none',
        }}
      />
      {/* 판정 영역(가운데 60%) */}
      <div style={{ position: 'absolute', left: '20%', top: '20%', width: '60%', height: '60%', border: '1px dotted #666', pointerEvents: 'none' }} />
      <GazeOverlay width={input?.width ?? 16} height={input?.height ?? 9} />
    </div>
  );
}

/** 응시 원(짧은 변 × GAZE_CENTER_RADIUS)과 응시 대상 위 "마스크 해제" 칩(C 칩의 개발용 대역). 사람에게 박스는 그리지 않는다. */
function GazeOverlay({ width, height }: { width: number; height: number }) {
  const gaze = useLensStore((s) => s.gaze);
  const r = Math.min(width, height) * GAZE_CENTER_RADIUS;
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: `${(0.5 - r / width) * 100}%`,
          top: `${(0.5 - r / height) * 100}%`,
          width: `${((2 * r) / width) * 100}%`,
          height: `${((2 * r) / height) * 100}%`,
          border: `1px dashed ${gaze ? '#f6c' : '#888'}`,
          borderRadius: '50%',
          pointerEvents: 'none',
        }}
      />
      {gaze && (
        <button
          data-gaze-chip=""
          onClick={() => lensStore.getState().grantConsent(gaze.trackId)}
          style={{ position: 'absolute', left: `${(gaze.box.x + gaze.box.w / 2) * 100}%`, top: `${gaze.box.y * 100}%`, transform: 'translate(-50%, -110%)', fontSize: 12 }}
        >
          마스크 해제 ({gaze.trackId})
        </button>
      )}
    </>
  );
}

function ModelStatus() {
  const [st, setSt] = useState<ModelState>({ status: 'idle' });
  const [seg, setSeg] = useState<SegmenterState>({ status: 'idle' });
  useEffect(() => subscribeModelState(setSt), []);
  useEffect(() => subscribeSegmenterState(setSeg), []);
  return (
    <div style={box}>
      <b>모델</b>
      <div style={mono}>
        {st.status === 'ready' && `ready · ${st.delegate} · ${st.loadMs}ms`}
        {st.status === 'loading' && '불러오는 중…'}
        {st.status === 'idle' && '대기'}
        {st.status === 'missing' && `파일 없음: ${st.path}\n설정: src/vision/config.ts MODEL_PATHS = ${JSON.stringify(MODEL_PATHS)}`}
        {st.status === 'error' && `오류: ${st.message}`}
      </div>
      {(st.status === 'missing' || st.status === 'error') && <button onClick={() => void loadModels()}>다시 불러오기</button>}
      <div style={mono}>
        {`Selfie: ${seg.status}${seg.status === 'ready' ? ` · ${seg.delegate} · 로드 ${seg.loadMs}ms · 예열 ${seg.warmMs}ms` : ''}${seg.status === 'missing' ? ` (${seg.path}, 박스·사각형 전체로 가림)` : ''}${seg.status === 'error' ? ` ${seg.message}` : ''}`}
      </div>
      {(seg.status === 'missing' || seg.status === 'error') && <button onClick={() => void loadSegmenter()}>Selfie 다시 불러오기</button>}
    </div>
  );
}

function LiveObservation() {
  const obs = useLensStore((s) => s.liveObservation);
  return (
    <div style={box}>
      <b>0단계 실시간</b>
      <div style={mono}>
        {obs
          ? `확정 장면: ${obs.label}\n대상: ${obs.objectLabel ?? '-'} ${obs.targetBox ? fmtBox(obs.targetBox) : ''}\n화면 속 ${obs.peopleCount}명`
          : '없음'}
      </div>
    </div>
  );
}

/** 응시·동의(docs/designs/outfit-pipelines.md 파이프라인 1). Enter = 응시 대상에게 동의(글래스 버튼 대용). */
function GazeConsent() {
  const gaze = useLensStore((s) => s.gaze);
  const consents = useLensStore((s) => s.consents);
  const count = useLensStore((s) => selectConsentCount(s));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      const g = lensStore.getState().gaze;
      if (g) lensStore.getState().grantConsent(g.trackId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const now = performance.now();
  const tracks = getTracks();
  return (
    <div style={box}>
      <b>응시·동의 (사람 수 {count})</b>
      <div style={mono}>
        {`추적: ${tracks.length === 0 ? '없음' : tracks.map((t) => `${t.id}${now - t.lastSeenAt > 300 ? '(안 보임)' : ''}`).join(', ')}
`}
        {`응시 대상: ${gaze ? `${gaze.trackId} ${((now - gaze.since) / 1000).toFixed(1)}초 ${fmtBox(gaze.box)} (Enter·칩 = 동의)` : '없음'}
`}
        {Object.values(consents).length === 0
          ? '동의: 없음'
          : Object.values(consents).map((c) => `동의 ${c.trackId}: 남은 ${Math.max(0, (c.expiresAt - now) / 1000).toFixed(0)}초, ${((now - c.lastSeenAt) / 1000).toFixed(1)}초 전 봄`).join('\n')}
      </div>
      {Object.values(consents).map((c) => (
        <button key={c.trackId} onClick={() => lensStore.getState().revokeConsent(c.trackId)} style={{ marginRight: 6 }}>
          {c.trackId} 동의 끄기
        </button>
      ))}
    </div>
  );
}

function SceneDecisions() {
  const list = useLensStore(useShallow((s) => Object.values(s.sceneDecisions).slice(-5).reverse()));
  return (
    <div style={box}>
      <b>SceneDecision (최근 5)</b>
      <div style={mono}>
        {list.length === 0 ? '없음' : list.map((d) => `${d.label} · ${d.objectLabel} · ${d.score.toFixed(2)} · ${fmtBox(d.targetBox)} · t=${Math.round(d.confirmedAt)}`).join('\n')}
      </div>
    </div>
  );
}

function Throughput() {
  const t = useLensStore(useShallow((s) => selectThroughput(s)));
  const st = getStage0Stats();
  const n = (v: number | null, d = 1) => (v === null ? '-' : v.toFixed(d));
  return (
    <div style={box}>
      <b>처리량(직전 60초)</b>
      <div style={mono}>
        {`0단계 ${t.stage0Runs} · 얼굴 ${t.faceDetectRuns} · 소스 프레임 ${t.sourceFrames} · 전달 ${t.deliveries} · 보류 ${t.holds}\n비율 ${n(t.ratio, 3)}\n0단계 실측 ${n(st.fps)}fps · 추론 평균 ${n(st.meanInferMs)}ms · p95 ${n(st.p95InferMs)}ms\n첫 판정 ${n(st.firstInferenceAt, 0)}ms(페이지 시작부터)`}
      </div>
    </div>
  );
}

export function fmtBox(b: { x: number; y: number; w: number; h: number }): string {
  const f = (n: number) => n.toFixed(2);
  return `[${f(b.x)}, ${f(b.y)}, ${f(b.w)}, ${f(b.h)}]`;
}

const CALORIE_BASE = { purpose: '음식 칼로리 추정', scenes: ['food'], region: 'target', quality: 0.8, maxPerMinute: 6, network: ['$ORIGIN'] };

function Presenter() {
  const { compareMode, paused } = useLensStore(useShallow((s) => ({ compareMode: s.session.compareMode, paused: s.session.paused })));
  const m = useLensStore((s) => selectFaceM(s));
  const k = useLensStore((s) => selectOutwardApps(s));
  const [msg, setMsg] = useState('');
  const apply = (maxSide: number, maxPerMinute = 6) => {
    const r = lensStore.getState().applyManifest('calorie', JSON.stringify({ ...CALORIE_BASE, maxSide, maxPerMinute }));
    setMsg(r.ok ? `calorie maxSide ${maxSide}, maxPerMinute ${maxPerMinute} 적용` : r.errors.join(', '));
  };
  return (
    <div style={{ ...box, marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button onClick={() => lensStore.getState().setCompareMode(!compareMode)}>비교 모드 {compareMode ? '끄기' : '켜기'}</button>
        <button onClick={() => lensStore.getState().setPaused(!paused)}>{paused ? '전달 재개' : '전달 일시 정지'}</button>
        <button onClick={() => lensStore.getState().startNewSession()}>새 세션</button>
        <button onClick={() => apply(256)}>maxSide 256</button>
        <button onClick={() => apply(64)}>maxSide 64</button>
        <button onClick={() => apply(256, 30)}>maxPerMinute 30</button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        <span style={mono}>프레임:</span>
        <button onClick={() => lensStore.getState().setCaptureFrame({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 })}>가운데 60%</button>
        <button onClick={() => lensStore.getState().setCaptureFrame({ x: 0.5, y: 0.2, w: 0.5, h: 0.6 })}>오른쪽 절반</button>
        <button onClick={() => lensStore.getState().setCaptureFrame({ x: 0, y: 0, w: 1, h: 0.15 })}>맨 위 띠(대상 밖)</button>
        <button onClick={() => lensStore.getState().setCaptureFrame({ x: 0, y: 0, w: 1, h: 1 })}>전체</button>
      </div>
      <div style={mono}>{`비교 모드 ${compareMode ? '켜짐' : '꺼짐'} · 일시 정지 ${paused ? '예' : '아니오'} · M ${m} · K ${k}${msg ? `\n${msg}` : ''}`}</div>
    </div>
  );
}

function Plugins() {
  const rows = useLensStore(
    useShallow((s) =>
      s.pluginOrder.map((id) => {
        const p = s.plugins[id];
        return p ? `${id}|${p.enabled}|${p.status}|${p.gateOpen}|${p.busy}|${Math.round(p.cooldownUntil)}|${p.manifest.version}|${p.runtimePolicy?.manifestVersion ?? '-'}|${p.runtimePolicy?.connect ?? '-'}|${p.manifest.maxSide}` : id;
      }),
    ),
  );
  return (
    <div style={box}>
      <b>플러그인(목 호스트)</b>
      <div style={mono}>
        {rows.map((r) => {
          const [id, enabled, status, gate, busy, cd, ver, rver, connect, maxSide] = r.split('|');
          return (
            <div key={id}>
              <label>
                <input type="checkbox" checked={enabled === 'true'} onChange={(e) => lensStore.getState().setPluginEnabled(id as string, e.target.checked)} /> {id}
              </label>
              {` ${status} gate=${gate} busy=${busy} cooldownUntil=${cd} v${ver}/iframe v${rver} ${connect} maxSide=${maxSide}`}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Logs() {
  const logs = useLensStore(useShallow((s) => s.logs.slice(-12).reverse()));
  const deliveries = useLensStore((s) => s.deliveries);
  const detections = useLensStore((s) => s.detections);
  return (
    <div style={box}>
      <b>로그(최근 12)</b>
      {logs.length === 0 && <div style={mono}>없음</div>}
      {logs.map((l) => {
        const d = l.deliveryId ? deliveries[l.deliveryId] : undefined;
        const dets = detections[l.id] ?? [];
        return (
          <div key={l.id} data-log-kind={l.kind} data-branch={l.branch ?? ''} style={{ display: 'flex', gap: 8, borderTop: '1px solid #222', padding: '4px 0' }}>
            {d?.thumbnailRef ? <img src={d.thumbnailRef} alt="" style={{ width: 72, height: 72, objectFit: 'contain', background: '#000' }} /> : <div style={{ width: 72 }} />}
            <div style={mono}>
              {`${l.kind} ${l.pluginId} ${l.branch ?? '-'} ${l.reason}${l.frameRect ? ` · 프레임 ${l.frameRect.w}×${l.frameRect.h}` : ''}`}
              {d &&
                `\n${d.objectLabel} ${d.width}×${d.height} ${d.bytes}B 비율 ${d.areaRatio.toFixed(3)} 가림 ${d.facesMasked} 재검사 ${d.faceCheck.status === 'checked' ? d.faceCheck.detectedFaces : 'error'}\n${d.sendStatus} ack=${d.ackStatus} 위치=${d.location} crop=${fmtBox(d.cropRect)}`}
              {dets.length > 0 && `\n검출: ${dets.map((x) => `${x.kind}${x.masked !== 'none' ? `(${x.masked})` : ''} ${x.score.toFixed(2)}${x.overlap !== null ? ` 겹침 ${x.overlap.toFixed(2)}` : ''}`).join(', ')}`}
            </div>
          </div>
        );
      })}
    </div>
  );
}
