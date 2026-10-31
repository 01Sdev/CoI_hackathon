// 테마 전환. 기본은 dark(시안: 어두운 실내·야간·기본값), light는 사용자가 고른다. /hud는 항상 dark.

export type ThemeMode = 'dark' | 'light';

const KEY = 'famelet.theme';

/** 저장된 선택. 없거나 읽을 수 없으면 dark. */
export function storedTheme(): ThemeMode {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** <html data-theme>을 바꾼다. persist=false면 저장하지 않는다(/hud 강제 dark). */
export function applyTheme(mode: ThemeMode, persist = true, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = mode;
  if (!persist) return;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // 사파리 개인 정보 보호 모드 등에서 저장이 막혀도 화면 전환은 된다.
  }
}
