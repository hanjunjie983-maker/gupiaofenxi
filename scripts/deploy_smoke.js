import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createMemoryStore } from '../src/store/memory.js';

// 部署 smoke：启动进程内服务，验证健康检查、请求 ID、主页与关键 API。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const server = createServer({ config: loadConfig({ PORT: '0' }), store: createMemoryStore() });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

try {
  const live = await fetch(`${base}/health/live`);
  const ready = await fetch(`${base}/health/ready`);
  const home = await fetch(`${base}/`);
  const api = await fetch(`${base}/v1/sources/health`);
  const report = {
    ok: live.status === 200 && ready.status === 200 && home.status === 200 && api.status === 200,
    live: live.status,
    ready: ready.status,
    home: home.status,
    api: api.status,
    request_id_header: live.headers.get('x-request-id') || null,
    dockerfile: existsSync(path.join(root, 'Dockerfile')),
    compose: existsSync(path.join(root, 'docker-compose.yml'))
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok || !report.request_id_header || !report.dockerfile || !report.compose) process.exitCode = 1;
} finally {
  server.close();
}
