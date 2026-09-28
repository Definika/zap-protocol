type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min = order[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? 20;

const out = (level: Level, scope: string, msg: string, extra?: unknown) => {
  if (order[level] < min) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  const tail = extra === undefined ? '' : ` ${extra instanceof Error ? extra.stack ?? extra.message : JSON.stringify(extra, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`;
  (level === 'error' || level === 'warn' ? console.error : console.log)(line + tail);
};

export const logger = (scope: string) => ({
  debug: (m: string, x?: unknown) => out('debug', scope, m, x),
  info: (m: string, x?: unknown) => out('info', scope, m, x),
  warn: (m: string, x?: unknown) => out('warn', scope, m, x),
  error: (m: string, x?: unknown) => out('error', scope, m, x),
});
