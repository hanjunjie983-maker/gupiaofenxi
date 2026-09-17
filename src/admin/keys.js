import { createHash, randomBytes } from 'node:crypto';

export function maskKey(key) {
  if (!key || key.length < 8) return '****';
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

export function hashKey(key) {
  return createHash('sha256').update(key).digest('hex');
}

// 生成 API key：仅创建时返回明文，存储只保存哈希。
export function createApiKey(store, { name, scopes = ['read'], expiresInDays = 365 }) {
  const plain = `fk_${randomBytes(24).toString('hex')}`;
  const id = `key_${randomBytes(4).toString('hex')}`;
  const expiresAt = new Date(Date.now() + expiresInDays * 86400000).toISOString();
  const row = store.saveApiKey({
    id,
    name,
    scopes,
    key_hash: hashKey(plain),
    masked: maskKey(plain),
    expires_at: expiresAt,
    revoked: false
  });
  const { key_hash, ...safeRow } = row;
  return { ...safeRow, key: plain };
}

export function listKeys(store) {
  return store.listApiKeys().map(({ key_hash, ...rest }) => rest);
}

export function revokeKey(store, id) {
  const row = store.getApiKey(id);
  if (!row) return null;
  return store.saveApiKey({ ...row, revoked: true });
}

