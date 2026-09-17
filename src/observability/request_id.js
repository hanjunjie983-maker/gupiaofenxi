import { randomUUID } from 'node:crypto';

export function getRequestId(req) {
  const incoming = req.headers['x-request-id'];
  if (typeof incoming === 'string' && incoming.trim()) return incoming.trim();
  return randomUUID();
}
