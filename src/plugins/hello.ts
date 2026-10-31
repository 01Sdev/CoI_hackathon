// M0 관문용 개발 플러그인(02-SSRD §5). ack는 SDK가 보내고, 결과 줄에는 Worker 안에서 본 전역을 적는다(TC-051).
// Worker 소스에 toString()으로 들어가므로 바깥 이름을 참조하지 않는다.

import type { FameletSdk } from '../core/sdk';

export function helloPlugin(famelet: FameletSdk): void {
  famelet.onDelivery((d) => {
    const subtle = typeof crypto === 'object' ? typeof crypto.subtle : 'no-crypto';
    famelet.result(
      d.deliveryId,
      `hello ${d.objectLabel} ${d.width}×${d.height} ${d.bytes}B · document:${typeof document} · ` +
        `RTCPeerConnection:${typeof RTCPeerConnection} · subtle:${subtle}`,
      'fallback',
    );
  });
}
