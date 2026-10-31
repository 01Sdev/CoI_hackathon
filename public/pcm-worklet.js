// 코디 스캔 실시간 받아쓰기용 AudioWorklet(src/input/scribe.ts가 불러온다). 마이크 입력을 16kHz Int16 PCM 4096샘플 조각으로
// 바꿔 port로 보낸다. { type: 'flush' }를 받으면 남은 조각을 보내고 { type: 'flushed' }로 답한 뒤 더는 보내지 않는다.
// 출처: 사용자의 SAI 프로젝트 apps/sai/web/public/pcm-worklet.js(검증된 코드)를 그대로 옮겼다. 오디오를 저장하지 않는다.
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(4096);
    this.index = 0;
    this.phase = 0;
    this.flushed = false;
    this.port.onmessage = (e) => {
      if (e.data?.type !== 'flush' || this.flushed) return;
      this.flushed = true;
      if (this.index) {
        const tail = this.buffer.slice(0, this.index);
        this.port.postMessage(tail.buffer, [tail.buffer]);
        this.index = 0;
      }
      this.port.postMessage({ type: 'flushed' });
    };
  }

  process(inputs) {
    if (this.flushed) return true;
    const input = inputs[0]?.[0];
    if (!input) return true;
    const step = 16000 / sampleRate;
    for (let i = 0; i < input.length; i++) {
      this.phase += step;
      if (this.phase >= 1) {
        this.phase -= 1;
        const sample = Math.max(-1, Math.min(1, input[i]));
        this.buffer[this.index++] = sample < 0 ? sample * 32768 : sample * 32767;
        if (this.index === this.buffer.length) {
          this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
          this.buffer = new Int16Array(4096);
          this.index = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-recorder', PCMProcessor);
