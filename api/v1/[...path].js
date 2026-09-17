import { createServer } from '../../src/server.js';
import { loadConfig } from '../../src/config.js';
import { createMemoryStore } from '../../src/store/memory.js';

const config = loadConfig();
const store = createMemoryStore();
const server = createServer({ config, store });
const requestListener = server.listeners('request')[0];

export default async function handler(req, res) {
  try {
    if (typeof requestListener !== 'function') {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'request listener not found' }));
      return;
    }
    req.url = String(req.url || '').replace(/^\/api/, '') || '/';
    return await requestListener(req, res);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: err.message, stack: err.stack }));
  }
}
