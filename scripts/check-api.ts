// api/calorie·api/outfit assertion 스크립트. 실행: npm run check:api
// 실제 @anthropic-ai/sdk를 가짜 상류(로컬 HTTP 서버)에 붙여 판정 순서·요청 모양·시간 제한·재시도 없음·응답 처리·502 로그를 본다(TC-053).
// 진짜 모델 호출(V5)은 키가 있을 때 scripts/measure-calorie.ts로 따로 잰다.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  CALORIE_SCHEMA,
  DEFAULT_MODEL,
  MAX_BODY_BYTES,
  OPTIONS,
  SYSTEM_PROMPT,
  UPSTREAM_TIMEOUT_MS,
  createCalorieHandler,
} from '../api/calorie';
import {
  DEFAULT_MODEL as OUTFIT_DEFAULT_MODEL,
  OPTIONS as outfitOptions,
  SYSTEM_INSTRUCTION as OUTFIT_SYSTEM,
  createOutfitHandler,
} from '../api/outfit';
import { OUTFIT_FALLBACK_TEXT } from '../src/plugins/outfit';

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed += 1;
  console.log(`ok  ${name}`);
}

const jpeg = new Uint8Array(readFileSync(new URL('../dev/fixtures/m0-test.jpg', import.meta.url)));
const jpegSha = createHash('sha256').update(jpeg).digest('hex');

// 502 로그 한 줄을 붙잡는다.
const logs: string[] = [];
const origError = console.error;
console.error = (...args: unknown[]) => logs.push(args.map(String).join(' '));

// ── 가짜 상류: 시험마다 behave를 바꾼다 ──
type Behave = { delayMs?: number; status?: number; errorType?: string; message?: Record<string, unknown> };
let behave: Behave = {};
const seen: { path: string; body: Record<string, unknown>; headers: IncomingMessage['headers'] }[] = [];
const msg = (answer: unknown, stop_reason = 'end_turn', content?: unknown[]) => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: DEFAULT_MODEL,
  content: content ?? [{ type: 'text', text: typeof answer === 'string' ? answer : JSON.stringify(answer) }],
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 300, output_tokens: 30 },
});
const upstream = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    seen.push({ path: req.url ?? '', body: JSON.parse(Buffer.concat(chunks).toString('utf8')), headers: req.headers });
    const send = () => {
      if (res.destroyed) return;
      const failing = behave.status !== undefined && behave.status !== 200;
      res.writeHead(behave.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(failing ? { type: 'error', error: { type: behave.errorType ?? 'api_error', message: 'x' } } : behave.message));
    };
    if (behave.delayMs) setTimeout(send, behave.delayMs);
    else send();
  });
});
await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
const baseURL = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

const big = { count: 1_000, windowMs: 60_000 };
const handler = createCalorieHandler({ baseURL, apiKey: 'test-key-not-real', rateLimit: big });
const post = (body: BodyInit | null, headers: Record<string, string> = { 'content-type': 'image/jpeg' }, h = handler) =>
  h(new Request('https://framelet.test/api/calorie', { method: 'POST', body, headers }));
const ok = (answer: unknown) => {
  behave = { message: msg(answer) };
};
const pizza = { is_food: true, food_ko: '피자', portion: '한 조각', kcal: 290 };

await check('OPTIONS → 204, CORS·Allow-Methods·Allow-Headers·Max-Age (Vercel 내보내기도 같음)', async () => {
  for (const r of [await handler(new Request('https://framelet.test/api/calorie', { method: 'OPTIONS' })), OPTIONS()]) {
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.equal(r.headers.get('access-control-allow-methods'), 'POST');
    assert.equal(r.headers.get('access-control-allow-headers'), 'content-type, x-label');
    assert.equal(r.headers.get('access-control-max-age'), '600');
  }
});

await check('정상 JPEG → 200 한 줄, 받은 본문 헤더, CORS', async () => {
  ok(pizza);
  const r = await post(jpeg, { 'content-type': 'image/jpeg', 'x-label': 'pizza' });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '피자 약 290kcal');
  assert.equal(r.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(r.headers.get('x-framelet-body-bytes'), String(jpeg.length));
  assert.equal(r.headers.get('x-framelet-body-sha256'), jpegSha);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.equal(
    r.headers.get('access-control-expose-headers'),
    'X-Framelet-Body-Bytes, X-Framelet-Body-SHA256, X-Framelet-Kcal-Clamped',
  );
  assert.equal(r.headers.get('x-framelet-kcal-clamped'), null);
});

