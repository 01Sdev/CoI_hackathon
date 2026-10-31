// 공용 상수. 숫자의 근거는 docs/specs/02-SSRD.md·04-ERD.md 해당 절.

/** 플랫폼 이름(2026-10-31 확정). 화면·코드에서 이름이 필요하면 이 상수만 쓴다. */
export const APP_NAME = 'famelet';

/** 매니페스트 network와 HOST_ALLOWED_ORIGINS에서 호스트 location.origin으로 바뀌는 자리표시. */
export const ORIGIN_TOKEN = '$ORIGIN';

/** 호스트가 허용하는 플러그인 통신 대상. 실제 connect-src = manifest.network ∩ 이 목록. 이번 데모는 $ORIGIN 하나. */
export const HOST_ALLOWED_ORIGINS: readonly string[] = [ORIGIN_TOKEN];

/** IF-07 /outward 채널 이름. */
export const OUTWARD_CHANNEL = 'famelet-outward';

/** 증명 로그는 최근 100건만 둔다(ERD §1). */
export const LOG_LIMIT = 100;
/** 같은 플러그인·같은 사유의 skip은 10초에 1번(결정판 N5). */
export const SKIP_DEDUP_MS = 10_000;
/** Counter.recent10s 기간. HUD M과 바깥 표시 N개가 이 창을 쓴다. */
export const RECENT_WINDOW_MS = 10_000;
/** Counter.window60s 기간(처리량 비율). */
export const THROUGHPUT_WINDOW_MS = 60_000;

/** IF-04: 전달 뒤 2초 안에 ack가 없으면 timeout. */
export const ACK_TIMEOUT_MS = 2_000;
/** 전환 공통 절차 ⑤: 새 iframe의 ready를 기다리는 시간. 넘으면 stopped. */
export const READY_TIMEOUT_MS = 3_000;
/** IF-08: 플러그인 SDK가 /api/calorie 응답을 기다리는 시간. 넘으면 고정표. */
export const CALORIE_CLIENT_TIMEOUT_MS = 3_000;

/** 플러그인에서 받는 메시지 한도(02-SSRD "플러그인 입력 위생"). */
export const PLUGIN_MESSAGE_LIMITS = {
  perSecond: 20,
  maxSerializedBytes: 8 * 1024,
  text: 200,
  id: 128,
  target: 512,
} as const;
