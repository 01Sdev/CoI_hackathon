import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { APP_NAME } from './core/constants';
import { App } from './App';
import { startPluginHost } from './plugins/host';

document.title = APP_NAME;
// 플러그인 iframe은 React 밖에서 스토어를 구독해 만든다(docs/designs/core-store.md §4). 여러 번 불러도 하나다.
startPluginHost();

const root = document.getElementById('root');
if (!root) throw new Error('#root 없음');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
