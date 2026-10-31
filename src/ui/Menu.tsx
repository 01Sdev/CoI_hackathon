// 캡슐을 누르면 열리는 작은 메뉴. 바깥을 누르거나 Esc를 누르면 닫힌다.

import { useEffect, useRef, useState, type ReactNode } from 'react';

export function MenuButton({
  label,
  className,
  align = 'start',
  children,
}: {
  label: ReactNode;
  className: string;
  align?: 'start' | 'end';
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="fm-anchor" ref={ref}>
      <button type="button" className={className} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open && (
        <div className="fm-menu fm-glass fm-glass--panel" data-align={align} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ checked, onSelect, children }: { checked: boolean; onSelect(): void; children: ReactNode }) {
  return (
    <button type="button" className="fm-menu__item" role="menuitemradio" aria-checked={checked} onClick={onSelect}>
      <span className="fm-menu__mark" aria-hidden="true" />
      {children}
    </button>
  );
}
