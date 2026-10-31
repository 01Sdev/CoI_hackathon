// 개발 전용 고정 예시점. 실제 검출 결과로 표시하지 않는다.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import { APP_NAME } from '../src/core/constants';
import type { Box } from '../src/core/types';
import { SelectionFrame } from '../src/ui/SelectionFrame';
import type { SelectionPoint } from '../src/ui/selection-frame';

document.title = `${APP_NAME} · 범위 선택·인원 수 미리보기`;
const samplePeople: readonly SelectionPoint[] = [{ x: .103, y: .234 }, { x: .515, y: .237 }, { x: .817, y: .117 }];
const initial: Box = { x: .14, y: .08, w: .72, h: .88 };
function Demo() {
  const [frame, setFrame] = useState(initial), [people, setPeople] = useState<readonly SelectionPoint[] | null>(samplePeople);
  return <main>
    <div className="selection-demo__tools"><span>범위 선택·인원 수 · 고정 위치 예시</span><button onClick={() => setFrame(initial)}>초기 범위</button><button onClick={() => setPeople(samplePeople)}>예시 3명</button><button onClick={() => setPeople([])}>검출 0명</button><button onClick={() => setPeople(null)}>검출 미확인</button></div>
    <div className="selection-demo__scene">
      {people?.map((p, i) => <span key={i} className="selection-demo__person" aria-hidden="true" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}><svg viewBox="0 0 40 88"><circle cx="20" cy="18" r="12" fill="currentColor" /><path d="M10 34h20l7 30H28l1 24H22l-2-24-2 24H11l1-24H3Z" fill="currentColor" /></svg></span>)}
      <SelectionFrame value={frame} onChange={setFrame} people={people} />
    </div>
    <p className="selection-demo__note">테두리로 이동, 모서리·중간점으로 크기 조절. 숫자는 범위 안의 예시 대표점만 셉니다. 실제 모델·카메라는 실행하지 않습니다.</p>
    <output className="selection-demo__value" aria-label="선택 범위 좌표">{JSON.stringify(frame)}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Demo /></StrictMode>);
