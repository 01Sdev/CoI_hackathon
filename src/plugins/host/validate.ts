// 플러그인 → 호스트 메시지 검증(순수 함수). docs/specs/02-SSRD.md "플러그인 입력 위생", docs/designs/plugin-host.md §2.3.

import { PLUGIN_MESSAGE_LIMITS } from '../../core/constants';
import type { PluginToHost, ViolationAttempt } from '../../core/messages';

export type ParseResult =
  | { ok: true; msg: PluginToHost }
  | { ok: false; kind: 'format' | 'limit'; reason: string };

type Limits = typeof PLUGIN_MESSAGE_LIMITS;

const KEYS: Record<PluginToHost['type'], readonly string[]> = {
  ready: ['type', 'pluginId'],
  ack: ['type', 'deliveryId', 'sha256'],
  result: ['type', 'deliveryId', 'text', 'source'],
  violation: ['type', 'attempt', 'target'],
};
const ATTEMPTS: readonly string[] = ['camera', 'hostDom', 'fetch', 'script'] satisfies ViolationAttempt[];
const SHA256_HEX = /^[0-9a-f]{64}$/i;

/** 길이는 코드 포인트로 센다. SDK도 코드 포인트로 자른다. */
export const codePoints = (s: string) => Array.from(s).length;

const format = (reason: string): ParseResult => ({ ok: false, kind: 'format', reason });
const limit = (reason: string): ParseResult => ({ ok: false, kind: 'limit', reason });
const short = (s: string) => (codePoints(s) > 32 ? `${Array.from(s).slice(0, 32).join('')}…` : s);

/**
 * 형식 검사를 먼저 하고(모양·키·열거값), 그다음 한도(크기·길이)를 본다.
 * 크기 = JSON.stringify(data)의 UTF-8 바이트. 모든 값이 문자열인 것을 확인한 뒤라 stringify가 실패하지 않는다.
 */
export function parsePluginMessage(data: unknown, limits: Limits = PLUGIN_MESSAGE_LIMITS): ParseResult {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return format('객체가 아님');
  if (Object.getPrototypeOf(data) !== Object.prototype) return format('일반 객체가 아님');
  const rec = data as Record<string, unknown>;
  const keys = Object.keys(rec);
  for (const k of keys) if (typeof rec[k] !== 'string') return format(`문자열이 아닌 필드 ${short(k)}`);
  const type = rec.type;
  if (typeof type !== 'string' || !Object.hasOwn(KEYS, type)) return format('모르는 type');
  const allowed = KEYS[type as PluginToHost['type']];
  if (keys.length !== allowed.length || !allowed.every((k) => keys.includes(k))) return format(`${type} 필드 구성이 다름`);
  if (type === 'ack' && !SHA256_HEX.test(rec.sha256 as string)) return format('ack sha256 형식');
  if (type === 'result' && rec.source !== 'api' && rec.source !== 'fallback') return format('result source 값');
  if (type === 'violation' && !ATTEMPTS.includes(rec.attempt as string)) return format('violation attempt 값');

  const size = new TextEncoder().encode(JSON.stringify(rec)).length;
  if (size > limits.maxSerializedBytes) return limit(`크기 ${size}B`);
  for (const k of ['pluginId', 'deliveryId'] as const) {
    if (typeof rec[k] === 'string' && codePoints(rec[k]) > limits.id) return limit(`ID ${limits.id}자`);
  }
  if (type === 'result' && codePoints(rec.text as string) > limits.text) return limit(`text ${limits.text}자`);
  if (type === 'violation' && codePoints(rec.target as string) > limits.target) return limit(`target ${limits.target}자`);
  return { ok: true, msg: rec as unknown as PluginToHost };
}

const ATTEMPT_LABEL: Record<ViolationAttempt, string> = {
  camera: '카메라 접근(camera)',
  hostDom: '호스트 화면 접근(hostDom)',
  fetch: '외부 요청(fetch)',
  script: '외부 스크립트(script)',
};

/**
 * IF-06 자기 보고의 LogEntry.reason. fetch·script는 target origin을 그 iframe의 실제 connect-src 목록
 * (= network ∩ HOST_ALLOWED_ORIGINS, 비교 모드면 빈 목록)과 대조한다. URL이 아니면 "허용 목록 밖".
 */
export function violationReason(attempt: ViolationAttempt, target: string, connectList: readonly string[]): string {
  const base = `${ATTEMPT_LABEL[attempt]} ${target}`;
  if (attempt !== 'fetch' && attempt !== 'script') return base;
  let origin: string | null = null;
  try {
    origin = new URL(target).origin;
  } catch {
    origin = null;
  }
  return `${base} · ${origin !== null && connectList.includes(origin) ? '허용 목록 안인데 실패' : '허용 목록 밖'}`;
}
