// 플러그인 kind → Worker에서 돌 플러그인 코드. 다른 트랙은 이 파일을 import하지 않는다(core/plugins.ts).
// 등록되지 않은 kind는 null이고, 호스트는 그 플러그인을 켜지 않는다(stopped).

import type { PluginKind } from '../core/types';
import { helloPlugin } from './hello';
import { pluginCall } from './sdk/source';

export function pluginSourceFor(kind: PluginKind): string | null {
  switch (kind) {
    case 'hello':
      return pluginCall(helloPlugin);
    default:
      return null;
  }
}
