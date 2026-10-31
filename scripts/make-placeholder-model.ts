// 칼로리 기기 안 모델의 자리표시(개발 페이지 전용). 실제 calorie-lens ONNX는 허브가 public/models/calorie-lens/에 넣는다.
// 그래프: kcal = 300 + 100 · mean(pixel_values). 입력 [1,3,224,224], 출력 [1,1,1,1]. 내려받지 않고 protobuf를 직접 쓴다.
// 실행: npx tsx scripts/make-placeholder-model.ts → dev/fixtures/calorie-lens-placeholder/

import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'dev/fixtures/calorie-lens-placeholder/';

const varint = (n: number): number[] => {
  const out: number[] = [];
  let v = n;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
};
const key = (field: number, wire: number) => varint(field * 8 + wire);
const vint = (field: number, n: number) => [...key(field, 0), ...varint(n)];
const bytes = (field: number, b: number[]) => [...key(field, 2), ...varint(b.length), ...b];
const str = (field: number, s: string) => bytes(field, [...Buffer.from(s, 'utf8')]);
const f32 = (x: number) => [...new Uint8Array(new Float32Array([x]).buffer)];

// onnx.proto3 필드 번호.
const dim = (n: number) => bytes(1, vint(1, n));
const valueInfo = (name: string, dims: number[]) =>
  [...str(1, name), ...bytes(2, bytes(1, [...vint(1, 1), ...bytes(2, dims.flatMap(dim))]))];
const scalar = (name: string, x: number) => [...vint(2, 1), ...str(8, name), ...bytes(9, f32(x))];
const node = (op: string, inputs: string[], outputs: string[], attrs: number[][] = []) => [
  ...inputs.flatMap((i) => str(1, i)),
  ...outputs.flatMap((o) => str(2, o)),
  ...str(3, `${op}_0`),
  ...str(4, op),
  ...attrs.flatMap((a) => bytes(5, a)),
];
const intsAttr = (name: string, xs: number[]) => [...str(1, name), ...xs.flatMap((x) => vint(8, x)), ...vint(20, 7)];
const intAttr = (name: string, x: number) => [...str(1, name), ...vint(3, x), ...vint(20, 2)];

const graph = [
  ...bytes(1, node('ReduceMean', ['pixel_values'], ['m'], [intsAttr('axes', [1, 2, 3]), intAttr('keepdims', 1)])),
  ...bytes(1, node('Mul', ['m', 'scale'], ['s'])),
  ...bytes(1, node('Add', ['s', 'bias'], ['kcal'])),
  ...str(2, 'calorie_placeholder'),
  ...bytes(5, scalar('scale', 100)),
  ...bytes(5, scalar('bias', 300)),
  ...bytes(11, valueInfo('pixel_values', [1, 3, 224, 224])),
  ...bytes(12, valueInfo('kcal', [1, 1, 1, 1])),
];
const model = Buffer.from([
  ...vint(1, 8), // ir_version
  ...str(2, 'framelet-placeholder'),
  ...bytes(7, graph),
  ...bytes(8, vint(2, 13)), // opset_import { version: 13 }
]);

mkdirSync(OUT, { recursive: true });
// 조각 두 개: 이어 붙이기 경로를 실제 모델과 같게 시험한다.
const half = Math.ceil(model.length / 2);
writeFileSync(`${OUT}model.onnx.0`, model.subarray(0, half));
writeFileSync(`${OUT}model.onnx.1`, model.subarray(half));
const spec = {
  files: ['model.onnx.0', 'model.onnx.1'],
  input: {
    name: 'pixel_values',
    width: 224,
    height: 224,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
    resize: 'center-crop',
    cropFraction: 0.875,
  },
  output: { name: 'kcal', index: 0 },
};
writeFileSync(`${OUT}model.json`, `${JSON.stringify(spec, null, 2)}\n`);
console.log(`${OUT}: ${model.length}B (${half} + ${model.length - half})`);
