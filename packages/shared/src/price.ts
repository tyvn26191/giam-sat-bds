// Japanese price parsing / formatting. Prices are stored as integer JPY.

import type { PriceChangeType } from './status';

export interface ParsedPrice {
  /** Integer JPY. For a range (価格帯) this is the lower bound. */
  value: number;
  /** Canonical display, e.g. "3,190万円" or "2,980万円～3,280万円". */
  display: string;
  isRange: boolean;
  max: number | null;
  /** Old price when the text shows "旧 → 新" (e.g. "3,190万円→3,090万円"). */
  previous: number | null;
}

// Amount forms after normalisation (NFKC, no spaces, no thousands commas):
//  1) 3億1900万5000円 / 3億円 / 1.5億   2) 3190万円 / 3190万5000円 / 3190万
//  3) ¥31900000 / JPY31900000          4) 31900000円 / 31900000JPY
const AMOUNT_RE =
  /(\d+(?:\.\d+)?)億(?:(\d+(?:\.\d+)?)万)?(?:(\d+)円|円)?|(\d+(?:\.\d+)?)万(?:(\d+)円|円)?|(?:[¥\\]|JPY|JP¥)(\d+)|(\d+)(?:円|JPY|yen|YEN)/g;

const MIN_PRICE = 10_000; // nothing on a property site is cheaper than 1万円
const MAX_PRICE = 1_000_000_000_000;

/** NFKC + remove whitespace + remove thousands separators between digits. */
export function normalizeAmountText(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/(\d),(?=\d)/g, '$1')
    .replace(/(\d)、(?=\d{3})/g, '$1');
}

interface Amount {
  value: number;
  start: number;
  end: number;
}

function findAmounts(s: string): Amount[] {
  const out: Amount[] = [];
  for (const m of s.matchAll(AMOUNT_RE)) {
    let value: number;
    if (m[1] !== undefined) {
      value = parseFloat(m[1]) * 1e8 + (m[2] ? parseFloat(m[2]) * 1e4 : 0) + (m[3] ? parseInt(m[3], 10) : 0);
    } else if (m[4] !== undefined) {
      value = parseFloat(m[4]) * 1e4 + (m[5] ? parseInt(m[5], 10) : 0);
    } else if (m[6] !== undefined) {
      value = parseInt(m[6], 10);
    } else {
      value = parseInt(m[7]!, 10);
    }
    value = Math.round(value);
    if (value >= MIN_PRICE && value <= MAX_PRICE) {
      out.push({ value, start: m.index!, end: m.index! + m[0].length });
    }
  }
  return out;
}

/**
 * Parse a Japanese price text into integer JPY.
 * "3,190万円" → 31,900,000 · "3億1,900万円" → 319,000,000 · "¥31,900,000" → 31,900,000.
 * Returns null for "価格未定", "商談中", empty text, etc.
 */
export function parseJapanesePrice(input: string | number | null | undefined): ParsedPrice | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < MIN_PRICE || input > MAX_PRICE) return null;
    const value = Math.round(input);
    return { value, display: formatManYen(value), isRange: false, max: null, previous: null };
  }
  const s = normalizeAmountText(input);
  if (!s) return null;
  const amounts = findAmounts(s);
  if (amounts.length === 0) return null;

  if (amounts.length >= 2) {
    const between = s.slice(amounts[0]!.end, amounts[1]!.start);
    if (/[→⇒➡]|->/.test(between)) {
      const value = amounts[amounts.length - 1]!.value;
      return { value, display: formatManYen(value), isRange: false, max: null, previous: amounts[0]!.value };
    }
    if (/^[~〜～\-−–―]{1,2}$/.test(between)) {
      const lo = Math.min(amounts[0]!.value, amounts[1]!.value);
      const hi = Math.max(amounts[0]!.value, amounts[1]!.value);
      return { value: lo, display: `${formatManYen(lo)}～${formatManYen(hi)}`, isRange: true, max: hi, previous: null };
    }
  }
  const value = amounts[0]!.value;
  return { value, display: formatManYen(value), isRange: false, max: null, previous: null };
}

/** 31900000 → "3,190万円"; 319000000 → "3億1,900万円"; 31905000 → "3,190万5,000円". */
export function formatManYen(value: number): string {
  if (!Number.isFinite(value)) return '';
  const sign = value < 0 ? '-' : '';
  let v = Math.abs(Math.round(value));
  const oku = Math.floor(v / 1e8);
  v -= oku * 1e8;
  const man = Math.floor(v / 1e4);
  v -= man * 1e4;
  let s = '';
  if (oku) s += `${oku.toLocaleString('en-US')}億`;
  if (man) s += `${man.toLocaleString('en-US')}万`;
  if (v) s += v.toLocaleString('en-US');
  return `${sign}${s || '0'}円`;
}

/** 31900000 → "¥31,900,000"; -1000000 → "-¥1,000,000". */
export function formatYen(value: number): string {
  const sign = value < 0 ? '-' : '';
  return `${sign}¥${Math.abs(Math.round(value)).toLocaleString('en-US')}`;
}

/** 31900000 → "31.9M". Used on chart axes. */
export function formatMillions(value: number): string {
  const m = value / 1e6;
  const s = Math.abs(m) >= 100 ? m.toFixed(0) : m.toFixed(1);
  return `${s.replace(/\.0$/, '')}M`;
}

/** -3.1348 → "-3.13%"; 2 → "+2.00%". */
export function formatPercent(pct: number): string {
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

/** Signed difference in 万円: -1000000 → "-100万円". */
export function formatDiffManYen(diff: number): string {
  if (diff === 0) return '±0円';
  return `${diff > 0 ? '+' : '-'}${formatManYen(Math.abs(diff))}`;
}

export interface PriceChange {
  type: PriceChangeType;
  difference: number | null;
  /** Percent, rounded to 4 decimals (e.g. -3.1348). */
  percentage: number | null;
}

export function comparePrices(oldPrice: number | null | undefined, newPrice: number | null | undefined): PriceChange {
  if (oldPrice == null || newPrice == null) return { type: 'PRICE_UNKNOWN', difference: null, percentage: null };
  if (oldPrice === newPrice) return { type: 'PRICE_UNCHANGED', difference: 0, percentage: 0 };
  const difference = newPrice - oldPrice;
  const percentage = oldPrice > 0 ? Math.round((difference / oldPrice) * 100 * 10000) / 10000 : null;
  return { type: difference < 0 ? 'PRICE_DECREASE' : 'PRICE_INCREASE', difference, percentage };
}
