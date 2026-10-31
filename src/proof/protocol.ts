// 규약 보기(안 B, app-structure §3.2) 문구. 앱 관리에서 여는 화면이고 허용/거절 버튼은 없다(결정 N12 유지).
// 순수 함수로 두어 check:ui가 문구를 고정한다.

import { APP_NAME, ORIGIN_TOKEN } from '../core/constants';
import type { VersionedManifest } from '../core/types';
import { MANIFEST_SCENE_LABEL } from '../ui/labels';

/** 앱이 바꿀 수 없는 보장 네 가지. 얼굴 검출은 놓칠 수 있어 "모든 얼굴"이라고 쓰지 않는다. */
export const GUARANTEES = [
  '원본 화면은 보내지 않아요',
  `${APP_NAME}이 찾은 얼굴은 가리고, 못 가리면 보내지 않아요`,
  '흰 틀 밖은 보내지 않아요',
  '보낸 것은 모두 기록에 남겨요',
] as const;

/** 비교 모드(F17)는 보장의 유일한 예외라 숨기지 않는다. */
export const GUARANTEE_EXCEPTION = '발표용 비교 모드를 켜면 2번이 잠시 꺼져요. 그동안 앱의 통신은 막혀요.';

export const SERVER_NOTE = `${APP_NAME} 서버는 받은 조각을 칼로리 계산용 AI 모델(Anthropic)에 넘기고, 계산 결과만 앱에 돌려줘요.`;

/** F22. 안 B라 "다시 물어봐요"는 쓰지 않는다. */
export const NO_RECALL_NOTE = '끄거나 끊어도 이미 보낸 사진은 되돌릴 수 없어요.';

export interface Receiver {
  requested: string;
  allowed: string;
  /** $ORIGIN을 요청했고 허용됐다. 표 아래에 SERVER_NOTE를 둔다. */
  viaServer: boolean;
}

/**
 * 받는 곳 두 칸. $ORIGIN은 "{APP_NAME} 서버", 그 밖의 주소는 호스트 이름 그대로, network가 비면 "밖으로 안 보냄".
 * 허용 칸은 allowedOrigins(= network ∩ HOST_ALLOWED_ORIGINS, $ORIGIN은 이 서비스 주소로 바뀜)에 없으면 "허용 안 함",
 * 하나만 허용되면 "…만". 비교 모드의 칼로리처럼 iframe이 connect-src 'none'이면 지금은 막혀 있다고 쓴다.
 */
export function receiverText(network: readonly string[], allowedOrigins: readonly string[], selfOrigin: string, connectNone: boolean): Receiver {
  if (network.length === 0) return { requested: '밖으로 안 보냄', allowed: '밖으로 안 보냄', viaServer: false };
  const items = network.map((o) => {
    const self = o === ORIGIN_TOKEN;
    return { name: self ? `${APP_NAME} 서버` : hostName(o), self, ok: allowedOrigins.includes(self ? selfOrigin : o) };
  });
  const requested = items.map((i) => i.name).join(', ');
  const viaServer = items.some((i) => i.self && i.ok);
  if (connectNone) return { requested, allowed: '지금은 막음 · 비교 모드', viaServer };
  const allowed =
    items.length === 1 && items[0]!.ok ? `${items[0]!.name}만` : items.map((i) => (i.ok ? i.name : `${i.name} 허용 안 함`)).join(', ');
  return { requested, allowed, viaServer };
}

function hostName(origin: string): string {
  try {
    return new URL(origin).hostname || origin;
  } catch {
    return origin;
  }
}

/** "이 앱이 받는 것" 표의 줄: [항목, 앱이 요청, framelet이 허용]. quality는 데스크톱 확인 화면에만 둔다. */
export function protocolRows(
  m: Pick<VersionedManifest, 'scenes' | 'maxSide' | 'maxPerMinute'>,
  receiver: Receiver,
): Array<[string, string, string]> {
  const scenes = m.scenes.map((sc) => MANIFEST_SCENE_LABEL[sc]).join(', ');
  return [
    ['장면', scenes, `${scenes} 앞에 있을 때만`],
    ['영역', '대상 하나', '흰 틀 안의 대상 하나'],
    ['크기', `긴 변 ${m.maxSide}px`, `긴 변 ${m.maxSide}px까지`],
    ['빈도', `분당 ${m.maxPerMinute}장`, `분당 ${m.maxPerMinute}장까지`],
    ['받는 곳', receiver.requested, receiver.allowed],
  ];
}
