// 가짜 런타임 조작판(개발 전용). 화면 상태를 손으로 만들 때 쓴다.

import { useState } from 'react';
import type { AckMode, FakeControls } from './fake-runtime';

const ROUTES = [
  ['메인', '/dev/fake.html?autostart'],
  ['메인(시작 화면부터)', '/dev/fake.html'],
  ['/hud', '/dev/fake.html?route=hud&autostart'],
  ['카메라 거부', '/dev/fake.html?autostart&deny'],
  ['엔진 실패', '/dev/fake.html?autostart&fail'],
  ['느린 로딩', '/dev/fake.html?autostart&load=15000'],
  ['/outward(새 창)', '/outward'],
] as const;

export function FakePanel({ controls }: { controls: FakeControls }) {
  const [open, setOpen] = useState(false);
  const [auto, setAuto] = useState(controls.isAuto());
  const ack = (m: AckMode) => () => controls.setNextAck(m);
  if (!open) {
    return (
      <button type="button" className="fake-chip" onClick={() => setOpen(true)}>
        가짜 런타임 ▸
      </button>
    );
  }
  return (
    <div className="fake-panel">
      <div className="fake-row">
        <b>가짜 런타임</b>
        <button type="button" onClick={() => setOpen(false)}>
          닫기
        </button>
      </div>
      <div className="fake-row">
        <button type="button" onClick={() => controls.deliverNow('2a')}>2a 전달</button>
        <button type="button" onClick={() => controls.deliverNow('2b')}>2b</button>
        <button type="button" onClick={() => controls.deliverNow('2c')}>2c</button>
        <button type="button" onClick={() => controls.deliverNow('2d')}>2d 보류</button>
        <button type="button" onClick={() => controls.deliverNow('raw')}>raw</button>
      </div>
      <div className="fake-row">
        <button type="button" onClick={() => controls.personScene(6000)}>사람 장면 6초</button>
        <button type="button" onClick={ack('timeout')}>다음 ack 없음</button>
        <button type="button" onClick={ack('mismatch')}>다음 해시 불일치</button>
      </div>
      <div className="fake-row">
        <button type="button" onClick={() => controls.failNextTransition()}>다음 전환 실패</button>
        <button type="button" onClick={() => controls.fill(100)}>100건 채우기</button>
        <button type="button" onClick={() => controls.failEngine()}>엔진 실패</button>
        <label>
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => {
              controls.setAuto(e.target.checked);
              setAuto(e.target.checked);
            }}
          />
          자동 전달
        </label>
      </div>
      <div className="fake-row">
        {ROUTES.map(([name, href]) => (
          <a key={href} href={href} target={href === '/outward' ? 'framelet-outward' : undefined}>
            {name}
          </a>
        ))}
      </div>
    </div>
  );
}
