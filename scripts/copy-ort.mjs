// postinstall: 칼로리 기기 안 모델이 쓰는 onnxruntime-web 파일을 public/ort/로 복사한다(CDN 금지, copy-wasm.mjs와 같은 방식).
// public/ort/는 레포에 넣지 않는다(.gitignore). 설치할 때마다 고정한 패키지 판과 맞춘다.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules/onnxruntime-web/dist');
const to = join(root, 'public/ort');
// wasm판만(단일 스레드). int8 calorie-lens는 WebGPU 커널이 없다(src/plugins/calorie-model.ts).
const files = ['ort.wasm.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];
if (!existsSync(from)) {
  console.warn(`[copy-ort] ${from} 없음, 건너뜀`);
  process.exit(0);
}
mkdirSync(to, { recursive: true });
for (const f of files) copyFileSync(join(from, f), join(to, f));
console.log(`[copy-ort] ${files.length}개 ${from} → ${to}`);
