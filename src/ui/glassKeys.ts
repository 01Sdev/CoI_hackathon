// 글래스 물리 버튼 대용 키. 브라우저 런타임에서는 글래스 버튼을 받을 수 없어 Enter·Space로 대신한다(outfit-pipelines.md).

/** 초점이 이 요소들 안에 있으면 그쪽 기본 동작(글자 입력, 버튼 누르기)이 먼저다. */
const OWN_KEYS = 'input, textarea, select, button, a[href], [contenteditable=""], [contenteditable="true"], [role="button"]';

interface KeyLike {
  key: string;
  defaultPrevented: boolean;
  repeat: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
  target: EventTarget | null;
}

/** 이 키를 글래스 버튼으로 받을지. 한글 조합 중·꾹 누름·단축키·다른 컴포넌트가 이미 받은 키는 받지 않는다. */
export function isGlassButtonKey(e: KeyLike, keys: readonly string[]): boolean {
  if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return false;
  if (!keys.includes(e.key)) return false;
  const t = e.target as { closest?: (sel: string) => unknown } | null;
  return !(t && typeof t.closest === 'function' && t.closest(OWN_KEYS));
}
