// Politeness: a global concurrency cap, a per-host concurrency cap and a minimum spacing
// (+ random jitter) between two request starts to the same host. robots.txt Crawl-delay raises
// the spacing for that host.

export interface LimiterOptions {
  global: number;
  perHost: number;
  minSpacingMs: number;
  jitterMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  rand?: () => number;
}

class Semaphore {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  constructor(private readonly max: number) {}
  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }
  release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.active--;
  }
}

export class HostLimiter {
  private readonly global: Semaphore;
  private readonly hosts = new Map<string, { sem: Semaphore; nextStart: number; spacing: number }>();
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly rand: () => number;

  constructor(private readonly opts: LimiterOptions) {
    this.global = new Semaphore(Math.max(1, opts.global));
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.rand = opts.rand ?? Math.random;
  }

  private host(host: string) {
    let h = this.hosts.get(host);
    if (!h) {
      h = { sem: new Semaphore(Math.max(1, this.opts.perHost)), nextStart: 0, spacing: this.opts.minSpacingMs };
      this.hosts.set(host, h);
    }
    return h;
  }

  /** Raise (never lower) the spacing for a host, e.g. from robots.txt Crawl-delay. */
  setMinSpacing(host: string, ms: number): void {
    const h = this.host(host);
    h.spacing = Math.max(this.opts.minSpacingMs, Math.min(ms, 60_000));
  }

  async run<T>(host: string, fn: () => Promise<T>): Promise<T> {
    const h = this.host(host);
    await h.sem.acquire();
    try {
      // Reserve a start slot for this host before waiting, so parallel callers queue up.
      const start = Math.max(this.now(), h.nextStart);
      h.nextStart = start + h.spacing + Math.round(this.rand() * this.opts.jitterMs);
      const wait = start - this.now();
      if (wait > 0) await this.sleep(wait);
      await this.global.acquire();
      try {
        return await fn();
      } finally {
        this.global.release();
      }
    } finally {
      h.sem.release();
    }
  }
}

/** Run tasks with at most `limit` in flight; stops starting new ones when `shouldStop()` is true. */
export async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>, shouldStop: () => boolean = () => false): Promise<number> {
  let index = 0;
  let started = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (index < items.length && !shouldStop()) {
      const item = items[index++]!;
      started++;
      await worker(item);
    }
  });
  await Promise.all(runners);
  return started;
}
