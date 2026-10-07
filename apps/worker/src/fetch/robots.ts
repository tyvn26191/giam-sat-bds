// robots.txt (RFC 9309): we fetch it once per host per 24 h and never request a disallowed path.
// 4xx = no restrictions, 5xx / unreachable = assume disallowed for now (retry later).

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsPolicy {
  rules: RobotsRule[];
  crawlDelayMs: number | null;
  status: 'OK' | 'NONE';
  fetchedAt: number;
}

export function parseRobots(txt: string, agentToken: string, fetchedAt = 0): RobotsPolicy {
  const token = agentToken.toLowerCase();
  type Group = { agents: string[]; rules: RobotsRule[]; delay: number | null };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], delay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if ((key === 'allow' || key === 'disallow') && value) {
      if (current.rules.length < 1000) current.rules.push({ allow: key === 'allow', pattern: value });
    } else if (key === 'crawl-delay') {
      const d = parseFloat(value);
      if (Number.isFinite(d) && d >= 0) current.delay = Math.min(60_000, Math.round(d * 1000));
    }
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && a === token));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return {
    rules: chosen.flatMap((g) => g.rules),
    crawlDelayMs: chosen.map((g) => g.delay).find((d) => d !== null) ?? null,
    status: 'OK',
    fetchedAt,
  };
}

function toRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

export function isAllowed(policy: RobotsPolicy, pathAndQuery: string): boolean {
  if (policy.status === 'NONE' || pathAndQuery === '/robots.txt') return true;
  let best: RobotsRule | null = null;
  for (const rule of policy.rules) {
    let decoded = pathAndQuery;
    try {
      decoded = decodeURI(pathAndQuery);
    } catch {
      // keep raw
    }
    const re = toRegex(rule.pattern);
    if (!re.test(pathAndQuery) && !re.test(decoded)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

export class RobotsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RobotsUnavailableError';
  }
}

export interface RobotsDeps {
  agentToken: string;
  now: () => number;
  fetchText: (url: string) => Promise<{ status: number; body: string }>;
  load?: (host: string) => Promise<RobotsPolicy | null>;
  save?: (host: string, policy: RobotsPolicy) => Promise<void>;
  ttlMs?: number;
}

export interface RobotsDecision {
  allowed: boolean;
  crawlDelayMs: number | null;
}

export class RobotsChecker {
  private readonly mem = new Map<string, RobotsPolicy>();
  private readonly inflight = new Map<string, Promise<RobotsPolicy>>();
  private readonly ttl: number;

  constructor(private readonly deps: RobotsDeps) {
    this.ttl = deps.ttlMs ?? 24 * 3600_000;
  }

  private fresh(p: RobotsPolicy | null | undefined): p is RobotsPolicy {
    return !!p && this.deps.now() - p.fetchedAt < this.ttl;
  }

  async policy(origin: string): Promise<RobotsPolicy> {
    const cached = this.mem.get(origin);
    if (this.fresh(cached)) return cached;
    let pending = this.inflight.get(origin);
    if (!pending) {
      pending = this.load(origin, cached ?? null).finally(() => this.inflight.delete(origin));
      this.inflight.set(origin, pending);
    }
    return pending;
  }

  private async load(origin: string, stale: RobotsPolicy | null): Promise<RobotsPolicy> {
    const host = new URL(origin).host;
    const stored = (await this.deps.load?.(host).catch(() => null)) ?? null;
    if (this.fresh(stored)) {
      this.mem.set(origin, stored);
      return stored;
    }
    const now = this.deps.now();
    let policy: RobotsPolicy;
    try {
      const r = await this.deps.fetchText(`${origin}/robots.txt`);
      if (r.status >= 200 && r.status < 300) policy = parseRobots(r.body, this.deps.agentToken, now);
      else if (r.status >= 400 && r.status < 500 && r.status !== 429) policy = { rules: [], crawlDelayMs: null, status: 'NONE', fetchedAt: now };
      else throw new RobotsUnavailableError(`robots.txt HTTP ${r.status}`);
    } catch (e) {
      const fallback = stale ?? stored;
      if (fallback) return fallback;
      throw e instanceof RobotsUnavailableError ? e : new RobotsUnavailableError(`robots.txt: ${(e as Error).message}`);
    }
    this.mem.set(origin, policy);
    await this.deps.save?.(host, policy).catch(() => undefined);
    return policy;
  }

  async check(url: URL): Promise<RobotsDecision> {
    const policy = await this.policy(url.origin);
    return { allowed: isAllowed(policy, `${url.pathname}${url.search}`), crawlDelayMs: policy.crawlDelayMs };
  }
}
