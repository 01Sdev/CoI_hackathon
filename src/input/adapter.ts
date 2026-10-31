// 입력 어댑터(F1·F10). 웹캠·후면 카메라·녹화 mp4를 같은 <video playsInline muted autoplay> 하나로 연다.
// 근거: docs/specs/03-SRS.md FR-001~005, 02-SSRD §1(원본 접근은 A만, mountPreview, 좌우 반전 없음).
// <video>와 MediaStream은 이 모듈 밖으로는 vision/에만 나간다. 스토어에는 숫자(InputSource)만 쓴다.

import { lensStore } from '../core/store';
import type { InputKind, InputSource } from '../core/types';
import { CAMERA_IDEAL, DEFAULT_VIDEO_URL, OPEN_TIMEOUT_MS, PHONE_MAX_WIDTH } from './config';

let video: HTMLVideoElement | null = null;
let stream: MediaStream | null = null;
let videoUrl = DEFAULT_VIDEO_URL;
/** 입력을 열 때마다 오른다. vision은 포착 시작 때 값을 읽어 두고, 끝날 때 다르면 그 포착을 버린다. */
let epoch = 0;
let openSeq = 0;
let stopSubscription: (() => void) | null = null;

function ensureVideo(): HTMLVideoElement {
  if (video) return video;
  const v = document.createElement('video');
  // iPhone Safari 인라인 재생 조건(FR-003). 속성과 프로퍼티를 모두 둔다.
  v.muted = true;
  v.defaultMuted = true;
  v.playsInline = true;
  v.autoplay = true;
  v.setAttribute('muted', '');
  v.setAttribute('playsinline', '');
  v.setAttribute('autoplay', '');
  v.disablePictureInPicture = true;
  // 좌우 반전하지 않는다(targetBox를 그대로 겹치기 위해). 크기는 컨테이너를 따른다.
  Object.assign(v.style, { width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#000' });
  video = v;
  return v;
}

/** vision 전용. 원본 프레임에 닿으므로 A 디렉터리 밖에서 import하지 않는다. */
export function getVideo(): HTMLVideoElement | null {
  return video;
}

export function getInputEpoch(): number {
  return epoch;
}

/** 녹화 입력에 쓸 파일 주소. 다음 'video' 열기부터 반영된다(/dev 페이지·발표자 선택용). */
export function setVideoUrl(url: string): void {
  videoUrl = url;
}

export function getVideoUrl(): string {
  return videoUrl;
}

/** 화면 폭 768px 미만이면 후면, 이상이면 웹캠. /hud는 녹화 영상(D§4). */
export function defaultInputKind(): InputKind {
  if (location.pathname.startsWith('/hud')) return 'video';
  return window.innerWidth < PHONE_MAX_WIDTH ? 'rear' : 'webcam';
}

/**
 * 미리보기를 container에 붙인다. C는 컨테이너만 넘긴다(02-SSRD §1). 다른 컨테이너에 다시 부르면 옮겨 간다.
 * 돌려준 함수를 부르면 떼어 낸다(그 컨테이너에 붙어 있을 때만).
 */
export function mountPreview(container: HTMLElement): () => void {
  const v = ensureVideo();
  container.appendChild(v);
  // DOM에 옮겨 붙이면 일부 브라우저가 재생을 멈춘다.
  void v.play().catch(() => undefined);
  return () => {
    if (v.parentElement === container) container.removeChild(v);
  };
}

function stopStream() {
  if (stream) for (const t of stream.getTracks()) t.stop();
  stream = null;
}

function waitForFrames(v: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (v.readyState >= 2 && v.videoWidth > 0) return resolve();
    const done = (ok: boolean, err?: unknown) => {
      clearTimeout(timer);
      v.removeEventListener('loadeddata', onData);
      v.removeEventListener('error', onError);
      if (ok) resolve();
      else reject(err instanceof Error ? err : new Error(String(err ?? '영상 열기 실패')));
    };
    const onData = () => done(true);
    const onError = () => done(false, v.error ? new Error(`영상 오류 ${v.error.code}`) : undefined);
    const timer = setTimeout(() => done(false, new Error('영상 열기 시간 초과')), OPEN_TIMEOUT_MS);
    v.addEventListener('loadeddata', onData);
    v.addEventListener('error', onError);
  });
}

