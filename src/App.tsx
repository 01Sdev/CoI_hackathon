import { APP_NAME } from './core/constants';

// 화면 배치(phone/desktop/hud/outward)와 라우팅은 C 트랙이 채운다. 지금은 스캐폴드 확인용 자리표시.
export function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 16 }}>
      <h1>{APP_NAME}</h1>
      <p>스캐폴드. 트랙 A·B·C 구현 전입니다.</p>
    </main>
  );
}