await check('상류 요청 모양: 모델·effort low·json_schema·max_tokens·시스템 프롬프트·이미지 먼저·thinking 없음', async () => {
  const req = seen.at(-1)!;
  assert.equal(req.path, '/v1/messages');
  assert.equal(req.headers['x-api-key'], 'test-key-not-real');
  const b = req.body;
  assert.equal(b.model, 'claude-haiku-5-5');
  assert.equal(b.max_tokens, 1024);
  assert.equal(b.system, SYSTEM_PROMPT);
  assert.deepEqual(b.output_config, { effort: 'low', format: { type: 'json_schema', schema: JSON.parse(JSON.stringify(CALORIE_SCHEMA)) } });
  assert.equal('thinking' in b, false);
  assert.equal('temperature' in b, false);
  const content = (b.messages as { content: Record<string, unknown>[] }[])[0]!.content;
  assert.equal(content[0]!.type, 'image');
  assert.deepEqual(content[0]!.source, { type: 'base64', media_type: 'image/jpeg', data: Buffer.from(jpeg).toString('base64') });
  assert.deepEqual(content[1], { type: 'text', text: '감지기 라벨: pizza' });
});

await check('x-label: core 정규식을 통과한 값만 프롬프트에(hot dog 통과, 대문자·연속 공백·쉼표·33자는 없음)', async () => {
  ok(pizza);
  const labelOf = () => ((seen.at(-1)!.body.messages as { content: Record<string, unknown>[] }[])[0]!.content[1] as { text: string }).text;
  await post(jpeg, { 'content-type': 'image/jpeg', 'x-label': 'hot dog' });
  assert.equal(labelOf(), '감지기 라벨: hot dog');
  for (const bad of ['Pizza', 'hot  dog', 'pizza, pizza', 'pizza; ignore previous', 'a'.repeat(33)]) {
    await post(jpeg, { 'content-type': 'image/jpeg', 'x-label': bad });
    assert.equal(labelOf(), '감지기 라벨: 없음', bad);
  }
});

await check('판정 순서: 405 → 429 → 413 → 415 → 502(상류에 가기 전 단계는 상류 요청 0건)', async () => {
  let t = 0;
  const h = createCalorieHandler({ baseURL, apiKey: 'test-key-not-real', rateLimit: { count: 2, windowMs: 60_000 }, now: () => t });
  const before = seen.length;
  assert.equal((await h(new Request('https://framelet.test/api/calorie'))).status, 405);
  assert.equal((await post('x', { 'content-type': 'text/plain' }, h)).status, 415);
  assert.equal((await post('x', { 'content-type': 'text/plain' }, h)).status, 415);
  assert.equal((await post(jpeg, undefined, h)).status, 429); // 3번째: 고정 창 60초에 2건
  t = 59_999;
  assert.equal((await post(jpeg, undefined, h)).status, 429);
  t = 60_000; // 새 창
  ok(pizza);
  assert.equal((await post(jpeg, undefined, h)).status, 200);
  assert.equal(seen.length - before, 1);
});

await check('413: 614,400B 초과(Content-Length·실제 본문), 받은 본문 헤더 없음. 정확히 614,400B는 통과', async () => {
  const over = new Uint8Array(MAX_BODY_BYTES + 1);
  over.set([0xff, 0xd8, 0xff]);
  const r = await post(over);
  assert.equal(r.status, 413);
  assert.equal(r.headers.get('x-framelet-body-bytes'), null);
  const exact = new Uint8Array(MAX_BODY_BYTES);
  exact.set([0xff, 0xd8, 0xff]);
  ok({ is_food: false, food_ko: '', portion: '알 수 없음', kcal: 0 });
  const r2 = await post(exact);
  assert.equal(r2.status, 200);
  assert.equal(await r2.text(), '음식 아님');
});

