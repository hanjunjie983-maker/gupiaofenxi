import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 集成回归：先跑网络抓取，再跑 PostgreSQL smoke。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const node = process.execPath;

function run(script) {
  const p = path.resolve(__dirname, script);
  console.log(`\n=== ${script} ===`);
  try {
    execFileSync(node, [p], { stdio: 'inherit' });
  } catch (err) {
    console.error(`${script} failed`);
    process.exitCode = 1;
  }
}

run('fetch_edgar_real.js');
run('smoke_postgres.js');
