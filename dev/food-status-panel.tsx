import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { APP_NAME } from '../src/core/constants';
import { FoodStatusPanel, type FoodStatusResult } from '../src/ui/FoodStatusPanel';

document.title = `${APP_NAME} · 상태창 미리보기`;

function Demo() {
  const nextId = useRef(1);
  const [result, setResult] = useState<FoodStatusResult | null>({ id: 1, name: '피자', kcal: null });
  return (
    <>
      <div className="food-status-demo__header">
        <span>연결선·상태창·글꼴 미리보기 · 음식 이름은 표시 예시입니다.</span>
        <button onClick={() => setResult({ id: ++nextId.current, name: '피자', kcal: null })}>다시 표시</button>
        <button onClick={() => setResult(null)}>숨기기</button>
      </div>
      <div className="food-status-demo__canvas">
        <FoodStatusPanel result={result} anchor={{ x: .2, y: .78 }} />
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Demo /></StrictMode>);
