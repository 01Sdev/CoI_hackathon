// 개발 전용 외부 인원수 전달 예시. 검출·카운팅은 실행하지 않는다.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import { APP_NAME } from '../src/core/constants';
import type { Box } from '../src/core/types';
import { SelectionFrame } from '../src/ui/SelectionFrame';

document.title = `${APP_NAME} · 범위 선택·인원 수 미리보기`;
const initial: Box = { x: .14, y: .08, w: .72, h: .88 };
function Demo() {
  const [frame, setFrame] = useState(initial), [peopleCount, setPeopleCount] = useState<number | null>(3);
  return <main>
    <div className="selection-demo__tools"><span>범위 선택·인원 수 표시</span><button onClick={() => setFrame(initial)}>초기 범위</button><button onClick={() => setPeopleCount(3)}>외부값 3명</button><button onClick={() => setPeopleCount(0)}>외부값 0명</button><button onClick={() => setPeopleCount(null)}>외부값 미확인</button></div>
    <div className="selection-demo__scene">
      <SelectionFrame value={frame} onChange={setFrame} peopleCount={peopleCount} />
    </div>
    <p className="selection-demo__note">테두리로 이동, 모서리·중간점으로 크기 조절. 숫자는 외부에서 전달받은 값만 표시합니다. 검출·카운팅은 실행하지 않습니다.</p>
    <output className="selection-demo__value" aria-label="선택 범위 좌표">{JSON.stringify(frame)}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Demo /></StrictMode>);
