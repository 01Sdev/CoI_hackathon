// src/boot assertion 스크립트(호스트 외부 요청 가드). 실행: npm run check:boot
// 가짜 window로 fetch·XHR·sendBeacon을 감싼 결과만 확인한다. 실제 브라우저 확인은 PROGRESS V15.

import assert from 'node:assert/strict';
import { installHostRequestGuard, isAllowedHostRequest, type GuardTarget } from '../src/boot/guard';

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed += 1;
  console.log(`ok  ${name}`);
}

const ORIGIN = 'https://app.test';
const LOG_URL = 'https://odml.pa.googleapis.com/v1/log';

/** 원래 함수가 불렸는지 기록하는 가짜 window. */
function fakeWindow() {
  const calls: string[] = [];
  class FakeXhr extends EventTarget {
    url = '';
    open(_method: string, url: string) {
      this.url = url;
    }
    send() {
      calls.push(`xhr ${this.url}`);
    }
  }
  const w = {
    location: { origin: ORIGIN },
    fetch: (async (input: RequestInfo | URL) => {
      calls.push(`fetch ${String(input)}`);
      return new Response('ok');
    }) as typeof fetch,
    XMLHttpRequest: FakeXhr as unknown as typeof XMLHttpRequest,
    navigator: {
      sendBeacon: (url: string | URL, _data?: BodyInit | null) => {
        calls.push(`beacon ${String(url)}`);
        return true;
      },
    },
  } satisfies GuardTarget;
  const warns: unknown[][] = [];
  const handle = installHostRequestGuard(w, (...a) => warns.push(a));
  return { w, calls, warns, handle, FakeXhr };
}

await check('허용 판단: 같은 origin·상대 경로·blob·data만 통과', () => {
  for (const ok of ['/models/efficientdet_lite0.tflite', 'wasm/x.wasm', `${ORIGIN}/api/calorie`, `blob:${ORIGIN}/abc`, 'data:,x']) {
    assert.equal(isAllowedHostRequest(ok, ORIGIN), true, ok);
  }
  for (const bad of [LOG_URL, '//evil.test/x', 'http://app.test/x', 'https://app.test:8443/x', 'http://[']) {
    assert.equal(isAllowedHostRequest(bad, ORIGIN), false, bad);
  }
});

await check('fetch: 외부 주소는 원래 fetch를 부르지 않고 거부, 같은 origin은 그대로', async () => {
  const { w, calls, handle } = fakeWindow();
  await assert.rejects(w.fetch(LOG_URL, { method: 'POST' }), TypeError);
  await assert.rejects(w.fetch(new URL(LOG_URL)), TypeError);
  assert.deepEqual(calls, []);
  const res = await w.fetch('/models/a.tflite');
  assert.equal(await res.text(), 'ok');
  assert.deepEqual(calls, ['fetch /models/a.tflite']);
  assert.equal(handle.blocked(), 2);
});

await check('XHR: 외부 주소는 send하지 않고 error 이벤트, 같은 origin은 그대로', async () => {
  const { w, calls } = fakeWindow();
  const X = w.XMLHttpRequest;
  const bad = new X();
  let errored = 0;
  bad.addEventListener('error', () => (errored += 1));
  bad.open('POST', LOG_URL);
  bad.send('x');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(errored, 1);
  const good = new X();
  good.open('GET', '/wasm/a.wasm');
  good.send();
  assert.deepEqual(calls, ['xhr /wasm/a.wasm']);
});

await check('sendBeacon: 외부 주소는 false, 같은 origin은 그대로', () => {
  const { w, calls } = fakeWindow();
  assert.equal(w.navigator.sendBeacon(LOG_URL, 'x'), false);
  assert.equal(w.navigator.sendBeacon('/api/x'), true);
  assert.deepEqual(calls, ['beacon /api/x']);
});

await check('경고는 종류·대상마다 한 번, 두 번 걸어도 한 번만 감싼다', async () => {
  const { w, warns, handle } = fakeWindow();
  await assert.rejects(w.fetch(LOG_URL));
  await assert.rejects(w.fetch(`${LOG_URL}?again`));
  w.navigator.sendBeacon(LOG_URL);
  assert.equal(warns.length, 2, 'fetch 1 + beacon 1');
  assert.equal(installHostRequestGuard(w), handle);
  await assert.rejects(w.fetch(LOG_URL));
  assert.equal(handle.blocked(), 4);
});

console.log(`\n${passed}개 통과`);