await check('415: image/jpeg 아님·0바이트·FF D8 FF 아님, 받은 본문 헤더 있음, 상류 요청 0건', async () => {
  const before = seen.length;
  const r1 = await post('hello', { 'content-type': 'text/plain' });
  assert.equal(r1.status, 415);
  assert.equal(r1.headers.get('x-framelet-body-bytes'), '5');
  assert.equal((await post(new Uint8Array(0))).status, 415);
  const r3 = await post(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  assert.equal(r3.status, 415);
  assert.equal(r3.headers.get('x-framelet-body-sha256'), createHash('sha256').update(new Uint8Array([0x89, 0x50, 0x4e, 0x47])).digest('hex'));
  assert.equal(seen.length - before, 0);
});

await check(`502: 상류 8초 지연 → ${UPSTREAM_TIMEOUT_MS}ms에 끊고 재시도 없음, 로그 "calorie 502 timeout"`, async () => {
  behave = { delayMs: 8_000, message: msg(pizza) };
  const before = seen.length;
  logs.length = 0;
  const t0 = performance.now();
  const r = await post(jpeg);
  const ms = performance.now() - t0;
  assert.equal(r.status, 502);
  assert.equal(await r.text(), 'upstream timeout');
  assert.ok(ms >= UPSTREAM_TIMEOUT_MS - 100 && ms < UPSTREAM_TIMEOUT_MS + 500, `${Math.round(ms)}ms`);
  assert.equal(r.headers.get('x-framelet-body-sha256'), jpegSha);
  await new Promise((res) => setTimeout(res, 300));
  assert.equal(seen.length - before, 1);
  assert.deepEqual(logs, ['calorie 502 timeout']);
  console.log(`    (${Math.round(ms)}ms)`);
});

await check('502: 상류 400·401·429·500·529 → 재시도 없이 502, 로그 "calorie 502 upstream=<상태> type=<종류>"', async () => {
  for (const [status, errorType] of [
    [400, 'invalid_request_error'],
    [401, 'authentication_error'],
    [429, 'rate_limit_error'],
    [500, 'api_error'],
    [529, 'overloaded_error'],
  ] as const) {
    behave = { status, errorType };
    const before = seen.length;
    logs.length = 0;
    assert.equal((await post(jpeg)).status, 502);
    assert.equal(seen.length - before, 1);
    assert.deepEqual(logs, [`calorie 502 upstream=${status} type=${errorType}`]);
  }
});

await check('502: stop_reason refusal·max_tokens, text 블록 없음, JSON·스키마 위반', async () => {
  const cases: [Record<string, unknown>, string][] = [
    [msg(pizza, 'refusal'), 'calorie 502 stop_reason=refusal'],
    [msg(pizza, 'max_tokens'), 'calorie 502 stop_reason=max_tokens'],
    [msg(pizza, 'end_turn', [{ type: 'thinking', thinking: '', signature: 's' }]), 'calorie 502 format=no-text'],
    [msg('not json'), 'calorie 502 format=json'],
    [msg({ ...pizza, kcal: '290' }), 'calorie 502 format=schema'],
    [msg({ ...pizza, portion: '두 조각' }), 'calorie 502 format=schema'],
    [msg({ ...pizza, kcal: 290.5 }), 'calorie 502 format=schema'],
  ];
  for (const [m, line] of cases) {
    behave = { message: m };
    logs.length = 0;
    assert.equal((await post(jpeg)).status, 502);
    assert.deepEqual(logs, [line]);
  }
});

await check('응답 처리 2: 생각 블록이 앞에 와도 첫 text 블록을 쓴다', async () => {
  behave = { message: msg(pizza, 'end_turn', [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: JSON.stringify(pizza) }]) };
  const r = await post(jpeg);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '피자 약 290kcal');
});

