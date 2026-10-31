// 전달 신호의 소리 쪽(F9). 시작 버튼 핸들러 안에서 unlockAudio()를 불러야 iPhone Safari가 소리를 허락한다(FR-039).

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
