import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// PostgreSQL smoke test：需要 DATABASE_URL 与 `npm i pg`。
// 无 DATABASE_URL 时跳过；pg 未安装或连接失败时返回非零码。
const url = process.env.DATABASE_URL;
if (!url) {
  console.log('SKIP: DATABASE_URL not set');
  process.exit(0);
}

let pg;
try {
  pg = await import('pg');
} catch {
  console.error('pg is not installed: run `npm i pg`');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(__dirname, '../src/db/schema.sql');
const schema = await readFile(schemaPath, 'utf8');

const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query(schema);
  await client.query(
    `INSERT INTO ingest_runs (source_id, status, rows, source_url, retrieved_at, confidence)
     VALUES ($1, $2, $3, $4, now(), $5)`,
    ['smoke', 'ok', 1, 'smoke://postgres', 0.9]
  );
  const { rows } = await client.query(
    `SELECT source_id, status, rows, confidence FROM ingest_runs WHERE source_id = 'smoke' ORDER BY id DESC LIMIT 1`
  );
  await client.query('ROLLBACK');
  console.log(JSON.stringify({ ok: true, row: rows[0], note: 'transaction rolled back (no data persisted)' }, null, 2));
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`POSTGRES_SMOKE_FAILED: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
