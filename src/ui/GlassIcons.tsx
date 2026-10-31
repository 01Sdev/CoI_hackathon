// AR 홈과 framelet 런처의 원형 아이콘 그림. 기성 앱은 공식 로고 파일 대신 단순한 모양으로 직접 그린다(허브 기본값).
// framelet은 5×5 격자 마크(docs/designs/app-screens/Splash.dc.html 색), 런처의 칼로리·코디 스캔·변조 시험은
// docs/designs/app-screens/Apps.dc.html의 SVG를 그대로 옮겼다. 모두 장식이라 aria-hidden이고 이름은 아래 글자가 읽힌다.

import type { HomeAppId, LauncherApp } from './glassHome';

/** 원형 아이콘 바탕색. */
export const HOME_ICON_BG: Record<HomeAppId, string> = {
  framelet: '#f4f4f2',
  youtube: '#ffffff',
  safari: '#ffffff',
  music: '#fa2d48',
  photos: '#ffffff',
  maps: '#e9f3e1',
  mail: '#1e8cff',
  messages: '#34c759',
  tv: '#111111',
  settings: '#8e8e93',
  notes: '#ffd43b',
  calendar: '#ffffff',
  weather: '#3a8dde',
};

export function HomeIcon({ id }: { id: HomeAppId }) {
  if (id === 'framelet') return <FrameletMark />;
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="fm-ar__glyph">
      {STOCK[id]}
    </svg>
  );
}

const STOCK: Record<Exclude<HomeAppId, 'framelet'>, JSX.Element> = {
  youtube: (
    <>
      <rect x="9" y="14" width="30" height="20" rx="6" fill="#ff0033" />
      <path d="M21 19.5v9l8-4.5z" fill="#fff" />
    </>
  ),
  safari: (
    <>
      <circle cx="24" cy="24" r="15" fill="#1e8cff" />
      <circle cx="24" cy="24" r="12.5" fill="none" stroke="#fff" strokeWidth="1" strokeDasharray="1 2.2" />
      <path d="M30 18l-4 8-8 4 4-8z" fill="#fff" />
      <path d="M30 18l-4 8-4-4z" fill="#ff3b30" />
    </>
  ),
  music: <path d="M30 12v16.5a4 4 0 1 1-2.5-3.7V17l-9 2.2v11.3a4 4 0 1 1-2.5-3.7V15.5z" fill="#fff" />,
  photos: (
    <g transform="translate(24 24)">
      {['#ff9500', '#ffcc00', '#34c759', '#30b0c7', '#007aff', '#af52de', '#ff2d55', '#ff3b30'].map((c, i) => (
        <ellipse key={c} cx="0" cy="-7.5" rx="4.6" ry="7.5" fill={c} opacity=".85" transform={`rotate(${i * 45})`} />
      ))}
    </g>
  ),
  maps: (
    <>
      <path d="M8 30l14-14 6 6 12-12v12L22 40H8z" fill="#7ac36a" />
      <path d="M12 40L40 12" stroke="#f7c948" strokeWidth="4" />
      <path d="M30 20l6 2-2-6z" fill="#1e8cff" />
    </>
  ),
  mail: (
    <>
      <rect x="11" y="15" width="26" height="18" rx="3" fill="#fff" />
      <path d="M12 17l12 9 12-9" fill="none" stroke="#1e8cff" strokeWidth="2" strokeLinejoin="round" />
    </>
  ),
  messages: <path d="M24 13c-8 0-14 5-14 11 0 3.4 2 6.4 5.2 8.4L14 37l6-3c1.3.3 2.6.5 4 .5 8 0 14-5 14-11s-6-11-14-11z" fill="#fff" />,
  tv: (
    <>
      <text x="24" y="29" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff" fontFamily="system-ui, sans-serif">
        tv
      </text>
    </>
  ),
  settings: (
    <g transform="translate(24 24)" fill="none" stroke="#e5e5ea">
      <circle r="9" strokeWidth="3.5" strokeDasharray="3.4 2.5" />
      <circle r="5" strokeWidth="2.5" />
    </g>
  ),
  notes: (
    <>
      <rect x="10" y="10" width="28" height="7" fill="#f5b700" />
      <path d="M14 24h20M14 29h20M14 34h14" stroke="#c9a227" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  calendar: (
    <>
      <text x="24" y="20" textAnchor="middle" fontSize="7" fontWeight="700" fill="#ff3b30" fontFamily="system-ui, sans-serif">
        일요일
      </text>
      <text x="24" y="35" textAnchor="middle" fontSize="16" fontWeight="500" fill="#111" fontFamily="system-ui, sans-serif">
        1
      </text>
    </>
  ),
  weather: (
    <>
      <circle cx="20" cy="20" r="6" fill="#ffd60a" />
      <path d="M17 33h15a5 5 0 0 0 0-10 7 7 0 0 0-13.5 2A4 4 0 0 0 17 33z" fill="#fff" />
    </>
  ),
};

/** framelet 5×5 격자 마크. 가운데 아래 세 칸(청록)이 "필요한 조각"이다. */
const MARK = [
  '#263339', '#d2d2d2', '#6b7e8c', '#d2d2d2', '#354752',
  '#6e818f', '#949c9f', '#d1d1d1', '#19ae9f', '#d2d2d2',
  '#2f3f46', '#d0d0d0', '#919a9e', '#19ae9f', '#19ae9f',
  '#d1d2d2', '#6e8290', '#99a0a2', '#d2d2d2', '#50616d',
  '#263339', '#6d808e', '#d0d2d2', '#677988', '#d3d3d3',
];

export function FrameletMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="fm-ar__glyph">
      {MARK.map((c, i) => (
        <rect key={i} x={11.5 + (i % 5) * 5.2} y={11.5 + Math.floor(i / 5) * 5.2} width="4.6" height="4.6" rx=".6" fill={c} />
      ))}
    </svg>
  );
}

