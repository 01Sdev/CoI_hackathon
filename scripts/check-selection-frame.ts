// 경계·최소 크기·좌표 카운트. 테스트 프레임워크 없이 실행한다: npx tsx scripts/check-selection-frame.ts
import assert from 'node:assert/strict';
import { countSelectionPeople, fitSelection, moveSelection, resizeSelection, selectionHandlePoint, selectionLimits, type SelectionHandle } from '../src/ui/selection-frame';

let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`ok  ${name}`); }
const limit = selectionLimits(1000, 600), f = { x: .2, y: .2, w: .5, h: .5 };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
check('미확인 null과 확인된 빈 결과 []를 구별', () => { assert.equal(countSelectionPeople(f, null), null); assert.equal(countSelectionPeople(f, []), 0); });
check('프레임 경계 포함, 밖의 점 제외', () => { assert.equal(countSelectionPeople(f, [{ x: .2, y: .2 }, { x: .7, y: .7 }, { x: .199, y: .3 }, { x: .5, y: .701 }]), 2); });
check('잘못된 좌표를 사람으로 세지 않음', () => { assert.equal(countSelectionPeople({ x: 0, y: 0, w: 1, h: 1 }, [{ x: NaN, y: .5 }, { x: Infinity, y: .5 }, { x: -1, y: .5 }, { x: .5, y: 2 }, { x: .5, y: .5 }]), 1); assert.equal(countSelectionPeople({ ...f, w: NaN }, []), null); });
check('시안의 대표점에서 범위 안의 사람만 셈', () => { const points = [{ x: .103, y: .234 }, { x: .515, y: .237 }, { x: .817, y: .117 }]; assert.equal(countSelectionPeople({ x: .14, y: .08, w: .72, h: .88 }, points), 2); assert.equal(countSelectionPeople({ x: .15, y: .3, w: .3, h: .5 }, points), 0); assert.equal(countSelectionPeople({ x: 0, y: 0, w: 1, h: 1 }, points), 3); });
check('이동으로 크기를 유지하고 부모 경계에서 멈춤', () => { const a = moveSelection(f, -10, -10, limit), b = moveSelection(f, 10, 10, limit); near(a.x, limit.left); near(a.y, limit.top); near(b.x + b.w, limit.right); near(b.y + b.h, limit.bottom); near(a.w, f.w); near(b.h, f.h); });
check('네 모서리는 반대 꼭짓점을 고정', () => { for (const h of ['nw', 'ne', 'sw', 'se'] as const) { const at = selectionHandlePoint(f, h), n = resizeSelection(f, h, { x: at.x + .03, y: at.y + .03 }, limit); near(h.includes('w') ? n.x + n.w : n.x, h.includes('w') ? f.x + f.w : f.x); near(h.includes('n') ? n.y + n.h : n.y, h.includes('n') ? f.y + f.h : f.y); } });
check('네 중간점은 해당 축만 변경', () => { for (const h of ['n', 's', 'w', 'e'] as const) { const at = selectionHandlePoint(f, h), n = resizeSelection(f, h, { x: at.x + .03, y: at.y + .03 }, limit); if (h === 'n' || h === 's') { near(n.x, f.x); near(n.w, f.w); assert.notEqual(n.h, f.h); } else { near(n.y, f.y); near(n.h, f.h); assert.notEqual(n.w, f.w); } } });
check('손잡이를 반대쪽 너머로 끌어도 최소 크기', () => { for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as SelectionHandle[]) { const p = { x: h.includes('w') ? 10 : -10, y: h.includes('n') ? 10 : -10 }, n = resizeSelection(f, h, p, limit); assert.ok(n.w >= limit.minWidth - 1e-9); assert.ok(n.h >= limit.minHeight - 1e-9); } });
check('극단적으로 작은 부모 안에도 프레임 유지', () => { const l = selectionLimits(100, 80), n = fitSelection(f, l); near(n.w, l.right - l.left); near(n.h, l.bottom - l.top); assert.ok(n.x >= 0 && n.y >= 0 && n.x + n.w <= 1 && n.y + n.h <= 1); });
check('유효하지 않은 프레임·드래그 값도 유한한 범위로 제한', () => { const n = fitSelection({ x: NaN, y: Infinity, w: NaN, h: -4 }, limit); assert.ok(Object.values(n).every(Number.isFinite)); assert.deepEqual(moveSelection(f, NaN, Infinity, limit), fitSelection(f, limit)); });
console.log(`\n${passed}개 통과`);
