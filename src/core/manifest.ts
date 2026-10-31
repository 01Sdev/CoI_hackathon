// 매니페스트 형식과 검증. 근거: docs/specs/02-SSRD.md "매니페스트 형식", 03-SRS.md EI-4·FR-043.

import { HOST_ALLOWED_ORIGINS, PLUGIN_MESSAGE_LIMITS, ORIGIN_TOKEN } from './constants';

export type ManifestScene = 'food' | 'person';

export interface Manifest {
  /** 확인 화면(F12)에 보일 사용 목적. 1~40자, textContent로만 표시. */
  purpose: string;
  /** 1개 이상, 중복 없음. */
  scenes: ManifestScene[];
  /** 유일한 값. "대상 박스 + 10%"만 받는다는 선언. */
  region: 'target';
  /** 정수 32–512. */
  maxSide: number;
  /** JPEG 품질 0.5–0.92. */
  quality: number;
  /** 정수 1–30. 포착 간격 = 60 / maxPerMinute 초. */
  maxPerMinute: number;
  /** https origin 또는 "$ORIGIN". 빈 배열이면 connect-src 'none'. */
  network: string[];
}

export type ManifestResult = { ok: true; manifest: Manifest } | { ok: false; errors: string[] };

/** 빠져 있으면 채우는 값(03-SRS EI-4). purpose·scenes·network는 필수. */
export const MANIFEST_DEFAULTS = {
  region: 'target',
  maxSide: 256,
  quality: 0.8,
  maxPerMinute: 6,
} as const;

const FIELDS = ['purpose', 'scenes', 'region', 'maxSide', 'quality', 'maxPerMinute', 'network'] as const;
const NETWORK_ORIGIN = /^https:\/\/[a-z0-9.-]+(:[0-9]+)?$/;

/**
 * 편집기 JSON 문자열을 검증한다. 하나라도 틀리면 전체를 거부하고(조용히 무시하지 않음) 모든 오류를 돌려준다.
 * network 정규식은 CSP connect-src와 meta content 속성에 들어갈 문자열의 주입을 막는다(G3).
 */
export function validateManifest(json: string, pluginId: string): ManifestResult {
  const errors: string[] = [];
  if (pluginId.length === 0 || pluginId.length > PLUGIN_MESSAGE_LIMITS.id) {
    errors.push(`플러그인 ID 길이 오류: ${pluginId.length}자`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { ok: false, errors: [...errors, `JSON 형식 오류: ${(e as Error).message}`] };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, errors: [...errors, '매니페스트는 JSON 객체여야 합니다'] };
  }
  const raw = parsed as Record<string, unknown>;

  for (const key of Object.keys(raw)) {
    if (!(FIELDS as readonly string[]).includes(key)) errors.push(`모르는 필드: ${key}`);
  }

  const purpose = raw.purpose;
  if (typeof purpose !== 'string') {
    errors.push('purpose: 문자열이 필요합니다');
  } else {
    const len = [...purpose].length;
    if (len < 1 || len > 40) errors.push(`purpose: 1~40자여야 합니다(현재 ${len}자)`);
  }

  const scenes = raw.scenes;
  if (!Array.isArray(scenes) || scenes.length === 0) {
    errors.push('scenes: 1개 이상의 배열이 필요합니다');
  } else {
    for (const s of scenes) {
      if (s !== 'food' && s !== 'person') errors.push(`scenes: 허용하지 않는 값 ${JSON.stringify(s)}`);
    }
    if (new Set(scenes).size !== scenes.length) errors.push('scenes: 중복 값이 있습니다');
  }

  const region = raw.region ?? MANIFEST_DEFAULTS.region;
  if (region !== 'target') errors.push(`region: "target"만 허용합니다(현재 ${JSON.stringify(region)})`);

  const maxSide = raw.maxSide ?? MANIFEST_DEFAULTS.maxSide;
  if (!isIntIn(maxSide, 32, 512)) errors.push(`maxSide: 32–512 정수여야 합니다(현재 ${JSON.stringify(maxSide)})`);

  const quality = raw.quality ?? MANIFEST_DEFAULTS.quality;
  if (typeof quality !== 'number' || !Number.isFinite(quality) || quality < 0.5 || quality > 0.92) {
    errors.push(`quality: 0.5–0.92 숫자여야 합니다(현재 ${JSON.stringify(quality)})`);
  }

  const maxPerMinute = raw.maxPerMinute ?? MANIFEST_DEFAULTS.maxPerMinute;
  if (!isIntIn(maxPerMinute, 1, 30)) {
    errors.push(`maxPerMinute: 1–30 정수여야 합니다(현재 ${JSON.stringify(maxPerMinute)})`);
  }

  const network = raw.network;
  if (!Array.isArray(network)) {
    errors.push('network: 배열이 필요합니다(없으면 [])');
  } else {
    for (const n of network) {
      if (typeof n !== 'string' || (n !== ORIGIN_TOKEN && !NETWORK_ORIGIN.test(n))) {
        errors.push(`network: https origin 또는 "${ORIGIN_TOKEN}"만 허용합니다(현재 ${JSON.stringify(n)})`);
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    manifest: {
      purpose: purpose as string,
      scenes: [...(scenes as ManifestScene[])],
      region: 'target',
      maxSide: maxSide as number,
      quality: quality as number,
      maxPerMinute: maxPerMinute as number,
      network: [...(network as string[])],
    },
  };
}

/** 실제 connect-src에 넣을 origin 목록: network ∩ HOST_ALLOWED_ORIGINS, $ORIGIN은 hostOrigin으로 치환. */
export function resolveAllowedOrigins(
  network: readonly string[],
  hostOrigin: string,
  hostAllowed: readonly string[] = HOST_ALLOWED_ORIGINS,
): string[] {
  const sub = (o: string) => (o === ORIGIN_TOKEN ? hostOrigin : o);
  const allowed = new Set(hostAllowed.map(sub));
  return [...new Set(network.map(sub))].filter((o) => allowed.has(o));
}

function isIntIn(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}
