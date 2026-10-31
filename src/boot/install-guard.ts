// main.tsx의 첫 import. 다른 모듈(특히 MediaPipe)이 평가되기 전에 호스트 외부 요청 가드를 건다.

import { installHostRequestGuard } from './guard';

installHostRequestGuard(window);
