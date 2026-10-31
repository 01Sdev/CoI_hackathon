// 앱이 쓴 문자열을 화면에 넣기 전에 고친다(app-structure §3.1). textContent는 마크업만 막고 뜻은 막지 못한다.
// 앱이 "🟢 보호됨 · 앱에 반영된 사람 0명"을 돌려주면 framelet의 보호 표시처럼 보이므로, 그림 문자·방향 문자를 지우고
// framelet 이름과 보호 카운터 문구를 뺀 뒤 한 줄 60자로 줄인다. 쓰는 곳: 앱 결과, 매니페스트 purpose, 위반 보고 target.
// 막지 못하는 것: 다른 글자로 흉내 낸 이름(키릴 문자 а 등).

import { APP_NAME } from '../core/constants';

export const APP_TEXT_MAX = 60;

/** 앱이 framelet 표시처럼 꾸미지 못하게 지우는 문구. 사이에 공백을 넣어도 걸린다. */
const RESERVED = [APP_NAME, '앱에 반영된 사람', '보호됨'];
const RESERVED_RE = RESERVED.map(
  (w) =>
    new RegExp(
      Array.from(w.replace(/\s+/g, ''))
        .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('\\s*'),
      'giu',
    ),
);

const LINE_BREAK = /\r\n|[\n\r\t\v\f\u0085\u2028\u2029]/g;
// 그림 문자와 그 조합 부품(피부색, 국기 글자, ZWJ, 변형 선택자, 키캡, 태그 문자).
const PICTOGRAPH = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u200D\u20E3\uFE00-\uFE0F\u{E0000}-\u{E007F}]/gu;
// C0·C1 제어 문자, 방향 문자(LRM·RLM·ALM, U+202A~202E, U+2066~2069), 보이지 않는 폭 0 문자.
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const EDGE = /^[\s·|:,\-–—]+|[\s·|:,\-–—]+$/g;

export function sanitizeAppText(text: string, max = APP_TEXT_MAX): string {
  let s = String(text).normalize('NFKC').replace(LINE_BREAK, ' ').replace(PICTOGRAPH, '').replace(CONTROL, '');
  // 지운 자리에서 다시 문구가 생길 수 있어("frameframeletlet") 더 지울 것이 없을 때까지 돈다.
  for (let prev = ''; prev !== s; ) {
    prev = s;
    for (const re of RESERVED_RE) s = s.replace(re, '');
  }
  s = s.replace(/\s+/g, ' ').replace(EDGE, '');
  const chars = Array.from(s);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : s;
}
