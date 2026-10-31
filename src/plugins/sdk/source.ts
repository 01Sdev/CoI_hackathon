// Worker 소스 문자열 만들기: SDK + 플러그인 코드 = blob Worker 하나(IF-01 init.code).

import { PLUGIN_MESSAGE_LIMITS } from '../../core/constants';
import { SDK_INIT_TIMEOUT_MS, type FameletSdk } from '../../core/sdk';
import { installFameletSdk, type SdkOptions } from './runtime';
import { sha256Pure } from './sha256';

/** /dev 시험 페이지만 넣는다. 제품 코드에서는 넣지 않는다. */
export interface SdkTestOptions {
  forcePureHash?: boolean;
  testAckMode?: 'corrupt' | 'suppress';
}

export function sdkOptions(test: SdkTestOptions = {}): SdkOptions {
  return {
    initTimeoutMs: SDK_INIT_TIMEOUT_MS,
    textLimit: PLUGIN_MESSAGE_LIMITS.text,
    targetLimit: PLUGIN_MESSAGE_LIMITS.target,
    forcePureHash: test.forcePureHash === true,
    testAckMode: test.testAckMode ?? 'normal',
  };
}

/**
 * esbuild를 keepNames로 돌리면(tsx 등) 함수 본문에 모듈 수준 도우미 `__name(fn, "이름")` 호출이 들어간다.
 * toString()으로 옮긴 코드에는 그 도우미가 없으므로 아무 일도 하지 않는 같은 이름을 앞에 둔다.
 * Vite 개발·빌드는 keepNames를 쓰지 않는다. scripts/check-plugins.ts가 두 경우를 모두 돌린다.
 */
export const NAME_HELPER_SHIM = 'var __name = function (fn) { return fn; };';

export function buildWorkerSource(pluginSource: string, test: SdkTestOptions = {}): string {
  return [
    '"use strict";',
    NAME_HELPER_SHIM,
    `(${installFameletSdk.toString()})(self, (${sha256Pure.toString()}), ${JSON.stringify(sdkOptions(test))});`,
    pluginSource,
    '',
  ].join('\n');
}

/**
 * 플러그인 함수를 Worker에서 부르는 문장. 첫 인자는 self.famelet, 나머지는 JSON으로 넣는다.
 * 함수는 바깥 이름을 참조하지 않아야 한다(docs/designs/plugin-host.md §2.1).
 */
export function pluginCall(fn: (famelet: FameletSdk, ...data: never[]) => void, ...data: unknown[]): string {
  const args = ['self.famelet', ...data.map((d) => JSON.stringify(d))].join(', ');
  return `(${fn.toString()})(${args});`;
}
