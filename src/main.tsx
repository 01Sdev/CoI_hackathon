// 시작 배선(02-SSRD "트랙 연결 기준"). 허브가 잇는다.
// ① 호스트 외부 요청 가드(첫 import라 다른 모듈보다 먼저 걸린다) ② B 플러그인 호스트 시작
// ③ A 중개기 → B 전달 연결 ④ 화면. A 런타임은 C가 미리보기를 붙일 때 mountPreview가 시작한다(src/input/preview.ts).
import './boot/install-guard';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { connectPluginHost } from './broker/broker';
import { APP_NAME } from './core/constants';
import { sendDelivery, startPluginHost } from './plugins/host';
import { applyTheme, storedTheme } from './ui/theme';
import './ui/theme.css';
import { App } from './App';

document.title = APP_NAME;
applyTheme(storedTheme(), false);

// 둘 다 여러 번 불러도 한 번만 붙는다. sendDelivery가 안에서 markDelivery를 쓰므로 중개기의 요구를 지킨다.
startPluginHost();
connectPluginHost((_id, msg) => {
  sendDelivery(msg.deliveryId);
});

const root = document.getElementById('root');
if (!root) throw new Error('#root 없음');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
