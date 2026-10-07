// Batch runs: the scheduled tick (all due properties) and "Run check now" for one user.

import { DUE_TOLERANCE_MS, jitterMs, type MonitorRun, type RunNowResponse } from '@gsb/shared';
import { HostLimiter, pool } from '../rate-limit';
import type { PropertyRecord } from '../store/types';
import { runCheck, type EngineDeps } from './check';

export interface RunnerConfig {
  budgetMs: number;
  maxPerRun: number;
  lockTtlMs: number;
  minSpacingMs: number;
  jitterMs: number;
}

export type RunDueResult =
  | { status: 'idle' | 'busy' | 'paused'; due: number }
  | ({ status: 'done'; id: string; remaining: number } & MonitorRun);

/** Round-robin by host so one slow/limited site does not starve the others. */
export function interleaveByHost(items: PropertyRecord[]): PropertyRecord[] {
  const groups = new Map<string, PropertyRecord[]>();
  for (const it of items) {
    const g = groups.get(it.data.host) ?? [];
    g.push(it);
    groups.set(it.data.host, g);
  }
  const out: PropertyRecord[] = [];
  const lists = [...groups.values()];
  for (let i = 0; out.length < items.length; i++) for (const l of lists) if (l[i]) out.push(l[i]!);
  return out;
}

export async function runDue(deps: EngineDeps, cfg: RunnerConfig): Promise<RunDueResult> {
  const startedAt = deps.now();
  const due = await deps.store.queryDue(startedAt + DUE_TOLERANCE_MS, cfg.maxPerRun);
  if (due.length === 0) return { status: 'idle', due: 0 };

  const runId = `run_${new Date(startedAt).toISOString().replace(/[-:.TZ]/g, '')}_${Math.floor((deps.rand ?? Math.random)() * 1e6)}`;
  if (!(await deps.store.acquireLock('runDue', runId, cfg.lockTtlMs, startedAt))) return { status: 'busy', due: due.length };

  try {
    const sys = await deps.store.getSystemConfig();
    if (sys.paused) return { status: 'paused', due: due.length };
    const limiter = new HostLimiter({
      global: sys.maxConcurrentChecks,
      perHost: sys.perDomainConcurrency,
      minSpacingMs: cfg.minSpacingMs,
      jitterMs: cfg.jitterMs,
      now: deps.now,
      sleep: deps.sleep,
      rand: deps.rand,
    });
    const runDeps: EngineDeps = { ...deps, limiter };
    const deadline = startedAt + cfg.budgetMs;

    const cooldown = new Map<string, number>();
    for (const host of new Set(due.map((d) => d.data.host))) {
      const st = await deps.store.getDomainState(host).catch(() => null);
      if (st?.cooldownUntil && st.cooldownUntil > startedAt) cooldown.set(host, st.cooldownUntil);
    }

    const userCache = new Map();
    const stats = { processed: 0, changed: 0, errors: 0, skipped: 0, notifications: 0 };
    const ordered = interleaveByHost(due);
    const started = await pool(
      ordered,
      Math.max(1, sys.maxConcurrentChecks),
      async (rec) => {
        const until = cooldown.get(rec.data.host);
        if (until && until > deps.now()) {
          await deps.store.updateProperty(rec.id, { nextCheckAt: until + Math.abs(jitterMs(rec.data.intervalMin, deps.rand)) }).catch(() => undefined);
          stats.skipped++;
          return;
        }
        try {
          const s = await runCheck(rec, runDeps, { trigger: 'SCHEDULER', runId, inlineRetry: true, deadline, userCache });
          if (s.outcome === 'SKIPPED') stats.skipped++;
          else stats.processed++;
          if (s.changed) stats.changed++;
          if (s.outcome === 'ERROR') stats.errors++;
          if (s.notificationSent) stats.notifications++;
          if (s.error?.code === 'HTTP_429') {
            const cool = deps.now() + 30 * 60_000;
            cooldown.set(rec.data.host, cool);
            await deps.store.setDomainState(rec.data.host, { cooldownUntil: cool }).catch(() => undefined);
          }
        } catch (e) {
          stats.errors++;
          deps.log.error('check crashed', { propertyId: rec.id, error: (e as Error).message });
        }
      },
      () => deps.now() > deadline - 20_000,
    );

    stats.notifications += await deps.notifier.retryFailed().catch(() => 0);
    const finishedAt = deps.now();
    const run: MonitorRun = {
      trigger: 'SCHEDULER',
      ownerId: null,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      due: due.length,
      ...stats,
      expireAt: finishedAt + deps.config.logRetentionDays * 86400_000,
    };
    await deps.store.addMonitorRun(runId, run).catch(() => undefined);
    deps.log.info('run finished', { runId, ...stats, due: due.length, remaining: due.length - started, ms: run.durationMs });
    return { status: 'done', id: runId, remaining: due.length - started, ...run };
  } finally {
    await deps.store.releaseLock('runDue', runId).catch(() => undefined);
  }
}

/** "Run check now" for one user: check what fits in the time budget, queue the rest. */
export async function runForOwner(deps: EngineDeps, ownerId: string, budgetMs: number): Promise<RunNowResponse> {
  const startedAt = deps.now();
  const deadline = startedAt + budgetMs;
  const all = (await deps.store.queryByOwner(ownerId)).filter((r) => r.data.enabled);
  all.sort((a, b) => (a.data.lastCheckedAt ?? 0) - (b.data.lastCheckedAt ?? 0));
  const runId = `now_${startedAt}`;
  const userCache = new Map();
  const res: RunNowResponse = { processed: 0, changed: 0, errors: 0, remaining: 0 };
  const done = new Set<string>();
  await pool(
    interleaveByHost(all),
    3,
    async (rec) => {
      const s = await runCheck(rec, deps, { trigger: 'RUN_NOW', runId, inlineRetry: false, deadline, userCache }).catch(() => null);
      done.add(rec.id);
      if (!s) {
        res.errors++;
        return;
      }
      res.processed++;
      if (s.changed) res.changed++;
      if (s.outcome === 'ERROR') res.errors++;
    },
    () => deps.now() > deadline - 12_000,
  );
  // Whatever did not fit is picked up by the next scheduler tick (≤ 5 minutes).
  for (const rec of all) {
    if (done.has(rec.id)) continue;
    res.remaining++;
    await deps.store.updateProperty(rec.id, { nextCheckAt: deps.now() }).catch(() => undefined);
  }
  return res;
}
