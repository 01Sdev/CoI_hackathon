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
