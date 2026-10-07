// Property fingerprint: recognise the same house when it is re-listed under another URL.
// Never relies on price alone; the result is a confidence score, not a yes/no.

export interface FingerprintParts {
  address: string | null;
  cityKey: string | null; // 西尾市 / 名古屋市中区 / 世田谷区
  townKey: string | null; // 寺津町 (address up to the first number)
  prefecture: string | null;
  landArea: number | null; // m²
  buildingArea: number | null;
  floorArea: number | null;
  layout: string | null; // 4LDK
  projectName: string | null;
  unitNumber: string | null; // "1" for 1号棟
  propertyCode: string | null; // SITE:code
  seller: string | null;
  builtYear: number | null;
  price: number | null;
}

export interface Fingerprint {
  /** Stable string of the strongest parts; equal keys = very likely the same property. */
  key: string;
  /** Used to look up candidates (same city). */
  cityKey: string | null;
  parts: FingerprintParts;
}

export interface FingerprintInput {
  address?: string | null;
  landArea?: string | null;
  buildingArea?: string | null;
  floorArea?: string | null;
  layout?: string | null;
  projectName?: string | null;
  title?: string | null;
  unitNumber?: string | null;
  propertyCode?: string | null;
  site?: string | null;
  seller?: string | null;
  builtDate?: string | null;
  price?: number | null;
}

const KANJI_DIGITS: Record<string, number> = { 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 二十三 → 23 (up to 99). */
function kanjiNumber(s: string): number | null {
  if (!/^[〇一二三四五六七八九十]+$/.test(s)) return null;
  if (!s.includes('十')) return Number([...s].map((c) => KANJI_DIGITS[c]).join(''));
  const [t, o] = s.split('十');
  return (t ? KANJI_DIGITS[t]! : 1) * 10 + (o ? KANJI_DIGITS[o]! : 0);
}

export function normalizeAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.normalize('NFKC').replace(/\s+/g, '');
  s = s.replace(/[（(][^）)]*[）)]/g, '');
  s = s.replace(/(地図を見る|地図|周辺環境|MAP).*$/i, '');
  s = s.replace(/大字|字(?=[^\d])/g, '');
  s = s.replace(/[ヶヵが](?=[丘谷崎関浦島原])/g, 'ケ');
  s = s.replace(/([〇一二三四五六七八九十]+)(丁目|番地|番|号)/g, (_, k: string, unit: string) => `${kanjiNumber(k) ?? k}${unit}`);
  s = s.replace(/(\d)[ー−‐―–-](?=\d)/g, '$1-');
  s = s.replace(/(以下未定|ほか|他)$/, '');
  return s || null;
}

const PREF_RE = /^(東京都|北海道|(?:京都|大阪)府|[^\d]{2,3}県)/;
const CITY_RE = /^([^\d]{1,6}?市[^\d市]{1,4}?区|[^\d]{1,6}?市|[^\d]{1,5}?郡[^\d]{1,5}?[町村]|[^\d]{1,5}?区|[^\d]{1,5}?[町村])/;

export function splitAddress(addr: string | null): { prefecture: string | null; cityKey: string | null; townKey: string | null } {
  if (!addr) return { prefecture: null, cityKey: null, townKey: null };
  let rest = addr;
  const pm = PREF_RE.exec(rest);
  const prefecture = pm ? pm[1]! : null;
  if (pm) rest = rest.slice(pm[1]!.length);
  const cm = CITY_RE.exec(rest);
  const cityKey = cm ? cm[1]! : null;
  if (cm) rest = rest.slice(cm[1]!.length);
  const town = rest.split(/\d/)[0]?.replace(/[-丁目番地号]+$/, '') ?? '';
  return { prefecture, cityKey, townKey: town ? town : null };
}

/** "120.5m²" / "120.50㎡(36.45坪)" → 120.5. */
export function parseArea(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.normalize('NFKC').replace(/,/g, '');
  const m = /(\d+(?:\.\d+)?)\s*(?:m2|m²|㎡|平米|m\^2)/i.exec(s) ?? /^(\d+(?:\.\d+)?)/.exec(s.trim());
  if (!m) return null;
  const v = parseFloat(m[1]!);
  return v > 0 && v < 100000 ? v : null;
}

export function normalizeLayout(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /(\d+)\s*([SLDK]+|R)/i.exec(raw.normalize('NFKC'));
  return m ? `${m[1]}${m[2]!.toUpperCase()}` : null;
}

export function normalizeUnit(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.normalize('NFKC');
  const m = /(\d+)\s*(?:号棟|棟|号地|区画|号室|号)/.exec(s) ?? /(?:No\.?|NO\.?|第)\s*(\d+)/.exec(s) ?? /^(\d+)$/.exec(s.trim());
  if (m) return m[1]!;
  const k = /([〇一二三四五六七八九十]+)(?:号棟|棟|号地|区画)/.exec(s);
  return k ? String(kanjiNumber(k[1]!) ?? k[1]) : null;
}

function builtYear(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.normalize('NFKC');
  const m = /(19\d{2}|20\d{2})年/.exec(s);
  if (m) return parseInt(m[1]!, 10);
  const r = /令和(\d+|元)年/.exec(s);
  if (r) return 2018 + (r[1] === '元' ? 1 : parseInt(r[1]!, 10));
  const h = /平成(\d+|元)年/.exec(s);
  if (h) return 1988 + (h[1] === '元' ? 1 : parseInt(h[1]!, 10));
  return null;
}

function compact(s: string | null | undefined): string | null {
  if (!s) return null;
  const v = s.normalize('NFKC').replace(/\s+/g, '').replace(/[【】\[\]「」『』]/g, '');
  return v || null;
}

