import { createRequestHandler } from '../src/http_server.js';
import { loadConfig } from '../src/config.js';
import { createMemoryStore } from '../src/store/memory.js';

const config = loadConfig();
const store = createMemoryStore();
const requestListener = createRequestHandler({ config, store });

export default async function handler(req, res) {
  try {
    const parsed = new URL(req.url || '/', 'http://localhost');
    const originalPath = parsed.searchParams.get('__path') || '';
    parsed.searchParams.delete('__path');
    req.url = `/v1/${originalPath}${parsed.search ? `?${parsed.searchParams.toString()}` : ''}`;
    return await requestListener(req, res);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: err.message, stack: err.stack }));
  }
}
