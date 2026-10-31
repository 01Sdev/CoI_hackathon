// "/" 첫 진입 흐름(docs/designs/glass-home.md, 사용자 요구 2026-11-01). 스마트 글래스가 없어 아이폰 사파리로 글래스 시야를 흉내 낸다.
// 카메라 권한 질문(거부·오류면 안내 화면) → AR 홈(비전 프로 배치 4/5/4, 정가운데 framelet) → framelet 런처(칼로리·코디 스캔·변조 시험·추가...) → 고른 앱.
// 카메라 영상은 A의 mountPreview(Stage의 Preview)가 그리고, 광각 휘어짐도 A가 입력 단계에서 넣는다. C는 <video>·원본 픽셀을 만지지 않는다.
// 글래스 느낌은 가장자리를 살짝 어둡게 하는 비네트와 둥근 시야 가장자리로만 낸다(시야각 숫자는 적지 않는다).
// 플러그인은 런처에서 고를 때 그 하나만 켜고, 런처·홈으로 돌아오면 끈다(setPluginEnabled). 앱 화면은 기존 글래스 HUD(Hud)다.
// 홈 알약(화면 아래 가운데)은 비전 프로 디지털 크라운 역할: 앱 → 런처, 런처 → 홈.

import { useEffect, useReducer, useRef, useState, type CSSProperties } from 'react';
import { APP_NAME } from '../core/constants';
import { lensStore, useLensStore } from '../core/store';
import type { InputKind } from '../core/types';
import { FrameletMark, HOME_ICON_BG, HomeIcon, LAUNCHER_BG, LauncherIcon } from './GlassIcons';
import { cameraFor, enabledKind, glassReduce, homeApps, homeRows, type GlassScreen, type LauncherApp } from './glassHome';
import { Hud } from './Hud';
import { unlockAudio } from './signal';
import { EngineGate, Stage } from './Stage';
import type { LayoutMode } from './useLayoutMode';
import './glass-home.css';

/** 눌림 애니메이션(0.92배)이 보인 뒤에 열리게 기다리는 시간. 움직임 줄이기면 기다리지 않는다. */
const PRESS_MS = 160;
const TOAST_MS = 2200;

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function GlassFlow({ layout, autostart = false }: { layout: LayoutMode; autostart?: boolean }) {
  const [screen, dispatch] = useReducer(glassReduce, autostart ? { name: 'home' } : { name: 'permission' });
  const selectInput = useLensStore((s) => s.selectInput);
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  // framelet 아이콘 자리에서 런처가 커지며 열리게, 누른 아이콘의 중심(화면 비율)을 둔다.
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  usePluginsFor(screen);
  // 권한 창 거부·카메라 오류: A가 녹화 영상으로 바꾸며 fallbackFrom을 남긴다. 이 흐름에서는 안내 화면으로 간다.
  const cameraFailed = useLensStore((s) => s.session.input?.fallbackFrom != null);
  useEffect(() => {
    if (cameraFailed) dispatch({ type: 'camera-off' });
  }, [cameraFailed]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(t);
  }, [toast]);

  // 녹화 영상 대체(/demo 영상)는 이 흐름에서 쓰지 않는다(사용자 결정 2026-11-01): 안내와 새로고침만 둔다.
  // Stage가 사라지면 A의 mountPreview 정리가 녹화 영상도 멈춘다.
  if (screen.name === 'no-camera') return <NoCamera />;

  if (screen.name === 'permission') {
    // 아이폰 가로(874px)는 폭으로는 데스크톱이라, 폭이 아니라 터치 기기인지로 후면 카메라를 고른다.
    const camera: InputKind = cameraFor(layout, typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
    return (
      <Permission
        onAllow={() => {
          unlockAudio();
          selectInput(camera);
          dispatch({ type: 'allow' });
        }}
        onDeny={() => dispatch({ type: 'camera-off' })}
      />
    );
  }

  const say = (text: string) => setToast((t) => ({ text, n: (t?.n ?? 0) + 1 }));

  return (
    <div className="fm-glasshome" data-screen={screen.name}>
      <Stage className="fm-glasshome__stage">
        {screen.name === 'home' && (
          <ArHome
            onOpenFramelet={(at) => {
              setOrigin(at);
              dispatch({ type: 'open-framelet' });
            }}
            onStock={() => say('시연에서는 열리지 않아요')}
          />
        )}
        {screen.name === 'launcher' && (
          <Launcher origin={origin} onOpen={(app) => dispatch({ type: 'open-app', app })} onAdd={() => say('앱 추가는 다음 단계예요')} />
        )}
        {screen.name === 'app' && <EngineGate ready={<Hud variant="phone" />} />}
        <div className="fm-glasshome__lens" aria-hidden="true" />
        {toast && (
          <p key={toast.n} className="fm-glasshome__toast" role="status">
            {toast.text}
          </p>
        )}
        {screen.name !== 'home' && (
          <button
            type="button"
            className="fm-glasshome__pill"
            aria-label={screen.name === 'app' ? `${APP_NAME} 앱으로 돌아가기` : '홈으로 돌아가기'}
            onClick={() => dispatch({ type: 'home-pill' })}
          >
            <span aria-hidden="true" />
          </button>
        )}
      </Stage>
    </div>
  );
}

/** 지금 화면에서 켜 둘 플러그인만 켜고 나머지는 끈다. 런처에서 고를 때 실행되고, 런처·홈으로 돌아오면 멈춘다. */
function usePluginsFor(screen: GlassScreen) {
  const want = enabledKind(screen);
  useEffect(() => {
    const s = lensStore.getState();
    for (const id of s.pluginOrder) {
      const p = s.plugins[id];
      if (!p) continue;
      const on = p.kind === want;
      if (p.enabled !== on) s.setPluginEnabled(id, on);
    }
  }, [want]);
}

