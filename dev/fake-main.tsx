// /dev/fake.html 진입점. 실제 App을 가짜 런타임과 함께 띄운다(개발 서버 전용).
// 쿼리: route=hud, autostart(시작 버튼 건너뜀), deny(카메라 거부), fail(엔진 실패), load=ms, auto=0(자동 전달 끔).

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../src/App';
import { APP_NAME } from '../src/core/constants';
import { lensStore } from '../src/core/store';
import { applyTheme, storedTheme } from '../src/ui/theme';
import '../src/ui/theme.css';
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
if (autostart) lensStore.getState().selectInput(route === 'hud' ? 'video' : innerWidth >= 768 ? 'webcam' : 'rear');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App route={route} autostart={autostart} />
  </StrictMode>,
);
createRoot(document.getElementById('fake')!).render(<FakePanel controls={controls} />);