await check('502: 서버 환경 변수에 키가 없으면 상류 요청 없이 502, 로그 "calorie 502 no-key"', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const h = createCalorieHandler({ baseURL, rateLimit: big });
    const before = seen.length;
    logs.length = 0;
    assert.equal((await post(jpeg, undefined, h)).status, 502);
    assert.equal(seen.length - before, 0);
    assert.deepEqual(logs, ['calorie 502 no-key']);
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

await check('응답 처리 4~7: 음식 아님, 이름 공백 정리·12자, 빈 이름, 고정표 비율 [0.25, 4]×기준(한 판 ×8)과 이름 교체, 10~3000', async () => {
  const cases: [Record<string, unknown>, string | undefined, string, boolean][] = [
    [{ is_food: false, food_ko: '', portion: '알 수 없음', kcal: 0 }, 'pizza', '음식 아님', false],
    [{ is_food: true, food_ko: '  아주   긴\t음식이름입니다요요  ', portion: '1인분', kcal: 500 }, undefined, '아주 긴 음식이름입니다 약 500kcal', false],
    [{ is_food: true, food_ko: ' \n ', portion: '1인분', kcal: 500 }, undefined, '음식 약 500kcal', false],
    [{ is_food: true, food_ko: '사탕', portion: '1인분', kcal: 5 }, undefined, '사탕 약 10kcal', false],
    [{ is_food: true, food_ko: '사탕', portion: '1인분', kcal: 9_999 }, undefined, '사탕 약 3000kcal', false],
    [{ is_food: true, food_ko: '피자', portion: '한 판', kcal: 2_000 }, 'pizza', '피자 약 2000kcal', false],
    [{ is_food: true, food_ko: '피자', portion: '한 판', kcal: 10_000 }, 'pizza', '피자 약 2280kcal', true],
    [{ is_food: true, food_ko: '피자', portion: '한 조각', kcal: 50 }, 'pizza', '피자 약 285kcal', true],
    [{ is_food: true, food_ko: '마르게리타', portion: '한 조각', kcal: 1_500 }, 'pizza', '피자 약 285kcal', true],
    [{ is_food: true, food_ko: '마르게리타', portion: '한 조각', kcal: 1_100 }, 'pizza', '마르게리타 약 1100kcal', false],
    [{ is_food: true, food_ko: '그릇 음식', portion: '1인분', kcal: 9_999 }, 'bowl', '그릇 음식 약 3000kcal', false],
  ];
  for (const [answer, label, expected, clamped] of cases) {
    ok(answer);
    const r = await post(jpeg, label ? { 'content-type': 'image/jpeg', 'x-label': label } : { 'content-type': 'image/jpeg' });
    assert.equal(r.status, 200);
    assert.equal(await r.text(), expected);
    assert.equal(r.headers.get('x-framelet-kcal-clamped'), clamped ? '1' : null, expected);
  }
});

// ── /api/outfit(IF-11, Gemini generateContent) ──
const gemini = (text: string | null, extra: Record<string, unknown> = {}) => ({
  candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: text === null ? [] : [{ text }] } }],
  ...extra,
});
const outfitHandler = createOutfitHandler({ baseURL, apiKey: 'test-key-not-real', rateLimit: big, timeoutMs: 300 });
const jpegB64 = Buffer.from(jpeg).toString('base64');
const ask = (body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }, h = outfitHandler) =>
  h(new Request('http://localhost/api/outfit', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers }));
const outfitBody = (r: Response) => r.json() as Promise<{ answer?: string; source?: string; error?: string }>;

