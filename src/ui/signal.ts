// 전달 신호의 소리·진동 쪽(F9). 기본 신호는 HUD 테두리 점멸과 "전달됨"이고 이것은 보조다.
// 시작 버튼 핸들러 안에서 unlockAudio()를 불러야 iPhone Safari가 소리를 허락한다(FR-039). 무음 모드에서는 나지 않는다.

type AudioCtor = typeof AudioContext;

let ctx: AudioContext | null = null;

/** 사용자 제스처 핸들러 안에서 동기로 부른다. 지원하지 않는 브라우저에서는 아무것도 하지 않는다. */
export function unlockAudio(): void {
  const Ctor: AudioCtor | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
  if (!Ctor) return;
  ctx ??= new Ctor();
  if (ctx.state === 'suspended') void ctx.resume();
}

/** 120ms 짧은 음. 잠금 해제 전이면 조용히 넘어간다. */
export function playDeliveryTone(): void {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1046, t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.18, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.13);
}

/** Android 40ms 진동. iPhone에는 navigator.vibrate가 없다(FR-040 typeof 가드). 사용자가 한 번도 누르지 않은 페이지는 Chrome이 막으므로 부르지 않는다. */
export function vibrateDelivery(): void {
  if (typeof navigator.vibrate !== 'function') return;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  navigator.vibrate(40);
}
