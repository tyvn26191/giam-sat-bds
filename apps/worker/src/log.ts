// Structured logs: one JSON object per line on Cloud Run (picked up by Cloud Logging with
// severity), readable text locally. Never log HTML bodies or secrets.

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export function createLogger(json: boolean, minLevel: 'debug' | 'info' = 'info'): Logger {
  const levels = { debug: 0, info: 1, warn: 2, error: 3 } as const;
  const write = (level: keyof typeof levels, message: string, fields?: LogFields) => {
    if (levels[level] < levels[minLevel]) return;
    if (json) {
      process.stdout.write(`${JSON.stringify({ severity: level.toUpperCase(), message, ...fields })}\n`);
    } else {
      const extra = fields && Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : '';
      (level === 'error' ? console.error : console.log)(`[${level}] ${message}${extra}`);
    }
  };
  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
  };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
