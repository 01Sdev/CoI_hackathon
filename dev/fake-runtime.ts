// 가짜 런타임(개발 전용, 프로덕션 빌드 제외). A·B가 없을 때 C 화면을 확인하려고 A·B가 부를 스토어 액션만 같은 순서로 부른다.
// 숫자·문구는 가짜이며 실측이 아니다. 썸네일은 SVG(캔버스·카메라 접근 없음, 02-SSRD §1).
//
// A 흉내: inputRequest → setInput(거부 시뮬레이션이면 녹화 영상으로 자동 전환), setEngine 진행 → ready/failed,
//         5fps setLiveObservation·recordRuns, 쿨다운마다 prepareDelivery(2a·2b·2c) 또는 addLog(hold 2d), 비교 모드면 raw.
// B 흉내: selectDesiredRuntime 구독 → loading → 0.5초 뒤 ready(게이트 열기), markDelivery·setAck·setResult,
//         변조 플러그인이 켜지면 violation 4건(plugin-report), network가 비면 칼로리 호출 차단 기록 + 고정표.

import { shallow } from 'zustand/shallow';
import { newId, type LensStore, type NewDetection } from '../src/core/store';
import { selectCanSend, selectDesiredRuntime, type DesiredRuntime } from '../src/core/selectors';
import type { Box, DeliveryBranch, InputKind, SceneLabel } from '../src/core/types';

export interface FakeOptions {
  /** 카메라 거부 → 녹화 영상 자동 전환(F1). */
  deny: boolean;
  /** 판정 엔진 실패(NFR-022). */
  fail: boolean;
  /** 모델 받는 데 걸리는 시간(ms). */
  loadMs: number;
  /** 쿨다운마다 자동 전달. */
  auto: boolean;
}

export type AckMode = 'match' | 'mismatch' | 'timeout';

export interface FakeControls {
  deliverNow(kind?: DeliveryBranch | '2d'): void;
  personScene(ms: number): void;
  failEngine(): void;
  setNextAck(mode: AckMode): void;
  failNextTransition(): void;
  fill(n: number): void;
  setAuto(on: boolean): void;
  isAuto(): boolean;
}

const NORMAL_CYCLE: Array<DeliveryBranch | '2d'> = ['2a', '2b', '2a', '2c', '2d'];

