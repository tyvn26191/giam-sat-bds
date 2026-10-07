// Fetch failure taxonomy. `transient` errors are retried (30 s inline, then 2 min / 10 min).

export type FetchErrorCode =
  | 'INVALID_URL'
  | 'SSRF_BLOCKED'
  | 'DNS_ERROR'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'TLS_ERROR'
  | 'TOO_LARGE'
  | 'TOO_MANY_REDIRECTS'
  | 'UNSUPPORTED_CONTENT'
  | 'HTTP_ERROR'
  | 'BROWSER_FAILED'
  | 'BROWSER_DISABLED';

const TRANSIENT: ReadonlySet<FetchErrorCode> = new Set(['DNS_ERROR', 'TIMEOUT', 'NETWORK_ERROR', 'BROWSER_FAILED']);

export class FetchError extends Error {
  readonly transient: boolean;
  constructor(readonly code: FetchErrorCode, message: string, transient?: boolean) {
    super(message);
    this.name = 'FetchError';
    this.transient = transient ?? TRANSIENT.has(code);
  }
}

/** Map Node socket / DNS errors to our codes. */
export function classifyNodeError(err: unknown): FetchError {
  if (err instanceof FetchError) return err;
  const e = err as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
  const code = e?.code ?? e?.cause?.code ?? '';
  const msg = (e?.message ?? String(err)).slice(0, 300);
  if (code === 'ESSRF') return new FetchError('SSRF_BLOCKED', msg, false);
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ENODATA') return new FetchError('DNS_ERROR', msg);
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || code === 'ABORT_ERR' || e?.name === 'AbortError' || e?.name === 'TimeoutError') {
    return new FetchError('TIMEOUT', msg);
  }
  if (/^(ERR_TLS|CERT_|UNABLE_TO_VERIFY|DEPTH_ZERO|SELF_SIGNED|ERR_SSL)/.test(code)) return new FetchError('TLS_ERROR', msg, false);
  return new FetchError('NETWORK_ERROR', msg);
}
