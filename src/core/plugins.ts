// 플러그인 목록과 시작 매니페스트. 스토어가 만들어질 때 이 목록으로 Plugin 행을 채운다.
// 플러그인 코드(Worker 문자열)는 B가 src/plugins/에 두고, 다른 트랙은 그 파일을 import하지 않는다.

import { validateManifest } from './manifest';
import type { PluginKind } from './types';

export interface PluginSeed {
  id: string;
  kind: PluginKind;
  /** 시작 매니페스트 JSON. 편집기에도 이 문자열을 처음 값으로 보여 준다. */
  manifestJson: string;
  /** 시작할 때 켜 둘지. 변조·hello는 꺼 두고 필요할 때 켠다. */
  enabledByDefault: boolean;
}

const json = (o: unknown) => JSON.stringify(o, null, 2);

export const PLUGIN_SEEDS: readonly PluginSeed[] = [
  {
    id: 'calorie',
    kind: 'calorie',
    manifestJson: json({
      purpose: '음식 칼로리 추정',
      scenes: ['food'],
      region: 'target',
      maxSide: 256,
      quality: 0.8,
      maxPerMinute: 6,
      network: ['$ORIGIN'],
    }),
    enabledByDefault: true,
  },
  {
    id: 'outfit',
    kind: 'outfit',
    // 두 번째 앱 "코디 스캔"(docs/designs/outfit-pipelines.md). 착용자가 3초 응시 뒤 허락한 사람만, 얼굴은 가린 채 받는다.
    // 말로 물으면(IF-09) 받은 조각과 질문을 /api/outfit(Gemini)에 보내 답(IF-10)을 돌려준다.
    manifestJson: json({
      purpose: '코디 스캔',
      scenes: ['person'],
      region: 'target',
      maxSide: 512,
      quality: 0.8,
      maxPerMinute: 6,
      network: ['$ORIGIN'],
    }),
    // 켜 둔다: 글래스 시야 화면에는 앱 관리가 없다(?tools일 때만). 동의가 없으면 사람 조각을 보내지 않으므로 켜 둬도 나가는 것은 없다.
    enabledByDefault: true,
  },
  {
    id: 'tamper',
    kind: 'tamper',
    // 아무 주소도 요청하지 않는다. 변조 시도(외부 fetch·script)는 모두 "허용 목록 밖"으로 기록된다.
    manifestJson: json({ purpose: '변조 시험(차단 확인용)', scenes: ['food'], network: [] }),
    enabledByDefault: false,
  },
  {
    id: 'hello',
    kind: 'hello',
    // M0 관문용이자 발표용 두 번째 소비자("장면 기록", PRD F21 P2). 같은 피자 조각을 64px·통신 없이 받아
    // 같은 제한과 로그가 적용되는 것을 보여 준다. 결과 줄은 고정 문장("피자 장면 기록됨").
    manifestJson: json({ purpose: '장면 기록(두 번째 앱)', scenes: ['food'], maxSide: 64, network: [] }),
    enabledByDefault: false,
  },
];

// 시작 매니페스트가 틀리면 모듈을 불러올 때 바로 실패시킨다.
for (const seed of PLUGIN_SEEDS) {
  const r = validateManifest(seed.manifestJson, seed.id);
  if (!r.ok) throw new Error(`플러그인 ${seed.id} 시작 매니페스트 오류: ${r.errors.join(', ')}`);
}