/** 런처 아이콘 바탕색(Apps.dc.html). */
export const LAUNCHER_BG: Record<LauncherApp | 'add', string> = {
  calorie: '#F1652E',
  outfit: '#D9F04F',
  tamper: '#1E4FF5',
  add: 'rgb(255 255 255 / 0.18)',
};

export function LauncherIcon({ app }: { app: LauncherApp | 'add' }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="fm-ar__glyph">
      {LAUNCHER[app]}
    </svg>
  );
}

const LAUNCHER: Record<LauncherApp | 'add', JSX.Element> = {
  calorie: (
    <>
      <circle cx="24" cy="24" r="17" fill="#FCF4E6" />
      <g stroke="#FCF4E6" strokeWidth="1.4" strokeLinejoin="round">
        <path d="M24 24L11.47 15.22A15.3 15.3 0 0 1 24.0 8.7Z" fill="#F9AA42" />
        <path d="M24 24L24.0 8.7A15.3 15.3 0 0 1 36.53 15.22Z" fill="#D23A28" />
        <path d="M24 24L36.53 15.22A15.3 15.3 0 0 1 36.53 32.78Z" fill="#F9AA42" />
        <path d="M24 24L36.53 32.78A15.3 15.3 0 0 1 21.34 39.07Z" fill="#F79A3C" />
        <path d="M24 24L21.34 39.07A15.3 15.3 0 0 1 9.62 29.23Z" fill="#F59237" />
        <path d="M24 24L9.62 29.23A15.3 15.3 0 0 1 11.47 15.22Z" fill="#F68A34" />
      </g>
      <circle cx="24" cy="24" r="2.5" fill="#FCF4E6" />
      <g fill="none" stroke="#8B2A1C" strokeWidth="1.25" strokeLinecap="round">
        <path d="M16.64 15.83L15.23 14.26" />
        <path d="M19.55 15.27L18.05 12.33" />
        <path d="M21.71 13.24L21.28 11.19" />
        <path d="M34.34 20.24L36.31 19.52" />
        <path d="M33.8 24.0L37.1 24.0" />
        <path d="M34.34 27.76L36.31 28.48" />
      </g>
    </>
  ),
  outfit: (
    <>
      <path d="M32.44 9.47L32.44 16.07L15.5 22.67L15.5 16.73Z" fill="#151515" stroke="#151515" strokeWidth="0.8" strokeLinejoin="round" />
      <path d="M32.22 24.87L32.22 31.47L15.5 38.73L15.5 32.35Z" fill="#151515" stroke="#151515" strokeWidth="0.8" strokeLinejoin="round" />
      <path d="M15.5 16.73L32.22 24.87L32.22 31.47L15.5 22.67Z" fill="#151515" stroke="#151515" strokeWidth="0.8" strokeLinejoin="round" />
      <path d="M15.8 16.88L22.28 20.03M25.44 27.9L31.9 31.3" stroke="#F4F3EC" strokeWidth="0.6" strokeLinecap="round" />
      <path d="M22.6 18.37L30.2 15.73" stroke="#F4F3EC" strokeWidth="0.75" strokeDasharray="1.6 1" />
      <path d="M30.67 10.23L31.9 9.7Q32.44 9.47 32.44 10.05L32.44 16.07L30.67 16.76Z" fill="#F4F3EC" stroke="#151515" strokeWidth="0.6" strokeLinejoin="round" />
    </>
  ),
  tamper: (
    <>
      <path d="M24.5 10.5H34.3L36.5 12.7V37.5H24.5V29.6H26.3V27.8H28.1V33.9H32.9V14.1H28.1V20.2H26.3V18.4H24.5Z" fill="#FFFFFF" />
      <g fill="#FF7A45">
        <rect x="11.2" y="22.75" width="2.5" height="2.5" />
        <rect x="15.3" y="22.75" width="2.5" height="2.5" />
        <path d="M22.4 19.5h3v1.5h1.5v1.5h1.5v3h-1.5v1.5h-1.5v1.5h-3v-1.5h-1.5v-1.5h-1.5v-3h1.5v-1.5h1.5z" />
      </g>
    </>
  ),
  add: <path d="M24 15v18M15 24h18" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />,
};
