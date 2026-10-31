// UI만 확인하는 개발 페이지. 카메라·마이크·모델·검색 API를 열지 않는다.
import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import { APP_NAME } from '../src/core/constants';
import { OutfitAssistant, type OutfitMessage, type OutfitTarget, type OutfitVoice } from '../src/ui/OutfitAssistant';

document.title = `${APP_NAME} · 코디 UI 미리보기`;
const bounds = { x: .14, y: .08, w: .72, h: .88 };

function example(question: string): Omit<OutfitMessage, 'id' | 'role' | 'selectionKey'> {
  if (/브랜드|상표|로고|brand/i.test(question)) return { label: '브랜드 검색 · 연결 전', title: '브랜드 미확인', text: '브랜드 검색 결과가 아직 연결되지 않았어요.', note: '브랜드를 물으면 검색한다는 기능 연결 위치입니다. 확인되지 않은 브랜드를 채우지 않습니다.' };
  if (/스타일|룩|분위기|무드|style/i.test(question)) return { label: '스타일 답변 · UI 예시', title: '캐주얼 · 미니멀', text: '단색 상의와 데님을 조합한 편안하고 단정한 스타일.', note: '화면 표시용 고정 예시입니다. 선택한 대상을 분석한 결과가 아닙니다.', actions: ['저 사람은 무슨 옷을 입고 있어?', '상의 브랜드 알려줘'] };
  if (/옷|패션|코디|입고|착장|상의|하의|신발/i.test(question)) return { label: '옷 설명 · UI 예시', title: '이렇게 옷차림을 정리해요', items: [['상의', '단색 니트'], ['하의', '블루 데님'], ['신발', '흰색 스니커즈']], note: '화면 표시용 고정 예시입니다. 옷 분석은 연결 예정입니다.', actions: ['저 사람은 어떤 스타일이야?', '신발 브랜드 알려줘'] };
  return { label: '코디 질문', title: '옷에 대해 물어보세요', text: '지정한 사람의 옷 종류, 전체 스타일, 특정 옷의 브랜드로 질문을 나눠볼 수 있어요.', actions: ['무슨 옷을 입고 있어?', '어떤 스타일이야?', '상의 브랜드 알려줘'] };
}

function Demo() {
  const sequence = useRef(0);
  const [target, setTarget] = useState<OutfitTarget | null>(null), [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<OutfitMessage[]>([]), [openRequest, setOpenRequest] = useState(0);
  const [voice, setVoice] = useState<OutfitVoice>({ state: 'idle' });
  return <main className="outfit-demo">
    <div className="outfit-demo__tools"><span>코디 스캔 · UI와 동작 연결 위치 미리보기</span><button onClick={() => setOpenRequest(n => n + 1)}>제스처 대신 호출</button><button onClick={() => { setTarget(null); setVoice({ state: 'idle' }); }}>대상 해제</button><button onClick={() => setVoice({ state: 'listening', message: '듣기 상태 표시 예시 · 실제 녹음은 하지 않습니다.' })} disabled={!target}>듣기 상태 시연</button></div>
    <div className="outfit-demo__scene"><span className="outfit-demo__label">시야 영역 · 배경과 인물은 표시 예시</span><div className="outfit-demo__frame" aria-hidden="true" /><div className="outfit-demo__person" aria-hidden="true"><svg viewBox="0 0 160 400"><circle cx="80" cy="40" r="32" fill="currentColor" /><path d="M30 96Q80 72 130 96L148 240H110L112 392H85L80 256L75 392H48L50 240H12Z" fill="currentColor" /></svg></div>
      <OutfitAssistant demo target={target} draft={draft} messages={messages} voice={voice} selectionBounds={bounds} openRequest={openRequest} onDraftChange={setDraft}
        onTargetPick={point => { setTarget({ selectionKey: `selection-${++sequence.current}`, point }); setVoice({ state: 'idle', message: '대상 지정 후 마이크 활성화 · 실제 음성 입력 연결 예정' }); }}
        onMicToggle={() => setVoice(voice.state === 'listening' ? { state: 'idle' } : { state: 'error', message: '마이크 버튼 연결 위치입니다. 실제 음성 입력은 연결 예정입니다.' })}
        onCancelVoice={() => setVoice({ state: 'idle' })}
        onSubmit={(question, selected) => {
          setMessages(rows => [...rows, { id: `message-${++sequence.current}`, role: 'user', selectionKey: selected.selectionKey, text: question }, { ...example(question), id: `message-${++sequence.current}`, role: 'assistant', selectionKey: selected.selectionKey }]);
        }} />
    </div>
    <p className="outfit-demo__note">제스처 → 대상 지정 → 마이크 활성화 → 질문 → 오른쪽 대화창. 현재는 UI 시연이며 실제 사람 판정·음성 입력·옷 분석·브랜드 검색은 연결 예정입니다.</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Demo /></StrictMode>);
