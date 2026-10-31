// 트랙 A 시작점. main.tsx(또는 /dev 페이지)가 React 밖에서 한 번 부른다. 여러 번 불러도 구독·반복은 하나다.

import { startInput } from '../input/adapter';
import { startCapture } from './capture';
import { loadModels } from './models';
import { startStage0 } from './stage0';

export { mountPreview } from '../input/adapter';
export { getModelState, loadModels, subscribeModelState, type ModelState } from './models';
export { connectPluginHost, type SendDelivery, type DeliveryMessage } from '../broker/broker';

let stop: (() => void) | null = null;

/** 입력을 열고(모델 다운로드와 동시에, NFR-001) 0단계와 포착 게이트를 시작한다. 돌려준 함수로 모두 멈춘다. */
export function startRuntime(): () => void {
  if (stop) return stop;
  const stopInput = startInput();
  void loadModels();
  const stopStage0 = startStage0();
  const stopCapture = startCapture();
  stop = () => {
    stopCapture();
    stopStage0();
    stopInput();
    stop = null;
  };
  return stop;
}