await check('outfit: OPTIONS 204·CORS, 405, 정상 → 200 {answer, source: api}', async () => {
  const pre = outfitOptions();
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  assert.equal(pre.headers.get('access-control-allow-methods'), 'POST');
  assert.equal(pre.headers.get('access-control-allow-headers'), 'content-type');
  const get = await outfitHandler(new Request('http://localhost/api/outfit', { method: 'GET' }));
  assert.equal(get.status, 405);
  behave = { message: gemini('흰 셔츠에 데님 재킷을 겹친 캐주얼 차림이에요.') };
  seen.length = 0;
  const r = await ask({ image: jpegB64, question: '이 옷 어디 거야?' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await outfitBody(r), { answer: '흰 셔츠에 데님 재킷을 겹친 캐주얼 차림이에요.', source: 'api' });
});
await check(`outfit: Gemini 요청 모양(${OUTFIT_DEFAULT_MODEL}, generateContent, x-goog-api-key, 시스템 지시, 이미지 먼저)`, async () => {
  const s = seen.at(-1)!;
  assert.equal(s.path, `/v1beta/models/${OUTFIT_DEFAULT_MODEL}:generateContent`);
  assert.equal(s.headers['x-goog-api-key'], 'test-key-not-real');
  assert.deepEqual(s.body.systemInstruction, { parts: [{ text: OUTFIT_SYSTEM }] });
  const parts = (s.body.contents as { role: string; parts: Record<string, unknown>[] }[])[0]!;
  assert.equal(parts.role, 'user');
  assert.deepEqual(parts.parts[0], { inlineData: { mimeType: 'image/jpeg', data: jpegB64 } });
  assert.deepEqual(parts.parts[1], { text: '착용자의 질문: 이 옷 어디 거야?' });
  assert.deepEqual(s.body.generationConfig, { maxOutputTokens: 512 });
  // 시스템 지시: 해요체·옷만·신상 추측 금지·브랜드는 보일 때만.
  for (const word of ['해요체', '나이·성별·인종', '건강', '로고나 글자가 사진에 또렷이 보일 때만']) assert.ok(OUTFIT_SYSTEM.includes(word), word);
});
await check('outfit: 판정(415 JSON 아님, 400 잘못된 JSON·빈 질문·301자·base64 아님, 415 JPEG 아님, 413) → 상류 요청 0건', async () => {
  seen.length = 0;
  assert.equal((await ask('x', { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await ask('{', { 'content-type': 'application/json' })).status, 400);
  assert.equal((await ask({ image: jpegB64, question: '  ' })).status, 400);
  assert.equal((await ask({ image: jpegB64, question: 'a'.repeat(301) })).status, 400);
  assert.equal((await ask({ image: jpegB64, question: 'a'.repeat(300) })).status, 200);
  assert.equal((await ask({ image: '!!!', question: '무슨 옷?' })).status, 400);
  assert.equal((await ask({ image: Buffer.from('not jpeg').toString('base64'), question: '무슨 옷?' })).status, 415);
  assert.equal((await ask({ image: Buffer.alloc(614_401, 0xff).toString('base64'), question: '무슨 옷?' })).status, 413);
  assert.equal((await ask('x'.repeat(1_000_001))).status, 413);
  assert.equal(seen.length, 1); // 300자 통과 1건만
});
await check('outfit: 키 없음·시간 초과·상류 429·막힘·빈 답 → 200 대체 문구(source fallback), 로그 한 줄에 내용 없음', async () => {
  logs.length = 0;
  seen.length = 0;
  const noKey = createOutfitHandler({ baseURL, apiKey: '', rateLimit: big });
  const prev = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const q = { image: jpegB64, question: '이 바지 핏 어때?' };
  assert.deepEqual(await outfitBody(await ask(q, undefined, noKey)), { answer: OUTFIT_FALLBACK_TEXT, source: 'fallback' });
  if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
  assert.equal(seen.length, 0);
  behave = { delayMs: 2_000, message: gemini('늦은 답') };
  const t0 = Date.now();
  assert.deepEqual(await outfitBody(await ask(q)), { answer: OUTFIT_FALLBACK_TEXT, source: 'fallback' });
  assert.ok(Date.now() - t0 < 1_500, `시간 제한(300ms)에 끊음: ${Date.now() - t0}ms`);
  behave = { status: 429 };
  assert.equal((await outfitBody(await ask(q))).source, 'fallback');
  behave = { message: { promptFeedback: { blockReason: 'SAFETY' } } };
  assert.equal((await outfitBody(await ask(q))).source, 'fallback');
  behave = { message: gemini(null) };
  assert.equal((await outfitBody(await ask(q))).source, 'fallback');
  assert.deepEqual(
    logs.filter((l) => l.startsWith('outfit')),
    [
      'outfit fallback no-key',
      'outfit fallback timeout',
      'outfit fallback upstream=429 status=unknown',
      'outfit fallback blocked=SAFETY',
      'outfit fallback format=no-text finish=STOP',
    ],
  );
  assert.ok(logs.every((l) => !l.includes('바지') && !l.includes('test-key') && !l.includes(jpegB64.slice(0, 20))));
});
await check('outfit: 생각(thought) 조각은 빼고, 1,000자로 자른다. 고정 창 30건', async () => {
  behave = { message: { candidates: [{ content: { parts: [{ text: '속으로 생각', thought: true }, { text: '니트예요.' }] } }] } };
  assert.equal((await outfitBody(await ask({ image: jpegB64, question: '무슨 옷?' }))).answer, '니트예요.');
  behave = { message: gemini('가'.repeat(1_500)) };
  assert.equal((await outfitBody(await ask({ image: jpegB64, question: '무슨 옷?' }))).answer!.length, 1_000);
  behave = { message: gemini('네') };
  const small = createOutfitHandler({ baseURL, apiKey: 'test-key-not-real', rateLimit: { count: 2, windowMs: 60_000 } });
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await ask({ image: jpegB64, question: '무슨 옷?' }, undefined, small)).status);
  assert.deepEqual(codes, [200, 200, 429]);
});

upstream.close();
console.error = origError;
console.log(`\n${passed}개 통과`);
