// 화면 문구. 플러그인이 보낸 문자열은 여기 없다(그건 React 텍스트 노드 = textContent로만 넣는다).

import type { InputKind, PluginKind, PluginStatus, SceneLabel } from '../core/types';

export const INPUT_LABEL: Record<InputKind, string> = {
  webcam: '웹캠',
  rear: '후면 카메라',
  video: '녹화 영상',
};

export const SCENE_LABEL: Record<SceneLabel, string> = {
  food: '음식 앞',
  person: '사람 앞',
  none: '대상 없음',
};

// hello는 M0 관문용이자 발표용 두 번째 앱 "장면 기록"이다(PRD F21).
export const PLUGIN_NAME: Record<PluginKind, string> = {
  calorie: '칼로리',
  tamper: '변조',
  hello: '장면 기록',
};

/** 앱 카드 머리줄의 글자 하나짜리 단색 아이콘(app-structure §3.1). 앱별 강조색은 쓰지 않는다. */
export const PLUGIN_ICON: Record<PluginKind, string> = {
  calorie: '칼',
  tamper: '변',
  hello: '장',
};

/**
 * 칼로리 결과 한 줄("피자 약 285kcal", 서버·고정표·기기 안 모델 모두 같은 형식)을 이름과 숫자로 나눈다.
 * 형식이 다르면 줄 전체를 이름으로, 열량은 null로 둔다("음식(칼로리 정보 없음)"). 이름은 부르는 쪽에서 sanitizeAppText를 거친다.
 */
export function parseCalorieLine(text: string): { name: string; kcal: number | null } {
  const m = /^\s*(.+?)\s*약\s*(\d[\d,]*)\s*kcal\s*$/i.exec(text.normalize('NFKC'));
  if (!m) return { name: text, kcal: null };
  return { name: m[1] ?? '', kcal: Number((m[2] ?? '').replace(/,/g, '')) };
}

/** 플러그인 상태 글자와 톤. 전환 중 = 적용 중, stopped = 멈춤(사용자가 다시 켜야 함). */
export const PLUGIN_STATUS: Record<PluginStatus, [string, 'safe' | 'hold']> = {
  loading: ['적용 중', 'hold'],
  ready: ['준비됨', 'safe'],
  stopped: ['멈춤', 'hold'],
  terminated: ['꺼짐', 'hold'],
};

export const MANIFEST_SCENE_LABEL: Record<'food' | 'person', string> = {
  food: '음식',
  person: '사람',
};

// COCO 음식 라벨의 한국어 이름. 없는 라벨은 영문 그대로 보인다.
const OBJECT_NAME: Record<string, string> = {
  pizza: '피자',
  banana: '바나나',
  apple: '사과',
  orange: '오렌지',
  sandwich: '샌드위치',
  broccoli: '브로콜리',
  carrot: '당근',
  'hot dog': '핫도그',
  donut: '도넛',
  cake: '케이크',
  bowl: '그릇',
  cup: '컵',
  person: '사람',
};

export function objectName(label: string): string {
  return OBJECT_NAME[label] ?? label;
}

/** 18.6KB, 212KB, 1.2MB. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  const kb = n / 1024;
  if (kb < 100) return `${kb.toFixed(1)}KB`;
  if (kb < 1024) return `${Math.round(kb)}KB`;
  return `${(kb / 1024).toFixed(1)}MB`;
}

/** 받침에 맞춘 조사. josa('웹캠', '을/를') → '웹캠을', josa('후면 카메라', '으로/로') → '후면 카메라로'. */
export function josa(word: string, pair: '을/를' | '으로/로' | '이/가'): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const final = code >= 0 && code <= 11171 ? code % 28 : 0;
  const [withFinal, without] = pair.split('/') as [string, string];
  if (pair === '으로/로' && final === 8) return word + without; // ㄹ 받침은 '로'
  return word + (final !== 0 ? withFinal : without);
}
