export const HOLD_MS = 1800;
export const PERSON_HOLD_MS = 1100;
export const STALE_MS = 750;
export function clip(b) {
  const x = Math.max(0, b.x), y = Math.max(0, b.y);
  return { x, y, w: Math.max(0, Math.min(1, b.x + b.w) - x), h: Math.max(0, Math.min(1, b.y + b.h) - y) };
}
export function iou(a, b) {
  const area = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return area / (a.w * a.h + b.w * b.h - area || 1);
}
export const headRegion = b => clip({ x: b.x - b.w * .1, y: b.y - b.h * .08, w: b.w * 1.2, h: b.h * .45 });
export function headFallback(b, aspect) {
  const w = Math.min(b.w * .6, b.h * .28 / aspect);
  return clip({ x: b.x + (b.w - w) / 2, y: b.y - b.h * .02, w, h: w * aspect * 1.15 });
}
export function detailTile(people, faces, aspect, index) {
  const regions = [...people.map(b => ({ y: b.y, h: b.h * .28 })), ...faces];
  if (!regions.length) return { x: index % 4 * .7 / 3, y: Math.floor(index / 4) % 3 * .25, w: .3, h: .5 };
  const top = Math.max(0, Math.min(...regions.map(b => b.y)) - .12);
  const bottom = Math.min(1, Math.max(...regions.map(b => b.y + b.h)) + .12);
  const w = .22, h = Math.min(1, w * aspect), rows = Math.max(1, 1 + Math.ceil((bottom - top - h) / (h * .8)));
  const start = Math.min(top, 1 - h), end = Math.max(start, Math.min(1 - h, bottom - h));
  const y = rows === 1 ? Math.max(0, Math.min(1 - h, (top + bottom - h) / 2)) : start + (end - start) * (Math.floor(index / 6) % rows) / (rows - 1);
  return { x: index % 6 * .78 / 5, y, w, h };
}
export function belongs(face, person) {
  const h = headRegion(person), x = face.x + face.w / 2, y = face.y + face.h / 2;
  return x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h;
}
export function chooseMode(state, people, faces, now) {
  const areas = faces.map(f => f.w * f.h);
  const mixedSizes = areas.length > 1 && Math.min(...areas) < Math.max(...areas) * .3;
  const background = people.length > 0 && faces.some(f => !people.some(p => belongs(f, p)));
  const crowded = people.length >= 4 || faces.length >= 4 || background || mixedSizes;
  if (crowded) return { mode: 'crowd', calmSince: null };
  if (state.mode === 'crowd') {
    if (people.length > 2 || faces.length > 2) return { mode: 'crowd', calmSince: null };
    const calmSince = state.calmSince ?? now;
    return now - calmSince >= 4000 ? { mode: 'sparse', calmSince: null } : { mode: 'crowd', calmSince };
  }
  return { mode: 'sparse', calmSince: null };
}
export function mergeTracks(previous, boxes, now, hold = HOLD_MS) {
  const tracks = previous.filter(t => now - t.at < hold).map(t => ({ ...t }));
  const used = new Set();
  for (const raw of boxes) {
    const box = clip(raw);
    if (box.w <= 0 || box.h <= 0 || !Object.values(box).every(Number.isFinite)) continue;
    let best = -1, score = .25;
    tracks.forEach((t, i) => { const s = iou(t.box, box); if (!used.has(i) && s > score) { best = i; score = s; } });
    if (best < 0) { best = tracks.length; tracks.push({ box, at: now }); }
    else tracks[best] = { box, at: now };
    used.add(best);
  }
  return tracks;
}
export function maskBoxes(people, faces, now, mode, aspect = 16 / 9) {
  const activeFaces = faces.filter(t => now - t.at < HOLD_MS);
  const activePeople = people.filter(t => now - t.at < PERSON_HOLD_MS);
  const masks = activeFaces.map(t => ({ ...t, kind: 'face' }));
  for (const p of activePeople) {
    const candidates = activeFaces.filter(f => belongs(f.box, p.box));
    const owned = candidates.length === 1 && activePeople.filter(other => belongs(candidates[0].box, other.box)).length === 1;
    if (!owned) masks.push({ box: headFallback(p.box, aspect), at: p.at, kind: 'fallback' });
  }
  return masks;
}
export function paddedMask(mask, now) {
  const b = mask.box, age = Math.max(0, now - mask.at);
  const margin = .15 + Math.min(.08, age / 1000 * .08);
  const dt = Math.min(160, Math.max(0, now - (mask.sampledAt ?? now)));
  const px = b.w * margin, py = b.h * margin;
  return clip({ x: b.x + (mask.vx || 0) * dt - px, y: b.y + (mask.vy || 0) * dt - py, w: b.w + px * 2, h: b.h + py * 2 });
}
export function visibleMaskGroups(masks, now, viewport) {
  const groups = [];
  const overlaps = (a, b) => Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y);
  const contains = (a, b) => a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;
  for (const mask of masks) {
    if (!Number.isFinite(mask.at) || !['face', 'fallback'].includes(mask.kind)) continue;
    if (now - mask.at >= (mask.kind === 'fallback' ? PERSON_HOLD_MS : HOLD_MS)) continue;
    const b = paddedMask(mask, now), x = Math.max(b.x, viewport.x), y = Math.max(b.y, viewport.y);
    const part = { x, y, w: Math.min(b.x + b.w, viewport.x + viewport.w) - x,
      h: Math.min(b.y + b.h, viewport.y + viewport.h) - y, kind: mask.kind };
    if (part.w <= 0 || part.h <= 0 || ![part.x, part.y, part.w, part.h].every(Number.isFinite)) continue;
    const parts = [part];
    for (let i = groups.length - 1; i >= 0; i--) {
      if (groups[i].parts.some(p => overlaps(part, p))) parts.push(...groups.splice(i, 1)[0].parts);
    }
    groups.push({ parts });
  }
  return groups.map(({ parts }) => {
    const faces = parts.filter(p => p.kind === 'face');
    const kind = parts.some(p => p.kind === 'fallback' && !faces.some(f => contains(f, p))) ? 'fallback' : 'face';
    const x = Math.min(...parts.map(p => p.x)), y = Math.min(...parts.map(p => p.y));
    return { kind, parts, box: { x, y, w: Math.max(...parts.map(p => p.x + p.w)) - x,
      h: Math.max(...parts.map(p => p.y + p.h)) - y } };
  });
}
export function sceneShift(previous, current, width, height) {
  if (!previous || previous.length !== current.length) return { x: 0, y: 0 };
  let best = Infinity, zero = 0, xBest = 0, yBest = 0;
  for (let dy = -5; dy <= 5; dy++) for (let dx = -8; dx <= 8; dx++) {
    let error = 0;
    for (let y = 6; y < height - 6; y += 2) for (let x = 9; x < width - 9; x += 2) {
      error += Math.abs(previous[y * width + x] - current[(y + dy) * width + x + dx]);
    }
    if (!dx && !dy) zero = error;
    if (error < best) { best = error; xBest = dx; yBest = dy; }
  }
  // shortcut: 작은 화면 이동만 보정한다. 회전/줌/큰 이동은 별도 추적기 검증이 필요하다.
  if (best >= zero * .82 || Math.abs(xBest) === 8 || Math.abs(yBest) === 5) return { x: 0, y: 0 };
  return { x: xBest / width, y: yBest / height };
}
export function needsCover({ ready, error, capturedAt, now }) {
  return !ready || !!error || !Number.isFinite(capturedAt) || now - capturedAt > STALE_MS;
}
