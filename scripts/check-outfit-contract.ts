// 코디 스캔 core 계약(docs/designs/outfit-pipelines.md) assertion. 실행: npx tsx scripts/check-outfit-contract.ts
import assert from 'node:assert/strict';
import { CONSENT_LOST_MS, CONSENT_MAX_MS, OUTFIT_QUESTION_MAX, PLUGIN_MESSAGE_LIMITS } from '../src/core/constants';
import { selectConsentCount } from '../src/core/selectors';
import { createLensStore } from '../src/core/store';
import type { OutfitTurn } from '../src/core/types';
import { parsePluginMessage } from '../src/plugins/host/validate';

let now = 1_000;
const store = createLensStore({ clock: () => now, hostOrigin: 'https://example.test' });
const s = () => store.getState();
const box = { x: 0.4, y: 0.3, w: 0.2, h: 0.5 };
let passed = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`ok ${passed} ${name}`);
};

ok('씨앗에 코디 스캔이 두 번째로, 켜진 채 있다', () => {
  assert.equal(s().pluginOrder[1], 'outfit');
  assert.equal(s().plugins.outfit?.kind, 'outfit');
  assert.equal(s().plugins.outfit?.enabled, true);
  assert.deepEqual(s().plugins.outfit?.manifest.scenes, ['person']);
});

ok('응시 대상이 아니면 동의를 만들지 않는다', () => {
  assert.equal(s().grantConsent('t1'), false);
  s().setGazeCandidate({ trackId: 't1', box, since: now });
  assert.equal(s().grantConsent('t2'), false);
  assert.equal(selectConsentCount(s(), now), 0);
});

ok('응시 대상이면 동의가 생기고 응시는 비며 사람 수는 1', () => {
  assert.equal(s().grantConsent('t1'), true);
  assert.equal(s().gaze, null);
  assert.equal(selectConsentCount(s(), now), 1);
  assert.equal(s().consents.t1?.expiresAt, now + CONSENT_MAX_MS);
});

ok('이미 동의한 사람은 다시 응시 대상이 되지 않는다', () => {
  s().setGazeCandidate({ trackId: 't1', box, since: now });
  assert.equal(s().gaze, null);
});

ok('안 보인 지 CONSENT_LOST_MS가 넘으면 수에서 빠지고 tick이 지운다', () => {
  now += CONSENT_LOST_MS - 1;
  s().touchConsent('t1', box);
  now += CONSENT_LOST_MS;
  assert.equal(selectConsentCount(s(), now), 1);
  now += 1;
  assert.equal(selectConsentCount(s(), now), 0);
  s().tick();
  assert.deepEqual(s().consents, {});
});

ok('CONSENT_MAX_MS가 지나면 계속 보여도 끝난다', () => {
  s().setGazeCandidate({ trackId: 't3', box, since: now });
  s().grantConsent('t3');
  for (let i = 0; i < 61; i++) {
    now += 1_000;
    s().touchConsent('t3', box);
  }
  assert.equal(selectConsentCount(s(), now), 0);
});

ok('revokeConsent로 끈다', () => {
  s().setGazeCandidate({ trackId: 't4', box, since: now });
  s().grantConsent('t4');
  s().revokeConsent('t4');
  assert.equal(selectConsentCount(s(), now), 0);
});

ok('보낸 조각이 없거나 질문이 비면 askPlugin은 null', () => {
  assert.equal(s().askPlugin('outfit', '저 바지 핏이 뭐야?'), null);
  assert.equal(s().askPlugin('outfit', '   '), null);
});

ok('asking turn에만 답을 한 번 받고 1,000자로 자른다', () => {
  const turn: OutfitTurn = {
    id: 'turn-x', pluginId: 'outfit', deliveryId: 'd1', question: 'q'.repeat(OUTFIT_QUESTION_MAX), answer: null,
    status: 'asking', source: null, failReason: null, askedAt: now, answeredAt: null,
  };
  store.setState({ outfitTurns: [turn] });
  assert.equal(s().recordAnswer('turn-x', 'a'.repeat(1_200), 'api'), true);
  assert.equal(s().outfitTurns[0]?.answer?.length, PLUGIN_MESSAGE_LIMITS.answerText);
  assert.equal(s().recordAnswer('turn-x', 'again', 'api'), false);
  s().failTurn('turn-x', '시간 초과');
  assert.equal(s().outfitTurns[0]?.status, 'answered');
});

ok('새 세션이면 응시·동의·대화를 비운다', () => {
  s().setGazeCandidate({ trackId: 't5', box, since: now });
  s().startNewSession();
  assert.equal(s().gaze, null);
  assert.deepEqual(s().consents, {});
  assert.deepEqual(s().outfitTurns, []);
});

ok('호스트 검증: answer는 1,000자까지, source는 api·fallback', () => {
  assert.equal(parsePluginMessage({ type: 'answer', questionId: 'q1', text: '줄\n바꿈 답', source: 'api' }).ok, true);
  const long = parsePluginMessage({ type: 'answer', questionId: 'q1', text: 'a'.repeat(1_001), source: 'api' });
  assert.equal(long.ok, false);
  assert.equal(parsePluginMessage({ type: 'answer', questionId: 'q1', text: 'x', source: 'model' }).ok, false);
});

console.log(`outfit contract: ${passed} passed`);
