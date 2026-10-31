// 플러그인 kind → Worker에서 돌 플러그인 코드. 다른 트랙은 이 파일을 import하지 않는다(core/plugins.ts).
// 등록되지 않은 kind는 null이고, 호스트는 그 플러그인을 켜지 않는다(stopped). 데이터(고정표·시간·주소)는 JSON 인자로 넣는다.

import { CALORIE_TABLE, X_LABEL_MAX, X_LABEL_RE, fallbackText } from '../core/calorie';
import { CALORIE_CLIENT_TIMEOUT_MS } from '../core/constants';
import type { PluginKind } from '../core/types';
import { caloriePlugin } from './calorie';
import { calorieOnDevice, type OnDeviceConfig } from './calorie-model';
import { PORTION_TABLE, clampApiKcal, portionKcal } from './portion';
import { helloPlugin } from './hello';
import { OUTFIT_CLIENT_TIMEOUT_MS, OUTFIT_FALLBACK_TEXT, OUTFIT_KEEP_DELIVERIES, outfitPlugin } from './outfit';
import { pluginCall } from './sdk/source';
import { TAMPER_TARGETS, tamperPlugin } from './tamper';

/** 칼로리 Worker 소스. /dev 페이지는 자리표시 모델 경로를 넣거나 null로 기기 안 모델을 끈다. */
export function calorieSource(onDevice: OnDeviceConfig | null = calorieOnDevice()): string {
  // 표 밖 문구는 core가 정한다(유효하지 않은 라벨의 fallbackText).
  return pluginCall(
    caloriePlugin,
    CALORIE_TABLE,
    X_LABEL_RE.source,
    X_LABEL_MAX,
    CALORIE_CLIENT_TIMEOUT_MS,
    fallbackText(''),
    onDevice,
    PORTION_TABLE,
    portionKcal,
    clampApiKcal,
  );
}

export function pluginSourceFor(kind: PluginKind): string | null {
  switch (kind) {
    case 'calorie':
      return calorieSource();
    case 'tamper':
      return pluginCall(tamperPlugin, TAMPER_TARGETS);
    case 'hello':
      return pluginCall(helloPlugin);
    case 'outfit':
      return pluginCall(outfitPlugin, OUTFIT_CLIENT_TIMEOUT_MS, OUTFIT_KEEP_DELIVERIES, OUTFIT_FALLBACK_TEXT);
    default:
      return null;
  }
}
