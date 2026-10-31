// 화면 배치와 라우팅(C). / = 휴대폰·데스크톱(폭 768px 자동 + 수동), /hud = 글래스 HUD, /outward = 바깥 표시.
// C는 A·B 모듈을 import하지 않는다. 버튼은 스토어 액션만 부르고, 미리보기는 A의 mountPreview에 컨테이너만 넘긴다.

import { HudScreen } from './ui/HudScreen';
import { MainScreen } from './ui/MainScreen';
import { OutwardScreen } from './ui/OutwardScreen';
import { routeFromPath, type Route } from './ui/route';
import './ui/app.css';

/** route·autostart는 /dev/fake.html이 넘긴다. 실제 페이지는 경로로 고른다. */
export function App({ route = routeFromPath(location.pathname), autostart = false }: { route?: Route; autostart?: boolean }) {
  if (route === 'outward') return <OutwardScreen />;
  if (route === 'hud') return <HudScreen autostart={autostart} />;
  return <MainScreen autostart={autostart} />;
}