/** Unit number from the title when there is no 号棟 field ("…町 1号棟"). */
function unitFromTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const m = /(\d+|[〇一二三四五六七八九十]+)\s*(?:号棟|号地)/.exec(title.normalize('NFKC'));
  if (!m) return null;
  return /^\d+$/.test(m[1]!) ? m[1]! : String(kanjiNumber(m[1]!) ?? m[1]);
}

export function buildFingerprint(input: FingerprintInput): Fingerprint {
  const address = normalizeAddress(input.address);
  const { prefecture, cityKey, townKey } = splitAddress(address);
  const parts: FingerprintParts = {
    address,
    cityKey,
    townKey,
    prefecture,
    landArea: parseArea(input.landArea),
    buildingArea: parseArea(input.buildingArea),
    floorArea: parseArea(input.floorArea),
    layout: normalizeLayout(input.layout),
    projectName: compact(input.projectName),
    unitNumber: normalizeUnit(input.unitNumber) ?? unitFromTitle(input.title),
    propertyCode: input.propertyCode ? `${input.site ?? 'X'}:${input.propertyCode}` : null,
    seller: compact(input.seller)?.replace(/(株式会社|\(株\)|有限会社)/g, '') ?? null,
    builtYear: builtYear(input.builtDate),
    price: input.price ?? null,
  };
  const key = [
    parts.address ?? '',
    parts.landArea ?? '',
    parts.buildingArea ?? '',
    parts.floorArea ?? '',
    parts.layout ?? '',
    parts.unitNumber ?? '',
  ].join('|');
  return { key, cityKey, parts };
}

function areaScore(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  const d = Math.abs(a - b) / Math.max(a, b);
  if (d <= 0.005) return 1;
  if (d <= 0.02) return 0.5;
  return d > 0.1 ? -1 : 0;
}

export interface MatchResult {
  confidence: number;
  reasons: string[];
}

/**
 * Similarity of two fingerprints in [0, 1]. Strong disagreements (different city, different
 * 号棟, very different areas) pull the score down. Requires the address or both areas.
 */
export function compareFingerprints(a: FingerprintParts, b: FingerprintParts): MatchResult {
  const reasons: string[] = [];
  let available = 0;
  let matched = 0;
  let penalty = 1;

  const hasAnchor =
    (a.address && b.address) ||
    (a.landArea != null && b.landArea != null && a.buildingArea != null && b.buildingArea != null) ||
    (a.floorArea != null && b.floorArea != null);
  if (!hasAnchor) return { confidence: 0, reasons: ['Không đủ dữ liệu (thiếu địa chỉ/diện tích)'] };

  if (a.propertyCode && b.propertyCode && a.propertyCode === b.propertyCode) {
    available += 0.3;
    matched += 0.3;
    reasons.push('Cùng mã BĐS');
  }

  if (a.address && b.address) {
    available += 0.25;
    if (a.address === b.address) {
      matched += 0.25;
      reasons.push('Cùng địa chỉ');
    } else if (a.cityKey && a.cityKey === b.cityKey && a.townKey && a.townKey === b.townKey) {
      matched += 0.15;
      reasons.push('Cùng khu (町)');
    } else if (a.cityKey && a.cityKey === b.cityKey) {
      matched += 0.04;
    } else {
      penalty *= 0.2;
      reasons.push('Khác thành phố');
    }
    if (a.prefecture && b.prefecture && a.prefecture !== b.prefecture) penalty *= 0.1;
  }

  for (const [key, label, w] of [
    ['landArea', 'diện tích đất', 0.15],
    ['buildingArea', 'diện tích xây dựng', 0.15],
    ['floorArea', 'diện tích sàn', 0.15],
  ] as const) {
    const s = areaScore(a[key], b[key]);
    if (s === null) continue;
    available += w;
    if (s > 0) {
      matched += w * s;
      reasons.push(s === 1 ? `Cùng ${label}` : `Gần bằng ${label}`);
    } else if (s < 0) {
      penalty *= 0.5;
      reasons.push(`Khác ${label}`);
    }
  }

  if (a.layout && b.layout) {
    available += 0.07;
    if (a.layout === b.layout) {
      matched += 0.07;
      reasons.push(`Cùng ${a.layout}`);
    }
  }
  if (a.unitNumber && b.unitNumber) {
    available += 0.1;
    if (a.unitNumber === b.unitNumber) {
      matched += 0.1;
      reasons.push(`Cùng số căn ${a.unitNumber}`);
    } else {
      penalty *= 0.3;
      reasons.push('Khác số căn (号棟)');
    }
  }
  if (a.projectName && b.projectName) {
    available += 0.06;
    if (a.projectName === b.projectName || a.projectName.includes(b.projectName) || b.projectName.includes(a.projectName)) {
      matched += 0.06;
      reasons.push('Cùng tên dự án');
    }
  }
  if (a.builtYear && b.builtYear) {
    available += 0.05;
    if (a.builtYear === b.builtYear) matched += 0.05;
    else if (Math.abs(a.builtYear - b.builtYear) > 1) penalty *= 0.5;
  }
  if (a.seller && b.seller) {
    available += 0.03;
    if (a.seller === b.seller) matched += 0.03;
  }
  if (a.price && b.price) {
    available += 0.02;
    if (Math.abs(a.price - b.price) / Math.max(a.price, b.price) <= 0.2) matched += 0.02;
  }

  if (available === 0) return { confidence: 0, reasons };
  const coverage = Math.min(1, available / 0.6);
  const confidence = Math.min(0.99, (matched / available) * coverage * penalty);
  return { confidence: Math.round(confidence * 100) / 100, reasons };
}

export const SAME_PROPERTY_THRESHOLD = 0.75;
