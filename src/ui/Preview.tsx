// 카메라 미리보기 자리. A의 mountPreview(container)에 컨테이너만 넘긴다(02-SSRD §1). <video>·MediaStream은 C가 만지지 않는다.
// A 파일이 아직 없어도 컴파일되도록 glob으로 찾는다. 약속한 위치: src/input/preview.ts의 mountPreview.
// 반환값이 함수면 화면이 사라질 때 해제 함수로 부른다. mountPreview는 A 런타임(카메라·모델)도 시작한다.

import { createContext, useContext, useEffect, useRef } from 'react';

type PreviewModule = { mountPreview?: (container: HTMLElement) => void | (() => void) };

const previewModules = import.meta.glob<PreviewModule>('/src/input/preview.ts');

/**
 * false면 A의 mountPreview를 부르지 않는다(A 런타임이 켜지지 않는다). 기본 true라 제품 화면은 그대로다.
 * 가짜 런타임 페이지(/dev/fake.html)가 A·B 없이 C 화면만 보려고 false로 감싼다.
 */
export const PreviewMountContext = createContext(true);

/** hidden: /hud는 영상을 보이지 않는다(검은색 = 투명). 재생은 계속되도록 opacity만 0. */
export function Preview({ hidden = false }: { hidden?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const mount = useContext(PreviewMountContext);

  useEffect(() => {
    if (!mount) return;
    const el = ref.current;
    const load = previewModules['/src/input/preview.ts'];
    if (!el || !load) return;
    let alive = true;
    let cleanup: void | (() => void);
    void load().then((m) => {
      if (alive && m.mountPreview) cleanup = m.mountPreview(el);
    });
    return () => {
      alive = false;
      if (typeof cleanup === 'function') cleanup();
    };
  }, [mount]);

  return <div ref={ref} className={hidden ? 'fm-preview fm-preview--hidden' : 'fm-preview'} data-preview-slot="" />;
}