async function openCamera(v: HTMLVideoElement, kind: 'webcam' | 'rear'): Promise<number> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia 없음(HTTPS가 아니거나 지원하지 않는 브라우저)');
  const constraints: MediaStreamConstraints = {
    audio: false, // 마이크는 열지 않는다(C-8).
    video: {
      width: { ideal: CAMERA_IDEAL.width },
      height: { ideal: CAMERA_IDEAL.height },
      ...(kind === 'rear' ? { facingMode: { ideal: 'environment' } } : {}),
    },
  };
  const s = await navigator.mediaDevices.getUserMedia(constraints);
  stream = s;
  v.removeAttribute('src');
  v.loop = false;
  v.srcObject = s;
  await v.play().catch(() => undefined);
  await waitForFrames(v);
  return s.getVideoTracks()[0]?.getSettings().frameRate ?? 0;
}

async function openFile(v: HTMLVideoElement, url: string): Promise<number> {
  v.srcObject = null;
  v.loop = true;
  v.src = url;
  v.load();
  await v.play().catch(() => undefined);
  await waitForFrames(v);
  // mp4의 fps는 브라우저가 알려 주지 않는다. 0 = 모름.
  return 0;
}

/**
 * 요청한 입력을 연다. 카메라가 실패하면 녹화 영상으로 자동 전환한다(FR-004).
 * 늦게 끝난 이전 요청은 결과를 버린다.
 */
export async function openInput(kind: InputKind): Promise<InputSource | null> {
  const mySeq = ++openSeq;
  const v = ensureVideo();
  stopStream();
  epoch += 1;
  lensStore.getState().setInput(null);

  const finish = (src: InputSource | null) => {
    if (mySeq !== openSeq) return null;
    lensStore.getState().setInput(src);
    return src;
  };
  const source = (k: InputKind, fps: number, fallbackFrom: InputKind | null): InputSource => ({
    kind: k,
    width: v.videoWidth,
    height: v.videoHeight,
    fps,
    fallbackFrom,
  });

  if (kind === 'video') {
    try {
      const fps = await openFile(v, videoUrl);
      return finish(source('video', fps, null));
    } catch (e) {
      console.warn('[input] 녹화 영상을 열지 못함', videoUrl, e);
      return finish(null);
    }
  }

  try {
    const fps = await openCamera(v, kind);
    if (mySeq !== openSeq) {
      stopStream();
      return null;
    }
    return finish(source(kind, fps, null));
  } catch (e) {
    console.warn(`[input] ${kind} 실패, 녹화 영상으로 전환`, e);
    if (mySeq !== openSeq) return null;
    stopStream();
    try {
      const fps = await openFile(v, videoUrl);
      return finish(source('video', fps, kind));
    } catch (e2) {
      console.warn('[input] 녹화 영상도 열지 못함', videoUrl, e2);
      return finish(null);
    }
  }
}

/**
 * session.inputRequest를 구독해(fireImmediately) 요청마다 입력을 연다. 요청이 아직 없으면 기본 입력을 연다.
 * 여러 번 불러도 구독은 하나다. 돌려준 함수는 구독을 풀고 입력을 닫는다.
 */
export function startInput(): () => void {
  if (stopSubscription) return stopInput;
  let opened = false;
  stopSubscription = lensStore.subscribe(
    (s) => s.session.inputRequest,
    (req) => {
      if (req) {
        opened = true;
        void openInput(req.kind);
      } else if (!opened) {
        opened = true;
        void openInput(defaultInputKind());
      }
    },
    { fireImmediately: true },
  );
  return stopInput;
}

function stopInput() {
  stopSubscription?.();
  stopSubscription = null;
  openSeq += 1;
  epoch += 1;
  stopStream();
  if (video) {
    video.pause();
    video.srcObject = null;
    video.removeAttribute('src');
    video.load();
  }
  lensStore.getState().setInput(null);
}
