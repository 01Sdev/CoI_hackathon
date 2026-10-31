// 프레임 경계·최소 크기. 실행: npx tsx scripts/check-selection-frame.ts
import assert from 'node:assert/strict';
import { fitSelection, moveSelection, resizeSelection, selectionHandlePoint, selectionLimits, type SelectionHandle } from '../src/ui/selection-frame';

let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`ok  ${name}`); }
const limit = selectionLimits(1000, 600), f = { x: .2, y: .2, w: .5, h: .5 };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
check('이동으로 크기를 유지하고 부모 경계에서 멈춤', () => { const a = moveSelection(f, -10, -10, limit), b = moveSelection(f, 10, 10, limit); near(a.x, limit.left); near(a.y, limit.top); near(b.x + b.w, limit.right); near(b.y + b.h, limit.bottom); near(a.w, f.w); near(b.h, f.h); });
check('네 모서리는 반대 꼭짓점을 고정', () => { for (const h of ['nw', 'ne', 'sw', 'se'] as const) { const at = selectionHandlePoint(f, h), n = resizeSelection(f, h, { x: at.x + .03, y: at.y + .03 }, limit); near(h.includes('w') ? n.x + n.w : n.x, h.includes('w') ? f.x + f.w : f.x); near(h.includes('n') ? n.y + n.h : n.y, h.includes('n') ? f.y + f.h : f.y); } });
check('네 중간점은 해당 축만 변경', () => { for (const h of ['n', 's', 'w', 'e'] as const) { const at = selectionHandlePoint(f, h), n = resizeSelection(f, h, { x: at.x + .03, y: at.y + .03 }, limit); if (h === 'n' || h === 's') { near(n.x, f.x); near(n.w, f.w); assert.notEqual(n.h, f.h); } else { near(n.y, f.y); near(n.h, f.h); assert.notEqual(n.w, f.w); } } });
check('손잡이를 반대쪽 너머로 끌어도 최소 크기', () => { for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as SelectionHandle[]) { const p = { x: h.includes('w') ? 10 : -10, y: h.includes('n') ? 10 : -10 }, n = resizeSelection(f, h, p, limit); assert.ok(n.w >= limit.minWidth - 1e-9); assert.ok(n.h >= limit.minHeight - 1e-9); } });
check('극단적으로 작은 부모 안에도 프레임 유지', () => { const l = selectionLimits(100, 80), n = fitSelection(f, l); near(n.w, l.right - l.left); near(n.h, l.bottom - l.top); assert.ok(n.x >= 0 && n.y >= 0 && n.x + n.w <= 1 && n.y + n.h <= 1); });
check('유효하지 않은 프레임·드래그 값도 유한한 범위로 제한', () => { const n = fitSelection({ x: NaN, y: Infinity, w: NaN, h: -4 }, limit); assert.ok(Object.values(n).every(Number.isFinite)); assert.deepEqual(moveSelection(f, NaN, Infinity, limit), fitSelection(f, limit)); });
console.log(`\n${passed}개 통과`);
