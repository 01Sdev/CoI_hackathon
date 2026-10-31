// V5 실측: 피자 JPEG(긴 변 256px)를 /api/calorie와 같은 인자로 모델에 N번 보내 응답 시간(p50·p95)·토큰·비용을 잰다.
// 실행: ANTHROPIC_API_KEY가 서버 쪽 환경 변수에 있을 때만. 키 값은 출력하지 않는다.
//   npx tsx scripts/measure-calorie.ts <피자.jpg> [횟수=10] [x-label=pizza]
// 시간 제한·재시도는 함수와 같다(2.7초, 재시도 없음). 시간 초과도 한 번으로 센다.

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { DEFAULT_MODEL, UPSTREAM_TIMEOUT_MS, answerFromMessage, calorieRequest } from '../api/calorie';

/** Haiku 5.5 단가(USD / 100만 토큰, 10만 토큰 이하 프롬프트). 02-SSRD "서버의 모델 호출". */
const PRICE = { input: 0.1, output: 0.5 };

const [path, countArg, labelArg] = process.argv.slice(2);
if (!process.env.ANTHROPIC_API_KEY) {
  console.log('ANTHROPIC_API_KEY가 없어 V5를 건너뜁니다(키는 서버 환경 변수로만 둔다).');
  process.exit(0);
}
if (!path) {
  console.error('사용법: npx tsx scripts/measure-calorie.ts <피자.jpg> [횟수=10] [x-label=pizza]');
  process.exit(1);
}
const body = new Uint8Array(readFileSync(path));
const count = Number(countArg ?? 10);
const label = labelArg ?? 'pizza';
const model = process.env.CALORIE_MODEL ?? DEFAULT_MODEL;
const client = new Anthropic({ timeout: UPSTREAM_TIMEOUT_MS, maxRetries: 0 });

const rows: { ms: number; ok: boolean; text: string; input: number; output: number }[] = [];
for (let i = 0; i < count; i++) {
  const t0 = performance.now();
  try {
    const m = await client.messages.create(calorieRequest(body, label, model));
    const ms = performance.now() - t0;
    const out = answerFromMessage(m, label);
    rows.push({ ms, ok: !!out, text: out?.text ?? `502(${m.stop_reason})`, input: m.usage.input_tokens, output: m.usage.output_tokens });
  } catch (err) {
    rows.push({ ms: performance.now() - t0, ok: false, text: `502(${(err as Error).constructor.name})`, input: 0, output: 0 });
  }
  console.log(`${i + 1}\t${Math.round(rows.at(-1)!.ms)}ms\t${rows.at(-1)!.text}\tin ${rows.at(-1)!.input} / out ${rows.at(-1)!.output}`);
}
const sorted = rows.map((r) => r.ms).sort((a, b) => a - b);
const pct = (p: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!);
const inTok = rows.reduce((a, r) => a + r.input, 0);
const outTok = rows.reduce((a, r) => a + r.output, 0);
const usd = (inTok * PRICE.input + outTok * PRICE.output) / 1e6;
console.log(
  `\n${model} · ${body.length}B · ${count}회 · 성공 ${rows.filter((r) => r.ok).length} · p50 ${pct(50)}ms · p95 ${pct(95)}ms · ` +
    `3초 안 ${rows.filter((r) => r.ok && r.ms < 3_000).length}회 · 토큰 평균 in ${Math.round(inTok / count)} / out ${Math.round(outTok / count)} · ` +
    `합계 $${usd.toFixed(5)}(호출당 $${(usd / count).toFixed(6)})`,
);
