// 포착 게이트(03-SRS §4.1 "플러그인별 포착 게이트", FR-010·012). 스토어 상태만 읽는 순수 함수다.

import { selectCanSend } from '../core/selectors';
import type { LensState } from '../core/store';
import type { SceneLabel } from '../core/types';

export interface CaptureTarget {
  pluginId: string;
  kind: LensState['plugins'][string]['kind'];
  /** 포착을 시작할 때의 iframe 세대·매니페스트 버전. prepareDelivery가 지금 값과 다르면 거부한다. */
  runtimeId: string;
  manifestVersion: number;
  maxSide: number;
  quality: number;
  maxPerMinute: number;
  /** 비교 모드의 칼로리: 분기표를 건너뛰고 원본 전체(raw). */
  raw: boolean;
}

export interface CapturePlan {
  capture: CaptureTarget[];
  /** 보낼 수 있지만 확정 장면을 선언하지 않은 플러그인(skip 로그). */
  undeclared: string[];
}

/**
 * 장면 = 확정(L) ∧ L ∈ scenes ∧ selectCanSend ∧ now ≥ cooldownUntil ∧ !busy 이면 포착 대상.
 * 매니페스트가 iframe 정책 버전과 다르면(전환 중) 대상에서 뺀다.
 */
export function planCapture(s: Pick<LensState, 'plugins' | 'pluginOrder' | 'session'>, label: Exclude<SceneLabel, 'none'>, now: number): CapturePlan {
  const plan: CapturePlan = { capture: [], undeclared: [] };
  for (const id of s.pluginOrder) {
    const p = s.plugins[id];
    if (!p || !selectCanSend(s, id)) continue;
    if (!p.manifest.scenes.includes(label)) {
      plan.undeclared.push(id);
      continue;
    }
    if (p.busy || now < p.cooldownUntil) continue;
    if (p.runtimeId === null || !p.runtimePolicy || p.runtimePolicy.manifestVersion !== p.manifest.version) continue;
    plan.capture.push({
      pluginId: id,
      kind: p.kind,
      runtimeId: p.runtimeId,
      manifestVersion: p.runtimePolicy.manifestVersion,
      maxSide: p.manifest.maxSide,
      quality: p.manifest.quality,
      maxPerMinute: p.manifest.maxPerMinute,
      raw: s.session.compareMode && p.kind === 'calorie' && p.runtimePolicy.connect === 'none',
    });
  }
  return plan;
}
