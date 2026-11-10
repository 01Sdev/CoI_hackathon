let personDetector, faceDetector, policy, delegate, modeState = { mode: 'sparse', calmSince: null };
let people = [], faces = [], lastPerson = -Infinity, lastAudit = -Infinity, tileIndex = 0, roiIndex = 0, lastMediaTime = -1;
let previousGray, previousCapture, detailIndex = 0, wideTileIndex = 0;
const input = new OffscreenCanvas(1, 1), crop = new OffscreenCanvas(1, 1);
const inputContext = input.getContext('2d'), cropContext = crop.getContext('2d');
const motionCanvas = new OffscreenCanvas(96, 54), motionContext = motionCanvas.getContext('2d', { willReadFrequently: true });
const full = { x: 0, y: 0, w: 1, h: 1 };
const base = 'https://storage.googleapis.com/mediapipe-models/';
const originalFetch = self.fetch.bind(self);
self.fetch = (request, init) => {
  const url = new URL(typeof request === 'string' ? request : request.url ?? request.href, location.href);
  return url.hostname === 'odml.pa.googleapis.com' ? Promise.reject(new TypeError('blocked telemetry')) : originalFetch(request, init);
};
async function init() {
  policy = await import('./framelet-policy.mjs');
  const { FilesetResolver, ObjectDetector, FaceDetector } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/vision_bundle.mjs');
  const fileset = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/wasm');
  for (delegate of ['GPU', 'CPU']) {
    try {
      personDetector = await ObjectDetector.createFromOptions(fileset, {
        baseOptions: { delegate, modelAssetPath: base + 'object_detector/efficientdet_lite0/float32/1/efficientdet_lite0.tflite' },
        runningMode: 'IMAGE', scoreThreshold: .35, categoryAllowlist: ['person'], maxResults: 20,
      });
      faceDetector = await FaceDetector.createFromOptions(fileset, {
        baseOptions: { delegate, modelAssetPath: base + 'face_detector/blaze_face_full_range/float16/1/blaze_face_full_range.tflite' },
        runningMode: 'IMAGE', minDetectionConfidence: .35,
      });
      postMessage({ type: 'ready', delegate });
      return;
    } catch (error) {
      personDetector?.close(); faceDetector?.close(); personDetector = faceDetector = null;
      if (delegate === 'CPU') throw error;
    }
  }
}
function detectFaces(bitmap, region) {
  const sw = region.w * bitmap.width, sh = region.h * bitmap.height;
  if (sw < 8 || sh < 8) return [];
  const k = Math.min(1, 512 / Math.max(sw, sh));
  crop.width = Math.max(1, Math.round(sw * k)); crop.height = Math.max(1, Math.round(sh * k));
  cropContext.drawImage(bitmap, region.x * bitmap.width, region.y * bitmap.height, sw, sh, 0, 0, crop.width, crop.height);
  const threshold = region.w <= .3 ? .35 : .45;
  return faceDetector.detect(crop).detections.filter(d => d.boundingBox && (d.categories?.[0]?.score ?? 0) >= threshold).map(d => {
    const b = d.boundingBox;
    return policy.clip({ x: region.x + b.originX / crop.width * region.w, y: region.y + b.originY / crop.height * region.h,
      w: b.width / crop.width * region.w, h: b.height / crop.height * region.h });
  });
}
function detect(message) {
  const { bitmap, capturedAt: now, mediaTime, epoch } = message;
  const start = performance.now();
  try {
    if (mediaTime < lastMediaTime || message.reset) {
      people = []; faces = []; lastPerson = lastAudit = -Infinity;
      previousGray = undefined; previousCapture = undefined; tileIndex = detailIndex = wideTileIndex = 0;
      modeState = { mode: 'sparse', calmSince: null };
    }
    lastMediaTime = mediaTime;
    motionContext.drawImage(bitmap, 0, 0, 96, 54);
    const pixels = motionContext.getImageData(0, 0, 96, 54).data, gray = new Uint8Array(96 * 54);
    for (let i = 0; i < gray.length; i++) gray[i] = (pixels[i * 4] + pixels[i * 4 + 1] * 2 + pixels[i * 4 + 2]) / 4;
    const shift = policy.sceneShift(previousGray, gray, 96, 54);
    const dt = Math.max(1, now - (previousCapture ?? now));
    previousGray = gray; previousCapture = now;
    for (const track of [...people, ...faces]) track.box = policy.clip({ ...track.box, x: track.box.x + shift.x, y: track.box.y + shift.y });
    let personCalls = 0, faceCalls = 0;
    if (now - lastPerson >= (modeState.mode === 'crowd' ? 800 : 180)) {
      const k = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
      input.width = Math.round(bitmap.width * k); input.height = Math.round(bitmap.height * k);
      inputContext.drawImage(bitmap, 0, 0, input.width, input.height);
      const boxes = personDetector.detect(input).detections.filter(d => d.boundingBox).map(d => {
        const b = d.boundingBox; return { x: b.originX / input.width, y: b.originY / input.height, w: b.width / input.width, h: b.height / input.height };
      });
      people = policy.mergeTracks(people, boxes, now, policy.PERSON_HOLD_MS); lastPerson = now; personCalls++;
    }
    people = people.filter(t => now - t.at < policy.PERSON_HOLD_MS && t.box.w > 0 && t.box.h > 0);
    faces = faces.filter(t => now - t.at < policy.HOLD_MS && t.box.w > 0 && t.box.h > 0);
    modeState = policy.chooseMode(modeState, people.map(t => t.box), faces.map(t => t.box), now);
    const audit = now - lastAudit >= (modeState.mode === 'crowd' ? 400 : 900);
    if (audit) {
      faces = policy.mergeTracks(faces, detectFaces(bitmap, full), now); faceCalls++; lastAudit = now;
      modeState = policy.chooseMode(modeState, people.map(t => t.box), faces.map(t => t.box), now);
    }
    if (modeState.mode === 'crowd' || audit) {
      while (faceCalls < 2) {
        // 머리 높이를 자세히 훑되, 네 번마다 전체 화면 구역도 탐색한다.
        const wide = tileIndex++ % 4 === 3;
        const tile = wide ? { x: wideTileIndex % 4 * .7 / 3, y: Math.floor(wideTileIndex / 4) * .25, w: .3, h: .5 }
          : policy.detailTile(people.map(t => t.box), faces.map(t => t.box), bitmap.width / bitmap.height, detailIndex++);
        if (wide) wideTileIndex = (wideTileIndex + 1) % 12;
        faces = policy.mergeTracks(faces, detectFaces(bitmap, tile), now); faceCalls++;
      }
    } else if (people.length) {
      const count = Math.min(2 - faceCalls, people.length);
      for (let i = 0; i < count; i++) {
        const p = people[roiIndex++ % people.length];
        faces = policy.mergeTracks(faces, detectFaces(bitmap, policy.headRegion(p.box)), now); faceCalls++;
      }
    } else if (faces.length) {
      // 몸이 잘린 근접 얼굴 한 명도 소수 경로에서 계속 갱신한다.
      faces = policy.mergeTracks(faces, detectFaces(bitmap, full), now); faceCalls++;
    }
    modeState = policy.chooseMode(modeState, people.map(t => t.box), faces.map(t => t.box), now);
    postMessage({ type: 'result', capturedAt: now, mediaTime, epoch, mode: modeState.mode, delegate,
      masks: policy.maskBoxes(people, faces, now, modeState.mode, bitmap.width / bitmap.height).map(m => ({ ...m, sampledAt: now, vx: shift.x / dt, vy: shift.y / dt })),
      people: people.map(t => t.box), faces: faces.length, faceCalls, personCalls, ms: performance.now() - start });
  } finally { bitmap.close(); }
}
self.onmessage = ({ data }) => {
  try { if (data.type === 'frame') detect(data); }
  catch (error) { postMessage({ type: 'error', message: String(error.message || error) }); }
};
init().catch(error => postMessage({ type: 'error', message: String(error.message || error) }));
