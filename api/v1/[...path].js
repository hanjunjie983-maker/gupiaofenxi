import { createServer } from '../../src/server.js';
import { loadConfig } from '../../src/config.js';
import { createMemoryStore } from '../../src/store/memory.js';

// Vercel Serverless adapter: reuse the existing Node HTTP request listener.
const config = loadConfig();
const store = createMemoryStore();
const server = createServer({ config, store });
const requestListener = server.listeners('request')[0];

export default async function handler(req, res) {
  // Vercel receives /api/v1/...; the app internally expects /v1/...
  req.url = String(req.url || '').replace(/^\/api/, '') || '/';
  return requestListener(req, res);
}
