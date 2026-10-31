// postinstall: MediaPipe WASM을 public/wasm/으로 복사한다(CDN 금지, AGENTS.md·NFR-010).
// public/wasm/은 레포에 넣지 않는다(.gitignore). 설치할 때마다 node_modules 판과 맞춘다.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const to = join(root, 'public/wasm');
if (!existsSync(from)) {
  console.warn(`[copy-wasm] ${from} 없음, 건너뜀`);
  process.exit(0);
}
mkdirSync(to, { recursive: true });
// FilesetResolver.forVisionTasks(base)는 SIMD 판과 nosimd 판만 쓴다. module 판(useModule)은 쓰지 않아 빼고 14MB를 줄인다.
const files = readdirSync(from).filter((f) => f.startsWith('vision_wasm_internal.') || f.startsWith('vision_wasm_nosimd_internal.'));
for (const f of files) copyFileSync(join(from, f), join(to, f));
console.log(`[copy-wasm] ${files.length}개 ${from} → ${to}`);
