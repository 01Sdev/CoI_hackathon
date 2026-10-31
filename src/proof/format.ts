// 증명 로그 한 줄의 문구(F6, FR-027). 숫자는 모두 Delivery·LogEntry 값 그대로다. 해시는 상세에만 둔다.
// reason은 A·B 호스트가 쓴 문자열이지만, 위반 줄에는 앱이 보낸 문자열이 섞인다(B violationReason이 앱의 target을
// 그대로 붙인다). 그래서 위반 줄의 사유는 logReason으로 걸러서 보인다.

import type { Box, Delivery, LogEntry, PluginKind, UsageRecord } from '../core/types';
import { formatBytes, objectName, PLUGIN_NAME } from '../ui/labels';
import type { Tone } from '../ui/OrbStack';
import { sanitizeAppText } from '../ui/sanitize';

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

/** multi: 로그에 앱이 둘 이상이면 칼로리 줄에도 앱 이름을 붙인다(두 앱을 나란히 읽게, F21). */
export function entryTitle(e: LogEntry, d: Delivery | null, kind: PluginKind | undefined, multi = false): string {
  const who = kind && (multi || kind !== 'calorie') ? `${PLUGIN_NAME[kind]} · ` : '';
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

// B violationReason의 모양: "{시도}({영문}) {target}"에 fetch·script면 " · 허용 목록 밖|안인데 실패".
const REPORT_REASON = /^(\S.*?\([A-Za-z]+\)) ([\s\S]*?)( · 허용 목록 (?:밖|안인데 실패))?$/;

/**
 * 기록 사유를 화면 문구로. 위반 줄은 앱 문자열이 섞이므로 거른다. 자기 보고는 앱이 보낸 target 부분만 거르고
 * framelet이 붙인 앞뒤는 그대로 둔다. 모양이 다르거나 호스트 감지 줄이면 사유 전체를 거른다.
 */
export function logReason(e: Pick<LogEntry, 'kind' | 'reason' | 'enforcedBy'>): string {
  if (e.kind !== 'violation') return e.reason;
  const m = e.enforcedBy === 'plugin-report' ? REPORT_REASON.exec(e.reason) : null;
  if (!m) return sanitizeAppText(e.reason);
  return `${m[1] ?? ''} ${sanitizeAppText(m[2] ?? '') || '(빈 값)'}${m[3] ?? ''}`;
}

/** "프레임 W×H"(F24, FR-063). frameRect가 없는 줄(F24 전 전달, skip·violation)은 빈 문자열. */
export function frameText(frameRect: Box | null | undefined): string {
  return frameRect ? `프레임 ${Math.round(frameRect.w)}×${Math.round(frameRect.h)}` : '';
}

/** 바이트 · 원본의 n% · 이 기기에서 · 프레임 W×H · 수신 미확인 / 사유 · 프레임 W×H. */
export function entryMeta(e: LogEntry, d: Delivery | null): string {
  const frame = frameText(e.frameRect ?? d?.frameRect);
  if (e.kind !== 'deliver') {
    const by = e.enforcedBy === 'plugin-report' ? ' · 플러그인 자기 보고' : e.enforcedBy === 'host' ? ' · 호스트 감지' : '';
    const zero = e.kind === 'hold' || e.kind === 'skip' ? ' · 전달 0' : '';
    return `${logReason(e) || '사유 없음'}${by}${zero}${frame ? ` · ${frame}` : ''}`;
  }
  if (!d) return '전달 기록이 밀려났습니다';
  const parts = [formatBytes(d.bytes), `원본의 ${percent(d.areaRatio)}`];
  if (d.branch === 'raw') parts.push('비교 모드 · 서버로 안 감');
  else parts.push('이 기기에서');
  if (frame) parts.push(frame);
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

/** performance.now() 기준 시각 at → 벽시계 'HH:MM:SS'. perfNow·dateNow는 같은 순간에 잰 값. */
export function wallClock(at: number, perfNow: number, dateNow: number): string {
  const d = new Date(dateNow - (perfNow - at));
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

/** F25 사용 기록 한 줄의 뒷부분: 시각 · 대상 · 바이트 · 프레임 W×H. 프레임이 null(F24 전 전달)이면 생략. */
export function usageMeta(r: UsageRecord, clock: string): string {
  const parts = [clock, objectName(r.objectLabel), formatBytes(r.bytes)];
  if (r.frameW !== null && r.frameH !== null) parts.push(`프레임 ${r.frameW}×${r.frameH}`);
  return parts.join(' · ');
}
