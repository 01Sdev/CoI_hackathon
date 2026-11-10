import { needsCover, visibleMaskGroups } from './framelet-policy.mjs';

function coverMap(video) {
  const r = video.getBoundingClientRect(), vw = video.videoWidth || 1, vh = video.videoHeight || 1;
  const s = Math.max(r.width / vw, r.height / vh);
  return { r, vw, vh, s, ox: (r.width - vw * s) / 2, oy: (r.height - vh * s) / 2 };
}
window.frameletVideoToStage = (video, x, y) => {
  const m = coverMap(video);
  return { x: m.r.left + m.ox + x * m.vw * m.s, y: m.r.top + m.oy + y * m.vh * m.s };
};
document.querySelectorAll('.stage').forEach(stage => {
  const video = stage.querySelector('.scene-video'), frame = stage.querySelector('.transmission-frame');
  if (!video || !frame) return;
  const overlay = document.createElement('canvas'), cell = document.createElement('canvas');
  overlay.setAttribute('aria-label', '전달 영역 얼굴 가림');
  Object.assign(overlay.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '1' });
  video.after(overlay);
  const ctx = overlay.getContext('2d'), cellCtx = cell.getContext('2d');
  cell.width = cell.height = 6;
  const status = document.createElement('output');
  status.className = 'framelet-status';
  status.hidden = true;
  stage.after(status);
  let rendered = { faces: 0, fallback: 0, wholeFrame: 1 }, renderKey = '';
  let worker, ready = false, error = '', busy = false, capturedAt = -Infinity, masks = [], epoch = 0;
  let nextDue = 0, ema = 0, mode = 'sparse', runs = 0, totalMs = 0, maxFaceCalls = 0, modeSwitches = 0;
  let previousMediaTime = -1, reset = true, drawCount = 0, drawStart = performance.now(), fps = 0, lastStatus = 0;
  let longTasks = 0, longTaskMs = 0, maxInFlight = 0, generation = 0;
  const times = [];
  const stats = { people: 0, faces: 0, delegate: '', faceCalls: 0, personCalls: 0 };
  window.frameletStats = () => ({ runs, avgMs: runs ? +(totalMs / runs).toFixed(1) : null,
    heads: mode === 'sparse' ? Math.min(2, stats.people) : 0, tracks: stats.people, faces: rendered.faces,
    fallback: rendered.fallback, wholeFrame: rendered.wholeFrame, masks: rendered.faces + rendered.fallback + rendered.wholeFrame,
    detectedFaces: stats.faces, sourceMasks: masks.length, people: window.frameletPeople.length,
    mode, delegate: stats.delegate, maxFaceCalls, maxInFlight });
  let observer;
  if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    observer = new PerformanceObserver(list => { for (const e of list.getEntries()) { longTasks++; longTaskMs += e.duration; } });
    observer.observe({ type: 'longtask' });
  }
  function fail(message) {
    error = message; ready = false; busy = false; worker?.terminate();
    draw(performance.now());
  }
  function invalidate() {
    epoch++; reset = true; capturedAt = -Infinity; masks = [];
    window.frameletPeople = []; stage.dispatchEvent(new Event('framelet:detections'));
    draw(performance.now());
  }
  try {
    // Classic Worker를 써야 MediaPipe WASM의 importScripts 경로도 동작한다.
    worker = new Worker(new URL('./framelet-worker.js', import.meta.url));
    worker.onerror = event => fail(event.message || '추론 작업 시작 실패');
    worker.onmessageerror = () => fail('추론 결과 수신 실패');
    worker.onmessage = ({ data }) => {
      if (data.type === 'error') return fail(data.message);
      if (data.type === 'ready') { ready = true; stats.delegate = data.delegate; return; }
      if (data.type !== 'result') return;
      busy = false;
      if (data.epoch !== epoch) return;
      runs++; totalMs += data.ms;
      if (mode !== data.mode) modeSwitches++;
      mode = data.mode; masks = data.masks; capturedAt = data.capturedAt;
      ema = ema ? ema * .8 + data.ms * .2 : data.ms;
      times.push(data.ms); if (times.length > 120) times.shift();
      maxFaceCalls = Math.max(maxFaceCalls, data.faceCalls);
      Object.assign(stats, { people: data.people.length, faces: data.faces, faceCalls: data.faceCalls, personCalls: data.personCalls });
      window.frameletPeople = data.people.map(b => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 }));
      stage.dispatchEvent(new Event('framelet:detections'));
      // 실행 시간에 비례한 휴식은 GPU 경쟁을 줄이고, 대기열은 만들지 않는다.
      nextDue = Math.max(data.capturedAt + (mode === 'crowd' ? 160 : 200), performance.now() + Math.min(100, ema * .3));
    };
  } catch (e) { fail(String(e.message || e)); }

  async function submit(now) {
    if (!ready || busy || error || document.hidden || video.readyState < 2 || video.paused || now < nextDue) return;
    busy = true; maxInFlight = Math.max(maxInFlight, 1);
    const requestEpoch = epoch, mediaTime = video.currentTime, requestGeneration = generation;
    const k = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
    let bitmap;
    try {
      bitmap = await createImageBitmap(video, { resizeWidth: Math.max(1, Math.round(video.videoWidth * k)), resizeHeight: Math.max(1, Math.round(video.videoHeight * k)) });
      if (requestEpoch !== epoch || error || requestGeneration !== generation) { bitmap.close(); busy = false; return; }
      worker.postMessage({ type: 'frame', bitmap, capturedAt: now, mediaTime, epoch, reset }, [bitmap]);
      reset = false;
    } catch (e) { bitmap?.close(); fail(String(e.message || e)); }
  }
  function draw(now) {
    const m = coverMap(video), dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(m.r.width * dpr), h = Math.round(m.r.height * dpr);
    if (!w || !h) return;
    if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h; }
    const fr = frame.getBoundingClientRect(), x = (fr.left - m.r.left) * dpr, y = (fr.top - m.r.top) * dpr;
    ctx.clearRect(0, 0, w, h); ctx.save(); ctx.beginPath(); ctx.rect(x, y, fr.width * dpr, fr.height * dpr); ctx.clip();
    const covered = needsCover({ ready, error, capturedAt, now });
    const groups = covered ? [] : visibleMaskGroups(masks, now, {
      x: (fr.left - m.r.left - m.ox) / (m.vw * m.s), y: (fr.top - m.r.top - m.oy) / (m.vh * m.s),
      w: fr.width / (m.vw * m.s), h: fr.height / (m.vh * m.s),
    });
    rendered = { faces: 0, fallback: 0, wholeFrame: covered ? 1 : 0 };
    if (covered) {
      ctx.fillStyle = '#252b32'; ctx.fillRect(x, y, fr.width * dpr, fr.height * dpr);
    } else {
      ctx.imageSmoothingEnabled = false;
      for (const group of groups) {
        const b = group.box, sx = b.x * m.vw, sy = b.y * m.vh, sw = b.w * m.vw, sh = b.h * m.vh;
        // 합집합 모양으로 잘라 그려, 묶인 박스 사이의 빈 곳까지 가리지 않는다.
        ctx.save(); ctx.beginPath();
        for (const p of group.parts) ctx.rect((m.ox + p.x * m.vw * m.s) * dpr, (m.oy + p.y * m.vh * m.s) * dpr, p.w * m.vw * m.s * dpr, p.h * m.vh * m.s * dpr);
        ctx.clip();
        cellCtx.drawImage(video, sx, sy, sw, sh, 0, 0, 6, 6);
        ctx.drawImage(cell, (m.ox + sx * m.s) * dpr, (m.oy + sy * m.s) * dpr, sw * m.s * dpr, sh * m.s * dpr);
        ctx.restore();
        rendered[group.kind === 'face' ? 'faces' : 'fallback']++;
      }
    }
    ctx.restore(); frame.style.background = 'rgba(116, 150, 182, 0.08)';
    const key = `${covered}|${mode}|${!!error}`, statusChanged = key !== renderKey;
    renderKey = key;
    if (now - lastStatus > 500 || statusChanged) {
      lastStatus = now;
      const age = Number.isFinite(capturedAt) ? Math.round(now - capturedAt) : null;
      const p95 = times.length ? Math.round([...times].sort((a, b) => a - b)[Math.ceil(times.length * .95) - 1]) : 0;
      const quality = video.getVideoPlaybackQuality?.();
      Object.assign(status.dataset, { mode, runs, ...rendered, people: stats.people, masks: rendered.faces + rendered.fallback + rendered.wholeFrame,
        detectedFaces: stats.faces, sourceMasks: masks.length,
        covered, ageMs: age ?? '', fps, inferenceMs: Math.round(ema), p95Ms: p95, maxFaceCalls, maxInFlight, modeSwitches,
        longTasks, longTaskMs: Math.round(longTaskMs), delegate: stats.delegate, error,
        totalFrames: quality?.totalVideoFrames ?? '', droppedFrames: quality?.droppedVideoFrames ?? '' });
    }
  }
  function onFrame(now) {
    const mediaTime = video.currentTime;
    if (mediaTime < previousMediaTime) invalidate();
    previousMediaTime = mediaTime;
    drawCount++;
    if (now - drawStart >= 1000) { fps = Math.round(drawCount * 1000 / (now - drawStart)); drawCount = 0; drawStart = now; }
    draw(now); submit(now); schedule();
  }
  function schedule() {
    if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(onFrame);
    else requestAnimationFrame(onFrame);
  }
  video.addEventListener('seeking', invalidate);
  video.addEventListener('emptied', invalidate);
  video.addEventListener('error', () => fail('영상 재생 실패'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) invalidate(); });
  const watchdog = setInterval(() => draw(performance.now()), 100);
  new ResizeObserver(() => draw(performance.now())).observe(stage);
  stage.addEventListener('framelet:framechange', () => draw(performance.now()));
  window.addEventListener('pagehide', () => { generation++; worker?.terminate(); clearInterval(watchdog); observer?.disconnect(); });
  window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); });
  draw(performance.now()); schedule();
});
