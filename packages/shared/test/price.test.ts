import { describe, expect, it } from 'vitest';
import {
  comparePrices,
  formatDiffManYen,
  formatManYen,
  formatMillions,
  formatPercent,
  formatYen,
  parseJapanesePrice,
} from '../src/price';

const v = (s: string | number) => parseJapanesePrice(s)?.value ?? null;

describe('parseJapanesePrice', () => {
  it.each([
    ['3,190万円', 31_900_000],
    ['3,090万円', 30_900_000],
    ['29,800万円', 298_000_000],
    ['3億1,900万円', 319_000_000],
    ['¥31,900,000', 31_900_000],
    ['31,900,000円', 31_900_000],
    ['31,900,000 JPY', 31_900_000],
    ['3190万円', 31_900_000],
    ['3 190 万円', 31_900_000],
    ['３，１９０万円', 31_900_000],
    ['￥31,900,000', 31_900_000],
    ['1.5億円', 150_000_000],
    ['3億円', 300_000_000],
    ['1億5000万円', 150_000_000],
    ['3,190万5,000円', 31_905_000],
    ['3190.5万円', 31_905_000],
    ['価格 3,190万円（税込）', 31_900_000],
    ['3,190万円 新価格', 31_900_000],
    ['JPY 31,900,000', 31_900_000],
  ])('%s → %d', (input, expected) => {
    expect(v(input)).toBe(expected);
  });

  it.each(['価格未定', '商談中', '', '   ', '2LDK', '徒歩5分', '100円'])('%s → null', (input) => {
    expect(parseJapanesePrice(input)).toBeNull();
  });

  it('parses numbers from structured data', () => {
    expect(v(31900000)).toBe(31_900_000);
    expect(parseJapanesePrice(0)).toBeNull();
    expect(parseJapanesePrice(Number.NaN)).toBeNull();
  });

  it('detects a 価格帯 range and keeps the lower bound', () => {
    const p = parseJapanesePrice('2,980万円～3,280万円');
    expect(p).toMatchObject({ value: 29_800_000, max: 32_800_000, isRange: true, display: '2,980万円～3,280万円' });
  });

  it('reads "旧 → 新" as previous and current price', () => {
    const p = parseJapanesePrice('3,190万円 → 3,090万円');
    expect(p).toMatchObject({ value: 30_900_000, previous: 31_900_000, isRange: false });
  });

  it('builds the canonical display', () => {
    expect(parseJapanesePrice('¥31,900,000')?.display).toBe('3,190万円');
    expect(parseJapanesePrice('3億1900万円')?.display).toBe('3億1,900万円');
  });
});

describe('formatting', () => {
  it('formats 万円 / 億円', () => {
    expect(formatManYen(31_900_000)).toBe('3,190万円');
    expect(formatManYen(298_000_000)).toBe('2億9,800万円');
    expect(formatManYen(319_000_000)).toBe('3億1,900万円');
    expect(formatManYen(300_000_000)).toBe('3億円');
    expect(formatManYen(31_905_000)).toBe('3,190万5,000円');
    expect(formatManYen(1_000_000)).toBe('100万円');
    expect(formatManYen(-1_000_000)).toBe('-100万円');
  });
  it('formats yen, millions, percent, diff', () => {
    expect(formatYen(31_900_000)).toBe('¥31,900,000');
    expect(formatYen(-1_000_000)).toBe('-¥1,000,000');
    expect(formatMillions(31_900_000)).toBe('31.9M');
    expect(formatMillions(30_000_000)).toBe('30M');
    expect(formatPercent(-3.1348)).toBe('-3.13%');
    expect(formatPercent(2)).toBe('+2.00%');
    expect(formatDiffManYen(-1_000_000)).toBe('-100万円');
    expect(formatDiffManYen(500_000)).toBe('+50万円');
  });
});

describe('comparePrices', () => {
  it('PRICE_DECREASE with difference and 4-decimal percentage', () => {
    expect(comparePrices(31_900_000, 30_900_000)).toEqual({
      type: 'PRICE_DECREASE',
      difference: -1_000_000,
      percentage: -3.1348,
    });
  });
  it('PRICE_INCREASE', () => {
    expect(comparePrices(30_900_000, 31_900_000)).toMatchObject({ type: 'PRICE_INCREASE', difference: 1_000_000 });
  });
  it('PRICE_UNCHANGED', () => {
    expect(comparePrices(30_900_000, 30_900_000).type).toBe('PRICE_UNCHANGED');
  });
  it('PRICE_UNKNOWN when either side is missing', () => {
    expect(comparePrices(null, 30_900_000).type).toBe('PRICE_UNKNOWN');
    expect(comparePrices(30_900_000, null).type).toBe('PRICE_UNKNOWN');
  });
});
