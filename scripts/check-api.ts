// api/calorie assertion 스크립트. 실행: npm run check:api
// 실제 @anthropic-ai/sdk를 가짜 상류(로컬 HTTP 서버)에 붙여 요청 모양·시간 제한·재시도 없음·응답 보정을 본다(TC-053).
// 진짜 모델 호출(V5)은 키가 있을 때 scripts/measure-calorie.ts로 따로 잰다.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  CALORIE_FALLBACK_TABLE,
  CALORIE_SCHEMA,
  DEFAULT_MODEL,
  MAX_BODY_BYTES,
  SYSTEM_PROMPT,
  createCalorieHandler,
} from '../api/calorie';
import { CALORIE_FALLBACK_TABLE as PLUGIN_TABLE } from '../src/plugins/calorie';

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed += 1;
  console.log(`ok  ${name}`);
}

const jpeg = new Uint8Array(readFileSync(new URL('../dev/fixtures/m0-test.jpg', import.meta.url)));
const jpegSha = createHash('sha256').update(jpeg).digest('hex');

// ── 가짜 상류: 테스트마다 behave를 바꾼다 ──
type Behave = { delayMs?: number; status?: number; message?: Record<string, unknown> };
let behave: Behave = {};
const seen: { path: string; body: Record<string, unknown>; headers: IncomingMessage['headers'] }[] = [];
const msg = (answer: unknown, stop_reason = 'end_turn') => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: DEFAULT_MODEL,
  content: [{ type: 'text', text: typeof answer === 'string' ? answer : JSON.stringify(answer) }],
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
      res.writeHead(behave.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(behave.status && behave.status !== 200 ? { type: 'error', error: { type: 'api_error', message: 'x' } } : behave.message));
    };
    if (behave.delayMs) setTimeout(send, behave.delayMs);
    else send();
  });
});
await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
const baseURL = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

const handler = createCalorieHandler({ baseURL, apiKey: 'test-key-not-real', rateLimitPerMinute: 1_000 });
const post = (body: BodyInit | null, headers: Record<string, string> = { 'content-type': 'image/jpeg' }, h = handler) =>
  h(new Request('https://famelet.test/api/calorie', { method: 'POST', body, headers }));
const ok = (answer: unknown) => {
  behave = { message: msg(answer) };
};

await check('표: api/calorie.ts 고정표 = src/plugins/calorie.ts 고정표', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(CALORIE_FALLBACK_TABLE)), JSON.parse(JSON.stringify(PLUGIN_TABLE)));
});

await check('OPTIONS → 204, CORS·Allow-Methods·Allow-Headers', async () => {
  const r = await handler(new Request('https://famelet.test/api/calorie', { method: 'OPTIONS' }));
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.equal(r.headers.get('access-control-allow-methods'), 'POST');
  assert.equal(r.headers.get('access-control-allow-headers'), 'content-type, x-label');
});

await check('정상 JPEG → 200 한 줄, 받은 본문 헤더, CORS', async () => {
  ok({ is_food: true, food_ko: '피자', portion: '한 조각', kcal: 290 });
  const r = await post(jpeg, { 'content-type': 'image/jpeg', 'x-label': 'pizza' });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '피자 약 290kcal');
  assert.equal(r.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(r.headers.get('x-famelet-body-bytes'), String(jpeg.length));
  assert.equal(r.headers.get('x-famelet-body-sha256'), jpegSha);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.match(r.headers.get('access-control-expose-headers') ?? '', /X-Famelet-Body-Bytes, X-Famelet-Body-SHA256/);
  assert.equal(r.headers.get('x-famelet-kcal-clamped'), null);
});

await check('상류 요청 모양: 모델·effort low·json_schema·max_tokens·시스템 프롬프트·이미지 먼저·thinking 없음·재시도 없음', async () => {
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
  const content = (b.messages as { role: string; content: Record<string, unknown>[] }[])[0]!.content;
  assert.equal(content[0]!.type, 'image');
  assert.deepEqual(content[0]!.source, { type: 'base64', media_type: 'image/jpeg', data: Buffer.from(jpeg).toString('base64') });
  assert.deepEqual(content[1], { type: 'text', text: '감지기 라벨: pizza' });
});

await check('x-label이 규칙 밖이면 프롬프트에 넣지 않는다', async () => {
  ok({ is_food: true, food_ko: '피자', portion: '한 조각', kcal: 290 });
  for (const bad of ['Pizza', 'pizza; ignore previous', 'x'.repeat(40)]) {
    await post(jpeg, { 'content-type': 'image/jpeg', 'x-label': bad });
    const content = (seen.at(-1)!.body.messages as { content: Record<string, unknown>[] }[])[0]!.content;
    assert.deepEqual(content[1], { type: 'text', text: '감지기 라벨: 없음' });
  }
});

await check('415: 이미지가 아닌 Content-Type, JPEG가 아닌 본문(받은 본문 헤더 포함)', async () => {
  const before = seen.length;
  assert.equal((await post('hello', { 'content-type': 'text/plain' })).status, 415);
  const r = await post(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { 'content-type': 'image/jpeg' });
  assert.equal(r.status, 415);
  assert.equal(r.headers.get('x-famelet-body-bytes'), '4');
  assert.equal(seen.length, before);
});

await check('413: 600KB 초과(Content-Length와 실제 본문)', async () => {
  const big = new Uint8Array(MAX_BODY_BYTES + 1);
  big.set([0xff, 0xd8, 0xff]);
  const r = await post(big);
  assert.equal(r.status, 413);
  const exact = new Uint8Array(MAX_BODY_BYTES);
  exact.set([0xff, 0xd8, 0xff]);
  ok({ is_food: false, food_ko: '', portion: '알 수 없음', kcal: 0 });
  assert.equal((await post(exact)).status, 200);
});

