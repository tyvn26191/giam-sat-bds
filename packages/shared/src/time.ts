// Display helpers. The database stores UTC timestamps; the UI shows Asia/Tokyo by default.

export const DEFAULT_TIMEZONE = 'Asia/Tokyo';
export const TIMEZONES = ['Asia/Tokyo', 'Asia/Ho_Chi_Minh', 'UTC'] as const;
export type TimeZoneId = (typeof TIMEZONES)[number];

const cache = new Map<string, Intl.DateTimeFormat>();

function parts(ms: number, tz: string): Record<string, string> {
  let f = cache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    cache.set(tz, f);
  }
  const out: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(ms))) out[p.type] = p.value;
  return out;
}

/** "2026/10/08 06:15" */
export function formatDateTime(ms: number | null | undefined, tz: string = DEFAULT_TIMEZONE): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const p = parts(ms, tz);
  return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

/** "2026/10/08" */
export function formatDate(ms: number | null | undefined, tz: string = DEFAULT_TIMEZONE): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const p = parts(ms, tz);
  return `${p.year}/${p.month}/${p.day}`;
}

/** "10/08" */
export function formatMonthDay(ms: number, tz: string = DEFAULT_TIMEZONE): string {
  const p = parts(ms, tz);
  return `${p.month}/${p.day}`;
}

/** "06:15" */
export function formatTime(ms: number | null | undefined, tz: string = DEFAULT_TIMEZONE): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const p = parts(ms, tz);
  return `${p.hour}:${p.minute}`;
}

/** Short relative time in Vietnamese: "vừa xong", "5 phút trước", "3 giờ trước", "2 ngày trước". */
export function formatRelativeVi(ms: number | null | undefined, now: number): string {
  if (ms == null) return '—';
  const diff = Math.round((now - ms) / 1000);
  if (diff < 0) {
    const ahead = -diff;
    if (ahead < 60) return 'trong giây lát';
    if (ahead < 3600) return `sau ${Math.round(ahead / 60)} phút`;
    return `sau ${Math.round(ahead / 3600)} giờ`;
  }
  if (diff < 45) return 'vừa xong';
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))} phút trước`;
  if (diff < 86400) return `${Math.round(diff / 3600)} giờ trước`;
  return `${Math.round(diff / 86400)} ngày trước`;
}
