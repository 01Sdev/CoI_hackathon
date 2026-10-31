// 플러그인 kind → Worker에서 돌 플러그인 코드. 다른 트랙은 이 파일을 import하지 않는다(core/plugins.ts).
// 등록되지 않은 kind는 null이고, 호스트는 그 플러그인을 켜지 않는다(stopped). 데이터(고정표·시간·주소)는 JSON 인자로 넣는다.

import { CALORIE_CLIENT_TIMEOUT_MS } from '../core/constants';
import type { PluginKind } from '../core/types';
import { CALORIE_FALLBACK_TABLE, UNKNOWN_FOOD_TEXT, caloriePlugin } from './calorie';
import { helloPlugin } from './hello';
import { pluginCall } from './sdk/source';
import { TAMPER_TARGETS, tamperPlugin } from './tamper';

export function pluginSourceFor(kind: PluginKind): string | null {
  switch (kind) {
    case 'calorie':
      return pluginCall(caloriePlugin, CALORIE_FALLBACK_TABLE, CALORIE_CLIENT_TIMEOUT_MS, UNKNOWN_FOOD_TEXT);
    case 'tamper':
      return pluginCall(tamperPlugin, TAMPER_TARGETS);
    case 'hello':
      return pluginCall(helloPlugin);
    default:
      return null;
  }
}
