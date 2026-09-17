// 结构化 JSON 日志。避免把请求体/密钥写入日志。
export function log(level, message, fields = {}) {
  if (process.env.LOG_LEVEL === 'silent') return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...fields
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const logger = {
  info: (message, fields) => log('info', message, fields),
  warn: (message, fields) => log('warn', message, fields),
  error: (message, fields) => log('error', message, fields)
};

