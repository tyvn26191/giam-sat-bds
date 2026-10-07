// Check scheduling. Cloud Scheduler ticks every 5 minutes; each property is due when
// nextCheckAt <= now + DUE_TOLERANCE_MS. Jitter is symmetric so the average interval stays
// at the configured value while properties spread over different ticks.

export const INTERVAL_OPTIONS = [15, 30, 60] as const;
export type IntervalMin = (typeof INTERVAL_OPTIONS)[number];
export const DEFAULT_INTERVAL_MIN: IntervalMin = 15;

export const TICK_MINUTES = 5;
export const DUE_TOLERANCE_MS = 2.5 * 60_000;

/** Retry delays after technical failures: 30 s (inline), 2 min, 10 min, then status ERROR. */
export const RETRY_DELAYS_MS = [30_000, 120_000, 600_000] as const;
export const MAX_BACKOFF_MS = 6 * 3600_000;

export function isValidInterval(n: unknown): n is IntervalMin {
  return INTERVAL_OPTIONS.includes(n as IntervalMin);
}

export function jitterMs(intervalMin: number, rand: () => number = Math.random): number {
  const max = Math.min(90_000, intervalMin * 60_000 * 0.1);
  return Math.round((rand() * 2 - 1) * max);
}

export function nextCheckTime(now: number, intervalMin: number, rand: () => number = Math.random): number {
  return now + intervalMin * 60_000 + jitterMs(intervalMin, rand);
}

/** Interval × 2^steps, capped. Used for ERROR / BLOCKED / REMOVED so broken pages are polled less. */
export function backoffTime(now: number, intervalMin: number, steps: number, floorMs = 0): number {
  const base = Math.max(intervalMin * 60_000, floorMs);
  return now + Math.min(MAX_BACKOFF_MS, base * 2 ** Math.max(0, steps));
}
