// 도구 배치(?tools)의 위쪽 줄: 왼쪽 브랜드(HUD 밖, 테마·화면 메뉴), 오른쪽 입력 캡슐(F10 드롭다운).
// 전송 범위는 #44 흰 틀을 바로 끌어 조절한다(F24a, 조절 모드 버튼 없음).

import { useState } from 'react';
import { APP_NAME } from '../core/constants';
import { useLensStore } from '../core/store';
import type { InputKind } from '../core/types';
import { INPUT_LABEL } from './labels';
import { MenuButton, MenuItem } from './Menu';
import { applyTheme, storedTheme, type ThemeMode } from './theme';
import type { useLayoutMode } from './useLayoutMode';

const INPUTS: InputKind[] = ['rear', 'webcam', 'video'];

export function TopBar({ layout }: { layout: ReturnType<typeof useLayoutMode> }) {
  return (
    <div className="fm-topbar">
      <BrandMenu layout={layout} />
      <div className="fm-topbar__end">
        <InputCapsule />
      </div>
    </div>
  );
}

function BrandMenu({ layout }: { layout: ReturnType<typeof useLayoutMode> }) {
  const [theme, setTheme] = useState<ThemeMode>(storedTheme);
  const pickTheme = (m: ThemeMode) => {
    applyTheme(m);
    setTheme(m);
  };
  return (
    <MenuButton
      className="fm-capsule fm-glass fm-glass--panel fm-brand"
      label={
        <>
          <span className="fm-brand__dot" aria-hidden="true" />
          {APP_NAME}
        </>
      }
    >
      {() => (
        <>
          <span className="fm-kicker fm-menu__head">테마</span>
          <MenuItem checked={theme === 'dark'} onSelect={() => pickTheme('dark')}>
            다크
          </MenuItem>
          <MenuItem checked={theme === 'light'} onSelect={() => pickTheme('light')}>
            라이트
          </MenuItem>
          <span className="fm-kicker fm-menu__head">화면</span>
          <MenuItem checked={layout.choice === 'auto'} onSelect={() => layout.setChoice('auto')}>
            자동(폭 768px 기준)
          </MenuItem>
          <MenuItem checked={layout.choice === 'phone'} onSelect={() => layout.setChoice('phone')}>
            휴대폰
          </MenuItem>
          <MenuItem checked={layout.choice === 'desktop'} onSelect={() => layout.setChoice('desktop')}>
            데스크톱
          </MenuItem>
        </>
      )}
    </MenuButton>
  );
}

export function InputCapsule() {
  const input = useLensStore((s) => s.session.input);
  const requested = useLensStore((s) => s.session.inputRequest?.kind ?? null);
  const selectInput = useLensStore((s) => s.selectInput);

  const kind = input?.kind ?? requested;
  const text = kind ? INPUT_LABEL[kind] + (input ? '' : ' 연결 중') : '입력 없음';
  // 자동 전환(F1)이나 연결 전에는 보류 톤 점을 붙인다. 평소에는 글자만.
  const tone = !input || input.fallbackFrom ? 'hold' : undefined;

  return (
    <MenuButton
      align="end"
      className="fm-capsule fm-glass fm-glass--panel"
      label={
        <span className="fm-capsule__in" data-tone={tone}>
          {tone && <span className="fm-dot" aria-hidden="true" />}
          {text}
        </span>
      }
    >
      {(close) => (
        <>
          <span className="fm-kicker fm-menu__head">입력</span>
          {INPUTS.map((k) => (
            <MenuItem
              key={k}
              checked={input?.kind === k}
              onSelect={() => {
                selectInput(k);
                close();
              }}
            >
              {INPUT_LABEL[k]}
            </MenuItem>
          ))}
        </>
      )}
    </MenuButton>
  );
}
