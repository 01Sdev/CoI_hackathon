// /dev/fake.html 진입점. 실제 App을 가짜 런타임과 함께 띄운다(개발 서버 전용).
// 쿼리: route=hud, autostart(시작 버튼 건너뜀), deny(카메라 거부), fail(엔진 실패), load=ms, auto=0(자동 전달 끔).

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// main.tsx와 같은 순서: 토큰(theme.css)을 먼저, 배치(app.css, App이 불러옴)를 나중에.
import '../src/ui/theme.css';
import { App } from '../src/App';
import { APP_NAME } from '../src/core/constants';
import { lensStore } from '../src/core/store';
import { applyTheme, storedTheme } from '../src/ui/theme';
import { startFakeRuntime } from './fake-runtime';
import { FakePanel } from './FakePanel';

const q = new URLSearchParams(location.search);
const route = q.get('route') === 'hud' ? 'hud' : 'main';
const autostart = q.has('autostart');

document.title = `${APP_NAME} · 가짜 런타임`;
applyTheme(storedTheme(), false);

const controls = startFakeRuntime(lensStore, {
  deny: q.has('deny'),
  fail: q.has('fail'),
  loadMs: Number(q.get('load') ?? 2500),
  auto: q.get('auto') !== '0',
});
// 콘솔·자동 확인용(개발 페이지에서만).
(window as unknown as { __lensStore: typeof lensStore }).__lensStore = lensStore;
if (autostart) lensStore.getState().selectInput(route === 'hud' ? 'video' : innerWidth >= 768 ? 'webcam' : 'rear');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App route={route} autostart={autostart} />
  </StrictMode>,
);
createRoot(document.getElementById('fake')!).render(<FakePanel controls={controls} />);
