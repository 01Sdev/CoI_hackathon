// 입력 어댑터 설정값. 근거: docs/specs/03-SRS.md FR-001~005, 05 결정 20(K-11, 실측으로 정함), V4.

/** 녹화 입력 기본 파일(08-데모-소재.md, public/demo/). 파일이 없으면 입력이 null이 된다. */
export const DEFAULT_VIDEO_URL = '/demo/pizza-alone.mp4';

/** 이 폭 미만이면 후면 카메라, 이상이면 노트북 웹캠(EI-1, FR-001·002). */
export const PHONE_MAX_WIDTH = 768;

/**
 * 카메라에 요청하는 해상도(ideal). K-11은 미정이라 V4 실측 값을 시작값으로 둔다.
 * iPhone은 1280×720 요청에 세로 720×1280을 열었고 포착 평균 29ms였다.
 */
export const CAMERA_IDEAL = { width: 1280, height: 720 } as const;

/** 카메라·영상이 메타데이터를 내지 않을 때 기다리는 시간(ms). 넘으면 실패로 보고 대체 입력으로 간다. */
export const OPEN_TIMEOUT_MS = 8000;

/**
 * 광각(양옆 휘어짐) 효과. 입력 단계에서 휘므로 미리보기·0단계·포착·가림·흰 틀 자르기가 모두 같은 휜 화면을 쓴다.
 * 설계: docs/designs/input-wide-warp.md. 수식·경계는 src/input/warp.ts.
 */
export const WIDE_WARP = {
  /** 끄면 휘지 않고 <video>를 그대로 쓴다(periphery 0과 같은 원본). /dev는 ?warp=0으로 끈다. */
  enabled: true,
  /**
   * 양옆 휘어짐 조절값(화각 아님). 0.82는 사용자가 iPhone 실기기에서 마지막으로 맞춘 값(2026-11-01 "지금 광각효과 딱 좋아").
   * 인계 파일 pov-warp-lab.html의 슬라이더 기본값은 0.80이다.
   */
  periphery: 0.82,
  strength: 0,
  framing: 1,
  lookX: 0,
  lookY: 0,
  fit: 'cover',
  /** 휜 프레임의 긴 변 상한(인계 파일 기본 1280px). 원본보다 키우지 않는다. 비율은 원본 그대로. */
  maxLongSide: 1280,
  /** WebGL2가 없을 때 CPU 경로의 긴 변 상한. */
  cpuMaxLongSide: 640,
  /** 미리보기 다시 그리기 상한(fps). 판정·포착은 읽을 때마다 그 자리에서 다시 그린다. */
  previewFps: 30,
} as const;

/** 코디 스캔 받아쓰기 녹음 상한(ms). 넘으면 녹음을 스스로 멈춘다(src/input/mic.ts). */
export const MIC_MAX_MS = 15_000;

/**
 * 녹음 형식 후보(MediaRecorder.isTypeSupported로 앞에서부터 고른다). WebKit(Safari, iOS의 모든 브라우저)은 audio/mp4,
 * 그 밖(Chrome 등)은 audio/webm을 먼저 본다. 둘 다 /api/stt(ElevenLabs)가 받는다.
 */
export const MIC_MIME_TYPES = {
  webkit: ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'],
  other: ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'],
} as const;
