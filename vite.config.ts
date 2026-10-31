import type { ServerResponse } from 'node:http';
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** 개발 서버에서 여는 Vercel 함수(경로 → 파일). */
const DEV_API_ROUTES = { '/api/calorie': '/api/calorie.ts', '/api/outfit': '/api/outfit.ts' } as const;

/**
 * 개발 서버에서만 /api/calorie·/api/outfit을 같은 함수(api/*.ts)로 연다. 배포에서는 Vercel 함수가 같은 파일을 쓴다.
 * Vite 7은 CORS 미들웨어를 플러그인 미들웨어보다 먼저 붙여 Origin null 사전 요청에 직접 답한다(허용 안 함).
 * 그래서 이 경로 하나만 스택 맨 앞에 넣어 함수의 CORS가 답하게 한다. 다른 경로의 CORS는 그대로다.
 * 키는 .env.local 등에서 서버 쪽 process.env로만 읽는다(VITE_ 접두어가 아니라 클라이언트에 실리지 않는다).
 */
function devApi(): Plugin {
  return {
    name: 'framelet-dev-api',
    apply: 'serve',
    configureServer(server) {
      const handler = (route: string, file: string) => (req: Connect.IncomingMessage, res: ServerResponse) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', async () => {
          try {
            const { POST, OPTIONS } = (await server.ssrLoadModule(file)) as typeof import('./api/calorie');
            const headers = new Headers();
            for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
            const method = req.method ?? 'GET';
            const request = new Request(`http://localhost${req.originalUrl ?? route}`, {
              method,
              headers,
              body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks),
            });
            const response =
              method === 'POST' ? await POST(request) : method === 'OPTIONS' ? OPTIONS() : new Response(null, { status: 405 });
            res.statusCode = response.status;
            response.headers.forEach((v, k) => res.setHeader(k, v));
            res.end(Buffer.from(await response.arrayBuffer()));
          } catch (err) {
            server.config.logger.error(`[dev api ${route}] ${(err as Error).message}`);
            res.statusCode = 500;
            res.end();
          }
        });
      };
      for (const [route, file] of Object.entries(DEV_API_ROUTES)) server.middlewares.stack.unshift({ route, handle: handler(route, file) });
    },
  };
}

export default defineConfig(({ mode }) => {
  // 서버 쪽에서만 쓰는 값. 이미 셸에 있으면 그대로 둔다.
  for (const [k, v] of Object.entries(loadEnv(mode, process.cwd(), ['ANTHROPIC_', 'CALORIE_', 'GEMINI_', 'OUTFIT_']))) process.env[k] ??= v;
  return {
    plugins: [react(), devApi()],
    server: { host: true },
  };
});