function svgThumb(kind: DeliveryBranch): Blob {
  const raw = kind === 'raw';
  const people = raw
    ? '<circle cx="206" cy="58" r="20" fill="#9a8f84"/><rect x="180" y="80" width="52" height="90" rx="22" fill="#8a8077"/><circle cx="40" cy="64" r="16" fill="#a39689"/><rect x="18" y="82" width="44" height="80" rx="18" fill="#958a80"/>'
    : '';
  const mask =
    kind === '2b'
      ? '<g fill="#bdb3a7"><rect x="196" y="12" width="12" height="12"/><rect x="220" y="24" width="12" height="12" fill="#8e857b"/><rect x="208" y="24" width="12" height="12"/><rect x="196" y="36" width="12" height="12" fill="#8e857b"/></g>'
      : kind === '2c'
        ? '<rect x="168" y="0" width="88" height="70" fill="#8e857b"/>'
        : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 192"><rect width="256" height="192" fill="${raw ? '#4a3d33' : '#3b332c'}"/><ellipse cx="128" cy="122" rx="104" ry="42" fill="#e9e1d6"/><text x="128" y="140" font-size="92" text-anchor="middle">🍕</text>${people}${mask}</svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}

function hex(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

const TARGET: Box = { x: 0.25, y: 0.33, w: 0.5, h: 0.18 };

export function startFakeRuntime(store: LensStore, opts: FakeOptions): FakeControls {
  const st = store.getState;
  const now = () => performance.now();
  let auto = opts.auto;
  let nextAck: AckMode = 'match';
  let failNext = false;
  let personUntil = 0;
  let cycle = 0;
  let sceneId: string | null = null;
  let sceneSession = '';
  let obsTimer = 0;

  // ── A: 입력 ──
  store.subscribe(
    (s) => s.session.inputRequest,
    (req) => {
      if (!req) return;
      window.setTimeout(() => {
        const wide = req.kind === 'webcam';
        const deny = opts.deny && req.kind !== 'video';
        const kind: InputKind = deny ? 'video' : req.kind;
        st().setInput({
          kind,
          width: wide ? 1280 : 720,
          height: wide ? 720 : 1280,
          fps: 30,
          fallbackFrom: deny ? req.kind : null,
        });
        if (st().engine.status === 'idle') loadEngine();
      }, 350);
    },
    { fireImmediately: true },
  );

  // ── A: 엔진 ──
  function loadEngine() {
    const total = 7_600_000;
    const started = now();
    st().setEngine({ status: 'loading', loadedBytes: 0, totalBytes: total, detail: null });
    const t = window.setInterval(() => {
      const f = Math.min(1, (now() - started) / opts.loadMs);
      st().setEngine({ loadedBytes: Math.round(total * f) });
      if (f < 1) return;
      window.clearInterval(t);
      if (opts.fail) st().setEngine({ status: 'failed', detail: 'GPU 실패 → CPU 재시도 실패' });
      else {
        st().setEngine({ status: 'ready' });
        obsTimer = window.setInterval(observe, 200);
      }
    }, 150);
  }

  function scene(): SceneLabel {
    return now() < personUntil ? 'person' : 'food';
  }

  // ── A: 0단계 5fps ──
  function observe() {
    const s = st();
    if (s.engine.status !== 'ready') return;
    const t = now() / 1000;
    const label = scene();
    const box: Box = { ...TARGET, x: TARGET.x + 0.03 * Math.sin(t * 0.8), y: TARGET.y + 0.015 * Math.cos(t * 0.6) };
    s.setLiveObservation({
      label,
      objectLabel: label === 'food' ? 'pizza' : label === 'person' ? 'person' : null,
      targetBox: label === 'none' ? null : box,
      peopleCount: s.session.compareMode ? 2 : 1,
      at: now(),
    });
    s.recordRuns({ stage0Runs: 1, sourceFrames: 6 });
    if (sceneSession !== s.session.id || !sceneId || !s.sceneDecisions[sceneId]) {
      sceneSession = s.session.id;
      sceneId = s.addSceneDecision({ label: 'food', objectLabel: 'pizza', targetBox: box, score: 0.94 }).id;
    }
    if (label === 'person') {
      for (const id of s.pluginOrder) {
        const p = s.plugins[id];
        if (p?.enabled && !p.manifest.scenes.includes('person')) {
          s.addLog({ pluginId: id, sceneDecisionId: null, kind: 'skip', branch: null, reason: '선언하지 않은 장면(person)', enforcedBy: null });
        }
      }
      return;
    }
    const cal = s.plugins.calorie;
    if (auto && cal && selectCanSend(s, 'calorie') && !cal.busy && now() >= cal.cooldownUntil) capture();
  }

  // ── A: 포착 → 분기 → 중개기 ──
  function capture(force?: DeliveryBranch | '2d', instant = false) {
    const s = st();
    const p = s.plugins.calorie;
    if (!p || !selectCanSend(s, 'calorie') || !p.runtimeId || !p.runtimePolicy) return;
    const kind: DeliveryBranch | '2d' = force ?? (s.session.compareMode ? 'raw' : NORMAL_CYCLE[cycle++ % NORMAL_CYCLE.length]!);
    const cooldown = now() + 60_000 / p.manifest.maxPerMinute;
    const face: NewDetection = { kind: 'face', box: { x: 0.78, y: 0.06, w: 0.12, h: 0.2 }, score: 0.82, overlap: null, masked: 'face' };
    const person: NewDetection = { kind: 'person', box: { x: 0.7, y: 0, w: 0.3, h: 1 }, score: 0.91, overlap: 0.14, masked: 'none' };

    if (kind === '2d') {
      s.addLog(
        { pluginId: 'calorie', sceneDecisionId: sceneId, kind: 'hold', branch: '2d', reason: '얼굴 위치 불확실', enforcedBy: null },
        [{ ...person, overlap: 0.56 }],
      );
      s.setPluginBusy('calorie', false, cooldown);
      return;
    }
    s.setPluginBusy('calorie', true);
    const go = () => {
      const cur = st().plugins.calorie;
      if (!cur?.runtimeId || !cur.runtimePolicy) return;
      const raw = kind === 'raw';
      const side = raw ? 1280 : cur.manifest.maxSide;
      const blob = svgThumb(kind);
      const url = URL.createObjectURL(blob);
      const scale = (side / 256) ** 2;
      const bytes = raw ? 212_000 + Math.round(Math.random() * 6000) : Math.round((18_000 + Math.random() * 1500) * scale);
      const res = st().prepareDelivery(
        {
          pluginId: 'calorie',
          manifestVersion: cur.runtimePolicy.manifestVersion,
          runtimeId: cur.runtimeId,
          scene: 'food',
          objectLabel: 'pizza',
          branch: kind,
          bytes,
          width: side,
          height: Math.round(side * 0.75),
          areaRatio: raw ? 1 : 0.058 + Math.random() * 0.01,
          cropRect: raw ? { x: 0, y: 0, w: 720, h: 1280 } : { x: 160, y: 380, w: 400, h: 300 },
          facesMasked: kind === '2b' || kind === '2c' ? 1 : 0,
          faceCheck: { status: 'checked', detectedFaces: raw ? 2 : 0 },
          location: 'browser',
          sha256: hex(64),
          thumbnailRef: url,
          blob,
        },
        { sceneDecisionId: sceneId },
        kind === '2b' ? [face, person] : kind === '2c' ? [{ ...face, masked: 'head' }, person] : raw ? [] : [],
      );
      st().setPluginBusy('calorie', false, cooldown);
      if (!res) {
        URL.revokeObjectURL(url);
        return;
      }
      st().recordRuns({ faceDetectRuns: 2 });
      const id = res.delivery.id;
      const dispatch = () => {
        st().markDelivery(id, 'dispatched');
        const ack = nextAck;
        nextAck = 'match';
        const sha = st().deliveries[id]?.sha256 ?? '';
        if (ack === 'timeout') window.setTimeout(() => st().setAck(id, null), 2000);
        else window.setTimeout(() => st().setAck(id, ack === 'match' ? sha : hex(64)), instant ? 0 : 260);
        window.setTimeout(() => result(id), instant ? 0 : 700);
      };
      if (instant) dispatch();
      else window.setTimeout(dispatch, 90);
    };
    if (instant) go();
    else window.setTimeout(go, 260);
  }

  // ── B: 결과 줄 ──
  function result(deliveryId: string) {
    const s = st();
    const p = s.plugins.calorie;
    if (!p) return;
    const at = now();
    if (s.session.compareMode) {
      s.setResult('calorie', { deliveryId, text: '피자 약 285kcal', source: 'fallback', at });
      return;
    }
    if (p.allowedOrigins.length === 0) {
      s.addLog({ pluginId: 'calorie', sceneDecisionId: null, kind: 'violation', branch: null, reason: '/api/calorie 요청 · 허용 목록 밖 · 차단됨', enforcedBy: 'plugin-report' });
      s.setResult('calorie', { deliveryId, text: '피자 약 285kcal', source: 'fallback', at });
      return;
    }
    s.setResult('calorie', { deliveryId, text: `피자 약 ${270 + Math.round(Math.random() * 30)}kcal`, source: 'api', at });
  }

  // ── B: 전환 공통 절차(최신 값만 본다) ──
  for (const id of st().pluginOrder) {
    store.subscribe(
      (s) => selectDesiredRuntime(s, id),
      (want) => {
        if (!want) return;
        if (!want.enabled) {
          // stopped(전환 실패)는 스토어가 enabled를 끄며 생긴 변화라 그대로 둔다. 사용자가 다시 켜야 풀린다.
          const status = st().plugins[id]?.status;
          if (status !== 'terminated' && status !== 'stopped') st().setPluginRuntime(id, { status: 'terminated', runtimeId: null, runtimePolicy: null });
          return;
        }
        st().setPluginRuntime(id, { status: 'loading' });
        const runtimeId = newId('rt');
        const doomed = failNext;
        failNext = false;
        window.setTimeout(
          () => {
            const cur = selectDesiredRuntime(st(), id);
            if (!cur || !shallow<DesiredRuntime>(cur, want)) return; // 그 사이 값이 또 바뀌었다
            if (doomed) {
              st().setPluginRuntime(id, { status: 'stopped', runtimeId: null, runtimePolicy: null });
              return;
            }
            st().setPluginRuntime(id, {
              status: 'ready',
              runtimeId,
              runtimePolicy: { connect: want.connect, manifestVersion: want.manifestVersion },
              gateOpen: true,
              // 이 iframe을 만든 값. 그 사이 바뀌었으면 스토어가 게이트를 열지 않는다(cb9fec9).
              desired: want,
            });
            if (st().plugins[id]?.kind === 'tamper') tamperAttempts(id);
          },
          doomed ? 3000 : 500,
        );
      },
      { equalityFn: shallow, fireImmediately: true },
    );
  }

  function tamperAttempts(id: string) {
    const reasons = [
      '카메라 요청(getUserMedia) · 차단됨',
      '호스트 화면 접근(document) · 차단됨',
      'https://collector.example 요청 · 허용 목록 밖 · 차단됨',
      'https://cdn.example/x.js 로드 · 허용 목록 밖 · 차단됨',
    ];
    reasons.forEach((reason, i) =>
      window.setTimeout(
        () => st().addLog({ pluginId: id, sceneDecisionId: null, kind: 'violation', branch: null, reason, enforcedBy: 'plugin-report' }),
        300 + i * 250,
      ),
    );
  }

  return {
    deliverNow: (kind) => capture(kind),
    personScene: (ms) => {
      personUntil = now() + ms;
    },
    failEngine: () => {
      window.clearInterval(obsTimer);
      st().setLiveObservation(null);
      st().setEngine({ status: 'failed', detail: 'GPU 실패 → CPU 재시도 실패' });
    },
    setNextAck: (mode) => {
      nextAck = mode;
    },
    failNextTransition: () => {
      failNext = true;
    },
    fill: (n) => {
      for (let i = 0; i < n; i++) capture('2a', true);
    },
    setAuto: (on) => {
      auto = on;
    },
    isAuto: () => auto,
  };
}
