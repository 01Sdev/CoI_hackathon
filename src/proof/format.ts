// 증명 로그 한 줄의 문구(F6, FR-027). 숫자는 모두 Delivery·LogEntry 값 그대로다. 해시는 상세에만 둔다.
// reason은 A·B 호스트가 쓴 문자열이고, 플러그인 문자열이 아니다.

import type { Delivery, LogEntry, PluginKind } from '../core/types';
import { formatBytes, PLUGIN_NAME } from '../ui/labels';
import type { Tone } from '../ui/OrbStack';

/** 방금 · 14초 전 · 3분 전 · 1시간 전. */
export function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 5) return '방금';
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  return `${Math.floor(s / 3600)}시간 전`;
}

export function percent(ratio: number): string {
  const p = ratio * 100;
  return `${p >= 10 ? Math.round(p) : p.toFixed(1)}%`;
}

export function entryTone(e: LogEntry, d: Delivery | null): Tone {
  if (e.kind === 'violation') return 'blocked';
  if (e.kind === 'deliver') return d?.branch === 'raw' ? 'exposed' : 'safe';
  return 'hold';
}

export function entryTitle(e: LogEntry, d: Delivery | null, kind: PluginKind | undefined): string {
  const who = kind && kind !== 'calorie' ? `${PLUGIN_NAME[kind]} · ` : '';
  switch (e.kind) {
    case 'deliver': {
      if (!d) return `${who}전달`;
      if (d.branch === 'raw') return `${who}전달 · 원본 전체`;
      if (d.branch === '2b') return `${who}전달 · 얼굴 ${d.facesMasked}개 가림`;
      if (d.branch === '2c') return `${who}전달 · 머리 넓게 가림`;
      return `${who}전달 · 그대로`;
    }
    case 'hold':
      return `${who}보류`;
    case 'skip':
      return `${who}전달 안 함`;
    case 'violation':
      return `${who}차단`;
  }
}

/** 바이트 · 원본의 n% · 이 기기에서 · 수신 미확인 / 사유. */
export function entryMeta(e: LogEntry, d: Delivery | null): string {
  if (e.kind !== 'deliver') {
    const by = e.enforcedBy === 'plugin-report' ? ' · 플러그인 자기 보고' : e.enforcedBy === 'host' ? ' · 호스트 감지' : '';
    const zero = e.kind === 'hold' || e.kind === 'skip' ? ' · 전달 0' : '';
    return `${e.reason || '사유 없음'}${by}${zero}`;
  }
  if (!d) return '전달 기록이 밀려났습니다';
  const parts = [formatBytes(d.bytes), `원본의 ${percent(d.areaRatio)}`];
  if (d.branch === 'raw') parts.push('비교 모드 · 서버로 안 감');
  else parts.push('이 기기에서');
  if (d.sendStatus === 'failed') parts.push('전송 실패');
  else if (d.sendStatus === 'prepared') parts.push('보내는 중');
  else if (d.ackStatus === 'timeout') parts.push('수신 미확인');
  else if (d.ackStatus === 'mismatch') parts.push('해시 불일치');
  return parts.join(' · ');
}

/** 로그 카드의 분기 태그. */
export function entryCode(e: LogEntry): string | null {
  if (e.branch) return e.branch;
  if (e.kind === 'skip') return 'skip';
  if (e.kind === 'violation') return e.enforcedBy === 'host' ? 'host' : 'report';
  return null;
}
