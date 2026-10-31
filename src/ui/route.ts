// 경로 → 화면. EI-1 라우트: / (휴대폰·데스크톱), /hud(글래스), /outward(바깥 표시).
// 배포에서는 세 경로 모두 index.html로 되돌려야 직접 URL로 열린다(NFR-024, V6).

export type Route = 'main' | 'hud' | 'outward';

export function routeFromPath(pathname: string): Route {
  const p = pathname.replace(/\/+$/, '');
  if (p === '/hud') return 'hud';
  if (p === '/outward') return 'outward';
  return 'main';
}
