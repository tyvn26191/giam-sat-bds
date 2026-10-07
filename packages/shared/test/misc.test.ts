import { describe, expect, it } from 'vitest';
import { toCsv } from '../src/csv';
import { fieldForLabel } from '../src/fields';
import { backoffTime, nextCheckTime } from '../src/schedule';
import { formatDateTime, formatRelativeVi } from '../src/time';

describe('schedule', () => {
  it('keeps jitter symmetric and small', () => {
    const now = 1_000_000;
    expect(nextCheckTime(now, 15, () => 0.5)).toBe(now + 15 * 60_000);
    expect(nextCheckTime(now, 15, () => 0)).toBe(now + 15 * 60_000 - 90_000);
    expect(nextCheckTime(now, 15, () => 1)).toBe(now + 15 * 60_000 + 90_000);
  });
  it('caps the backoff', () => {
    expect(backoffTime(0, 15, 1)).toBe(30 * 60_000);
    expect(backoffTime(0, 60, 10)).toBe(6 * 3600_000);
  });
});

describe('time', () => {
  it('formats in Asia/Tokyo', () => {
    // 2026-10-07T21:15:00Z = 2026-10-08 06:15 JST
    expect(formatDateTime(Date.UTC(2026, 9, 7, 21, 15))).toBe('2026/10/08 06:15');
    expect(formatRelativeVi(0, 5 * 60_000)).toBe('5 phút trước');
  });
});

describe('labels', () => {
  it('maps 物件概要 labels to fields', () => {
    expect(fieldForLabel('価格')).toBe('price');
    expect(fieldForLabel('価格 ヒント')).toBe('price');
    expect(fieldForLabel('完成時期（築年月）')).toBe('builtDate');
    expect(fieldForLabel('引渡可能時期')).toBe('deliveryDate');
    expect(fieldForLabel('延床面積')).toBe('buildingArea');
    expect(fieldForLabel('土地面積：')).toBe('landArea');
    expect(fieldForLabel('次回更新予定日')).toBe('nextUpdateDate');
    expect(fieldForLabel('何か')).toBeNull();
  });
});

describe('csv', () => {
  it('quotes and neutralises formulas', () => {
    expect(toCsv([['a,b', '=HYPERLINK("x")', -5, null]])).toBe('"a,b","\'=HYPERLINK(""x"")",-5,\r\n');
  });
});