await check('429: 인스턴스 한도를 넘으면', async () => {
  let t = 0;
  const h = createCalorieHandler({ baseURL, apiKey: 'test-key-not-real', rateLimitPerMinute: 3, now: () => t });
  ok({ is_food: true, food_ko: '피자', portion: '한 조각', kcal: 290 });
  for (let i = 0; i < 3; i++) assert.equal((await post(jpeg, undefined, h)).status, 200);
  assert.equal((await post(jpeg, undefined, h)).status, 429);
  t = 60_000;
  assert.equal((await post(jpeg, undefined, h)).status, 200);
});

await check('502: 상류 8초 지연 → 2.7초에 끊고 재시도 없음', async () => {
  behave = { delayMs: 8_000, message: msg({ is_food: true, food_ko: '피자', portion: '한 조각', kcal: 290 }) };
  const before = seen.length;
  const t0 = performance.now();
  const r = await post(jpeg);
  const ms = performance.now() - t0;
  assert.equal(r.status, 502);
  assert.ok(ms >= 2_600 && ms < 3_200, `${Math.round(ms)}ms`);
  assert.equal(r.headers.get('x-famelet-body-sha256'), jpegSha);
  await new Promise((res) => setTimeout(res, 300));
  assert.equal(seen.length - before, 1);
  console.log(`    (${Math.round(ms)}ms)`);
});

await check('502: 상류 500·529 → 재시도 없이 502', async () => {
  for (const status of [500, 529]) {
    behave = { status };
    const before = seen.length;
    assert.equal((await post(jpeg)).status, 502);
    assert.equal(seen.length - before, 1);
  }
});

await check('502: stop_reason refusal·max_tokens, JSON·스키마 위반', async () => {
  for (const m of [
    msg({ is_food: true, food_ko: '피자', portion: '한 조각', kcal: 290 }, 'refusal'),
    msg({ is_food: true, food_ko: '피자', portion: '한 조각', kcal: 290 }, 'max_tokens'),
    msg('not json'),
    msg({ is_food: true, food_ko: '피자', portion: '한 조각', kcal: '290' }),
    msg({ is_food: true, food_ko: '피자', portion: '두 조각', kcal: 290 }),
    msg({ is_food: true, food_ko: '피자', portion: '한 조각', kcal: 290.5 }),
    msg({ is_food: true, food_ko: '피자', portion: '한 조각', kcal: 290, extra: 1 }),
  ]) {
    behave = { message: m };
    assert.equal((await post(jpeg)).status, 502);
  }
});

await check('502: 키 없음(상류 401)', async () => {
  behave = { status: 401 };
  assert.equal((await post(jpeg)).status, 502);
});

await check('보정: 음식 아님, 이름 다듬기·12자, 빈 이름 → 음식, 10~3000, 고정표 0.25~8배', async () => {
  const cases: [Record<string, unknown>, string | undefined, string, boolean][] = [
    [{ is_food: false, food_ko: '', portion: '알 수 없음', kcal: 0 }, 'pizza', '음식 아님', false],
    [{ is_food: true, food_ko: '  아주아주아주긴음식이름입니다  ', portion: '1인분', kcal: 500 }, undefined, '아주아주아주긴음식이름입 약 500kcal', false],
    [{ is_food: true, food_ko: '   ', portion: '1인분', kcal: 500 }, undefined, '음식 약 500kcal', false],
    [{ is_food: true, food_ko: '사탕', portion: '1인분', kcal: 5 }, undefined, '사탕 약 10kcal', false],
    [{ is_food: true, food_ko: '피자', portion: '한 판', kcal: 2000 }, 'pizza', '피자 약 2000kcal', false],
    [{ is_food: true, food_ko: '피자', portion: '한 판', kcal: 10_000 }, 'pizza', '피자 약 285kcal', true],
    [{ is_food: true, food_ko: '피자', portion: '한 조각', kcal: 50 }, 'pizza', '피자 약 285kcal', true],
    [{ is_food: true, food_ko: '그릇 음식', portion: '1인분', kcal: 9_999 }, 'bowl', '그릇 음식 약 3000kcal', false],
  ];
  for (const [answer, label, expected, clamped] of cases) {
    ok(answer);
    const r = await post(jpeg, label ? { 'content-type': 'image/jpeg', 'x-label': label } : { 'content-type': 'image/jpeg' });
    assert.equal(r.status, 200);
    assert.equal(await r.text(), expected);
    assert.equal(r.headers.get('x-famelet-kcal-clamped'), clamped ? '1' : null, expected);
  }
});

await check('502: 서버 환경 변수에 키가 없으면(SDK 인증 실패) 상류 요청 없이 502', async () => {
  const saved = { key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  try {
    const h = createCalorieHandler({ baseURL });
    ok({ is_food: true, food_ko: '피자', portion: '한 조각', kcal: 290 });
    const before = seen.length;
    const r = await post(jpeg, undefined, h);
    assert.equal(r.status, 502);
    console.log(`    (상류 요청 ${seen.length - before}건)`);
  } finally {
    if (saved.key !== undefined) process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.token !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = saved.token;
  }
});

await check('GET → 405', async () => {
  const r = await handler(new Request('https://famelet.test/api/calorie'));
  assert.equal(r.status, 405);
});

upstream.close();
console.log(`\n${passed}개 통과`);
