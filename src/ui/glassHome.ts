// 글래스 AR 홈 흐름(docs/designs/glass-home.md). 휴대폰 웹은 스마트 글래스 시야를 휴대폰 브라우저로 흉내 내는 화면이라,
// "/" 첫 진입은 카메라 허용 → AR 홈(비전 프로 배치 4/5/4) → framelet 런처(버튼 넷) → 고른 앱 순서로 간다.
// 화면 전환과 홈 배치는 경계가 있는 순수 함수라 scripts/check-ui.ts가 확인한다.

import type { InputKind, PluginKind } from '../core/types';
import type { LayoutMode } from './useLayoutMode';

/** 런처에서 실행할 수 있는 앱. "추가..."는 알림만 띄우고 화면을 바꾸지 않는다. */
export type LauncherApp = 'calorie' | 'outfit' | 'tamper';

export type GlassScreen =
  | { name: 'permission' }
  /** 카메라를 거부했거나 열지 못함. 녹화 영상으로 가지 않고 안내와 "다시 시도"(새로고침)만 둔다. */
  | { name: 'no-camera' }
  | { name: 'home' }
  | { name: 'launcher' }
  | { name: 'app'; app: LauncherApp };

export type GlassEvent =
  | { type: 'allow' }
  /** "허용 안 함", 브라우저 권한 창 거부, 카메라 오류(A가 녹화 영상으로 바꿈 = session.input.fallbackFrom). */
  | { type: 'camera-off' }
  | { type: 'open-framelet' }
  | { type: 'open-app'; app: LauncherApp }
  /** 화면 아래 가운데 홈 알약(비전 프로 디지털 크라운 역할): 앱 → 런처, 런처 → 홈. */
  | { type: 'home-pill' };

/** 정해진 전환만 받고, 나머지 이벤트는 지금 화면을 그대로 돌려준다. */
export function glassReduce(s: GlassScreen, e: GlassEvent): GlassScreen {
  switch (e.type) {
    case 'allow':
      return s.name === 'permission' ? { name: 'home' } : s;
    case 'camera-off':
      return { name: 'no-camera' };
    case 'open-framelet':
      return s.name === 'home' ? { name: 'launcher' } : s;
    case 'open-app':
      return s.name === 'launcher' ? { name: 'app', app: e.app } : s;
    case 'home-pill':
      if (s.name === 'app') return { name: 'launcher' };
      if (s.name === 'launcher') return { name: 'home' };
      return s;
  }
}

/** 지금 화면에서 켜 둘 플러그인 종류. 앱 화면에서만 그 앱 하나, 나머지 화면에서는 모두 끈다(고를 때 실행). */
export function enabledKind(s: GlassScreen): PluginKind | null {
  return s.name === 'app' ? s.app : null;
}

/** 카메라 허용 때 고를 입력. 터치 기기(아이폰 가로 포함)는 후면(environment), 아니면 웹캠. */
export function cameraFor(layout: LayoutMode, coarsePointer: boolean): InputKind {
  return coarsePointer || layout === 'phone' ? 'rear' : 'webcam';
}

export type HomeAppId =
  | 'framelet'
  | 'youtube'
  | 'safari'
  | 'music'
  | 'photos'
  | 'maps'
  | 'mail'
  | 'messages'
  | 'tv'
  | 'settings'
  | 'notes'
  | 'calendar'
  | 'weather';

export interface HomeApp {
  id: HomeAppId;
  label: string;
}

/** 비전 프로 홈 배치: 첫 줄 4개, 둘째 줄 5개, 셋째 줄 4개. */
export const HOME_ROWS = [4, 5, 4] as const;

/** 정가운데 칸(둘째 줄 3번째)의 순번. */
export const HOME_CENTER = HOME_ROWS[0] + Math.floor(HOME_ROWS[1] / 2);

/** 기성 앱 12개. framelet은 homeApps가 정가운데에 끼운다. 공식 로고 파일은 쓰지 않고 단순 SVG로 그린다(HomeIcon). */
const STOCK_APPS: readonly HomeApp[] = [
  { id: 'tv', label: 'TV' },
  { id: 'music', label: '음악' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'settings', label: '설정' },
  { id: 'safari', label: 'Safari' },
  { id: 'photos', label: '사진' },
  { id: 'notes', label: '메모' },
  { id: 'maps', label: '지도' },
  { id: 'mail', label: '메일' },
  { id: 'messages', label: '메시지' },
  { id: 'calendar', label: '캘린더' },
  { id: 'weather', label: '날씨' },
];

/** 홈 13칸(4/5/4). 정가운데가 framelet이고 나머지는 기성 앱 순서대로다. */
export function homeApps(appName: string): HomeApp[] {
  const apps = [...STOCK_APPS];
  apps.splice(HOME_CENTER, 0, { id: 'framelet', label: appName });
  return apps;
}

/** 칸 목록을 HOME_ROWS대로 줄로 나눈다. 남는 칸은 버린다. */
export function homeRows<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  let at = 0;
  for (const n of HOME_ROWS) {
    rows.push(items.slice(at, at + n));
    at += n;
  }
  return rows;
}
