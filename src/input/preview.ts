// C가 import.meta.glob('/src/input/preview.ts')로 찾는 약속 위치(track-c/screens의 src/ui/Preview.tsx).
// 미리보기를 처음 붙일 때 트랙 A 런타임도 시작한다. 그래서 main.tsx를 고치지 않아도 화면이 뜨면 판정이 돈다.
// startRuntime은 여러 번 불러도 하나만 돈다.

import { startRuntime } from '../vision';
import { mountPreview as mountVideo } from './adapter';

export function mountPreview(container: HTMLElement): () => void {
  startRuntime();
  return mountVideo(container);
}
