// URL validation against SSRF. This is the synchronous part (scheme, host, literal IPs);
// the worker additionally resolves DNS and checks every resolved address with isPrivateIp()
// right before connecting (and on every redirect hop).

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

export const MAX_URL_LENGTH = 2048;

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'kubernetes',
  'kubernetes.default',
]);

const BLOCKED_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.intranet',
  '.lan',
  '.home',
  '.corp',
  '.private',
  '.localdomain',
  '.home.arpa',
  '.test',
  '.invalid',
  '.example',
  '.onion',
  '.goog',
  '.cluster.local',
];

// Query parameters that only track the visitor; removed when storing a URL.
const TRACKING_PARAMS = /^(utm_[a-z]+|gclid|fbclid|yclid|msclkid|_ga|_gl|mc_cid|mc_eid|ref_src|igshid)$/i;

export function validatePublicUrl(raw: string): UrlCheck {
  const input = (raw ?? '').trim();
  if (!input) return { ok: false, reason: 'URL trống' };
  if (input.length > MAX_URL_LENGTH) return { ok: false, reason: 'URL quá dài' };
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: 'URL không hợp lệ' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'Chỉ hỗ trợ http/https' };
  if (url.username || url.password) return { ok: false, reason: 'URL không được chứa thông tin đăng nhập' };
  if (url.port && url.port !== '80' && url.port !== '443') return { ok: false, reason: 'Chỉ cho phép cổng 80/443' };

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return { ok: false, reason: 'Thiếu tên miền' };

  if (host.startsWith('[') || /^[\d.]+$/.test(host) || host.includes(':')) {
    const ip = host.replace(/^\[|\]$/g, '');
    if (isPrivateIp(ip)) return { ok: false, reason: 'Không cho phép địa chỉ nội bộ / riêng tư' };
    return { ok: true, url };
  }
  if (BLOCKED_HOSTS.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: 'Không cho phép tên miền nội bộ' };
  }
  const labels = host.split('.');
  if (labels.length < 2) return { ok: false, reason: 'Tên miền phải có dạng example.com' };
  const tld = labels[labels.length - 1]!;
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld)) return { ok: false, reason: 'Tên miền không hợp lệ' };
  if (labels.some((l) => !/^(?!-)[a-z0-9-_]{1,63}(?<!-)$/.test(l) && !/^xn--/.test(l))) {
    return { ok: false, reason: 'Tên miền không hợp lệ' };
  }
  return { ok: true, url };
}

/** Canonical form for storage: no fragment, no tracking parameters. */
export function normalizeUrl(url: URL | string): string {
  const u = new URL(url.toString());
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  return u.toString();
}

// ---------- IP classification ----------

export function parseIPv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const parts = m.slice(1).map((x) => parseInt(x, 10));
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

/** Parse an IPv6 address into 8 16-bit groups. Zone ids (%eth0) are ignored. */
export function parseIPv6(input: string): number[] | null {
  let s = input.replace(/^\[|\]$/g, '').replace(/%.*$/, '').toLowerCase();
  if (!s.includes(':')) return null;
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(':');
  const lastPart = s.slice(lastColon + 1);
  if (lastPart.includes('.')) {
    // Embedded IPv4 (::ffff:1.2.3.4): convert to two groups, keep the "::" if it precedes it.
    const v4 = parseIPv4(lastPart);
    if (!v4) return null;
    tail = [(v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!];
    s = s.slice(0, lastColon + 1);
    if (!s.endsWith('::')) s = s.slice(0, -1);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === '' ? [] : part.split(':'));
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  const groups: number[] = [];
  for (const g of [...head, ...rest]) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
  }
  const total = head.length + rest.length + tail.length;
  if (halves.length === 1 && total !== 8) return null;
  if (halves.length === 2 && total > 7) return null;
  groups.push(...head.map((g) => parseInt(g, 16)));
  if (halves.length === 2) for (let i = 0; i < 8 - total; i++) groups.push(0);
  groups.push(...rest.map((g) => parseInt(g, 16)), ...tail);
  return groups.length === 8 ? groups : null;
}

function isPrivateV4(p: number[]): boolean {
  const [a, b, c] = p as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function v4FromGroups(hi: number, lo: number): number[] {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
}

function isPrivateV6(g: number[]): boolean {
  const zeroUntil = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (g.every((x) => x === 0)) return true; // ::
  if (zeroUntil(7) && g[7] === 1) return true; // ::1
  if (zeroUntil(5) && g[5] === 0xffff) return isPrivateV4(v4FromGroups(g[6]!, g[7]!)); // ::ffff:a.b.c.d
  if (zeroUntil(6)) return true; // deprecated IPv4-compatible
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    if (g.slice(2, 6).every((x) => x === 0)) return isPrivateV4(v4FromGroups(g[6]!, g[7]!)); // NAT64
    return true;
  }
  if (g[0] === 0x2002) return isPrivateV4(v4FromGroups(g[1]!, g[2]!)); // 6to4
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return true; // Teredo, documentation
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard
  const first = g[0]!;
  if ((first & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
  if ((first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0) return true; // link/site local
  if ((first & 0xff00) === 0xff00) return true; // multicast
  return (first & 0xe000) !== 0x2000; // only global unicast 2000::/3 is public
}

/** True for loopback, private, link-local, CGNAT, metadata, multicast, reserved… (and unparsable input). */
export function isPrivateIp(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return isPrivateV4(v4);
  const v6 = parseIPv6(ip);
  if (v6) return isPrivateV6(v6);
  return true;
}
