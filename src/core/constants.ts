// 공용 상수. 숫자의 근거는 docs/specs/02-SSRD.md·04-ERD.md 해당 절.

/** 플랫폼 이름(2026-10-31 확정, 2026-11-01 철자 정정: famelet → framelet). 화면·코드에서 이름이 필요하면 이 상수만 쓴다. */
export const APP_NAME = 'framelet';

/** 매니페스트 network와 HOST_ALLOWED_ORIGINS에서 호스트 location.origin으로 바뀌는 자리표시. */
export const ORIGIN_TOKEN = '$ORIGIN';

/** 호스트가 허용하는 플러그인 통신 대상. 실제 connect-src = manifest.network ∩ 이 목록. 이번 데모는 $ORIGIN 하나. */
export const HOST_ALLOWED_ORIGINS: readonly string[] = [ORIGIN_TOKEN];

/** IF-07 /outward 채널 이름. */
export const OUTWARD_CHANNEL = 'framelet-outward';

/** 증명 로그는 최근 100건만 둔다(ERD §1). */
export const LOG_LIMIT = 100;
/** 같은 플러그인·같은 사유의 skip은 10초에 1번(결정판 N5). */
export const SKIP_DEDUP_MS = 10_000;
/** Counter.recent10s 기간. HUD M과 바깥 표시 N개가 이 창을 쓴다. */
export const RECENT_WINDOW_MS = 10_000;
/** Counter.window60s 기간(처리량 비율). */
export const THROUGHPUT_WINDOW_MS = 60_000;

/** F24 전송 범위 프레임 기본값(소스 프레임 기준 0~1, 가운데 60%) [제안]. */
export const CAPTURE_FRAME_DEFAULT = { x: 0.2, y: 0.2, w: 0.6, h: 0.6 } as const;
/** F24 프레임 한 변의 최소값(0~1) [제안]. */
export const CAPTURE_FRAME_MIN_SIDE = 0.1;
/** F25 사용 기록에 남기는 플러그인별 대표 조각 수 [제안]. */
export const USAGE_SAMPLES_PER_PLUGIN = 3;

/** IF-04: 전달 뒤 2초 안에 ack가 없으면 timeout. */
export const ACK_TIMEOUT_MS = 2_000;
/** 전환 공통 절차 ⑤: 새 iframe의 ready를 기다리는 시간. 넘으면 stopped. */
export const READY_TIMEOUT_MS = 3_000;
/** IF-08: 칼로리 플러그인이 fetch 전부터 res.text()까지 기다리는 시간. 넘으면 고정표. 서버의 상류 제한은 2.2초. */
export const CALORIE_CLIENT_TIMEOUT_MS = 3_000;

/** 플러그인에서 받는 메시지 한도(02-SSRD "플러그인 입력 위생"). answerText는 코디 스캔 answer(줄바꿈 허용). */
export const PLUGIN_MESSAGE_LIMITS = {
  perSecond: 20,
  maxSerializedBytes: 8 * 1024,
  text: 200,
  answerText: 1_000,
  id: 128,
  target: 512,
} as const;

// ── 코디 스캔(docs/designs/outfit-pipelines.md) ──
/** 이만큼 시야 가운데 원에 머문 사람을 응시 대상으로 본다. */
export const GAZE_DWELL_MS = 3_000;
/** 시야 가운데 원의 반지름 = 프레임 짧은 변 × 이 값. */
export const GAZE_CENTER_RADIUS = 0.18;
/** 동의는 허락한 뒤 이 시간이 지나면 끝난다. */
export const CONSENT_MAX_MS = 60_000;
/** 동의한 사람이 이 시간 넘게 안 보이면 동의가 끝난다. */
export const CONSENT_LOST_MS = 2_000;
/** 스토어에 남기는 코디 스캔 대화 수(오래된 것부터 버림). */
export const OUTFIT_TURNS_LIMIT = 20;
/** 질문 글자 수 상한(받아쓰기 포함). */
export const OUTFIT_QUESTION_MAX = 300;
/** 호스트가 answer를 기다리는 시간. 넘으면 failTurn. /api/outfit 서버 제한(15초)보다 길다. */
export const OUTFIT_ANSWER_TIMEOUT_MS = 20_000;