/** 카메라 권한만 담백하게 묻는다(사용자 요청 2026-11-01): 질문 한 줄과 버튼 둘. */
function Permission({ onAllow, onDeny }: { onAllow(): void; onDeny(): void }) {
  return (
    <main className="fm-glassperm">
      <div className="fm-glassperm__body" role="dialog" aria-labelledby="fm-glassperm-q">
        <p id="fm-glassperm-q" className="fm-glassperm__question">
          카메라 권한을 허용할까요?
        </p>
        <div className="fm-glassperm__actions">
          <button type="button" className="fm-glassperm__btn" onClick={onDeny}>
            허용 안 함
          </button>
          <button type="button" className="fm-glassperm__btn fm-glassperm__btn--primary" onClick={onAllow}>
            허용
          </button>
        </div>
      </div>
    </main>
  );
}

/**
 * 카메라 없이는 볼 수 없다는 안내(권한 질문과 같은 톤). "다시 시도"는 새로고침해서 권한 질문부터 다시 한다.
 * iOS 사파리는 한 번 거부하면 새로고침 전까지 다시 묻지 않는다.
 */
function NoCamera() {
  return (
    <main className="fm-glassperm">
      <div className="fm-glassperm__body" role="alertdialog" aria-labelledby="fm-glassperm-off">
        <p id="fm-glassperm-off" className="fm-glassperm__question">
          카메라 없이는 볼 수 없어요.
        </p>
        <div className="fm-glassperm__actions">
          <button type="button" className="fm-glassperm__btn fm-glassperm__btn--primary" onClick={() => location.reload()}>
            다시 시도
          </button>
        </div>
      </div>
    </main>
  );
}

/** 누르면 0.92배로 눌렸다가 돌아온 뒤 열린다. 움직임 줄이기면 바로 연다. */
function usePress(): [string | null, (key: string, run: () => void) => void] {
  const [pressed, setPressed] = useState<string | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const press = (key: string, run: () => void) => {
    if (reducedMotion()) return run();
    setPressed(key);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setPressed(null);
      run();
    }, PRESS_MS);
  };
  return [pressed, press];
}

function ArHome({ onOpenFramelet, onStock }: { onOpenFramelet(at: { x: number; y: number }): void; onStock(): void }) {
  const [pressed, press] = usePress();
  const rows = homeRows(homeApps(APP_NAME));
  return (
    <nav className="fm-ar" aria-label="글래스 홈">
      {rows.map((row, r) => (
        <div key={r} className="fm-ar__row">
          {row.map((app) => (
            <button
              key={app.id}
              type="button"
              className="fm-ar__app"
              data-app={app.id}
              data-pressed={pressed === app.id}
              onClick={(e) => {
                const box = e.currentTarget.getBoundingClientRect();
                const stage = e.currentTarget.closest('.fm-stage')?.getBoundingClientRect();
                const at = stage
                  ? { x: (box.left + box.width / 2 - stage.left) / stage.width, y: (box.top + box.height / 2 - stage.top) / stage.height }
                  : { x: 0.5, y: 0.5 };
                press(app.id, () => (app.id === 'framelet' ? onOpenFramelet(at) : onStock()));
              }}
            >
              <span className="fm-ar__icon" style={{ background: HOME_ICON_BG[app.id] }}>
                <HomeIcon id={app.id} />
              </span>
              <span className="fm-ar__label">{app.label}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

const LAUNCHER_APPS: Array<{ app: LauncherApp | 'add'; label: string }> = [
  { app: 'calorie', label: '칼로리' },
  { app: 'outfit', label: '코디 스캔' },
  { app: 'tamper', label: '변조 시험' },
  { app: 'add', label: '추가...' },
];
const FRAME_HANDLES = ['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e'] as const;

/**
 * framelet 앱 = 런처. 버튼 넷을 #44 흰 틀(1px 선, ㄱ자 손잡이, 변 가운데 막대)이 사방으로 감싼다. 틀은 장식이라 끌 수 없다.
 * 사람 수 표시는 뺐다: 런처에서는 아무 앱도 돌지 않아 넘어가는 사람이 없다(앱 화면의 흰 틀에는 있다).
 */
function Launcher({ origin, onOpen, onAdd }: { origin: { x: number; y: number } | null; onOpen(app: LauncherApp): void; onAdd(): void }) {
  const [pressed, press] = usePress();
  const style = origin ? ({ '--fm-launch-x': `${origin.x * 100}%`, '--fm-launch-y': `${origin.y * 100}%` } as CSSProperties) : undefined;
  return (
    <section className="fm-launcher" style={style} aria-label={`${APP_NAME} 앱`}>
      <div className="fm-launcher__head" aria-hidden="true">
        <span className="fm-launcher__mark">
          <FrameletMark />
        </span>
        {APP_NAME}
      </div>
      <div className="fm-launcher__box">
        <div className="fm-selection fm-launcher__deco" aria-hidden="true">
          <div className="fm-selection__frame fm-launcher__frame">
            {FRAME_HANDLES.map((h) => (
              <span key={h} className="fm-selection__handle" data-handle={h} />
            ))}
          </div>
        </div>
        <div className="fm-launcher__grid">
          {LAUNCHER_APPS.map(({ app, label }) => (
            <button
              key={app}
              type="button"
              className="fm-ar__app fm-launcher__app"
              data-app={app}
              data-pressed={pressed === app}
              onClick={() => press(app, () => (app === 'add' ? onAdd() : onOpen(app)))}
            >
              <span className="fm-ar__icon" style={{ background: LAUNCHER_BG[app] }}>
                <LauncherIcon app={app} />
              </span>
              <span className="fm-ar__label">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
