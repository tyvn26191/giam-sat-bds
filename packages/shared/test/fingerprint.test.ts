import { describe, expect, it } from 'vitest';
import {
  SAME_PROPERTY_THRESHOLD,
  buildFingerprint,
  compareFingerprints,
  normalizeAddress,
  normalizeLayout,
  normalizeUnit,
  parseArea,
  splitAddress,
} from '../src/fingerprint';

const listingA = {
  address: '愛知県西尾市寺津町三丁目12番',
  landArea: '165.25m²（49.98坪）',
  buildingArea: '98.53m²',
  layout: '4LDK',
  projectName: '西尾市寺津町 新築戸建',
  title: '西尾市寺津町 1号棟',
  unitNumber: '1号棟',
  propertyCode: '76543210',
  site: 'SUUMO',
  seller: '株式会社サンプルホーム',
  builtDate: '2026年9月',
  price: 31_900_000,
};

describe('normalisation helpers', () => {
  it('normalises addresses', () => {
    expect(normalizeAddress('愛知県 西尾市 寺津町 三丁目１２番（地図）')).toBe('愛知県西尾市寺津町3丁目12番');
    expect(splitAddress('愛知県西尾市寺津町3丁目12番')).toEqual({ prefecture: '愛知県', cityKey: '西尾市', townKey: '寺津町' });
    expect(splitAddress('愛知県名古屋市中区栄3丁目').cityKey).toBe('名古屋市中区');
    expect(splitAddress('東京都世田谷区桜丘2丁目').cityKey).toBe('世田谷区');
    expect(splitAddress('愛知県知多郡東浦町緒川').cityKey).toBe('知多郡東浦町');
  });
  it('parses areas, layout and unit numbers', () => {
    expect(parseArea('165.25m²（49.98坪）')).toBe(165.25);
    expect(parseArea('98.53㎡')).toBe(98.53);
    expect(parseArea('１００．５m2')).toBe(100.5);
    expect(parseArea('-')).toBeNull();
    expect(normalizeLayout('４ＬＤＫ＋S（納戸）')).toBe('4LDK');
    expect(normalizeUnit('1号棟')).toBe('1');
    expect(normalizeUnit('第2期 3号地')).toBe('3');
    expect(normalizeUnit('二号棟')).toBe('2');
  });
});

describe('compareFingerprints', () => {
  it('scores a re-listing of the same house (new URL, new code, lower price) high', () => {
    const a = buildFingerprint(listingA);
    const b = buildFingerprint({ ...listingA, propertyCode: '79990001', price: 30_900_000, address: '愛知県西尾市寺津町3-12' });
    const r = compareFingerprints(a.parts, b.parts);
    expect(r.confidence).toBeGreaterThanOrEqual(SAME_PROPERTY_THRESHOLD);
    expect(r.confidence).toBeLessThan(1);
  });

  it('identical data from the same listing is near certain', () => {
    const a = buildFingerprint(listingA);
    expect(compareFingerprints(a.parts, a.parts).confidence).toBeGreaterThanOrEqual(0.95);
    expect(a.key).toBe(buildFingerprint(listingA).key);
  });

  it('another unit in the same development is not the same property', () => {
    const a = buildFingerprint(listingA);
    const b = buildFingerprint({ ...listingA, unitNumber: '2号棟', title: '西尾市寺津町 2号棟', landArea: '170.10m²', propertyCode: '76543211' });
    expect(compareFingerprints(a.parts, b.parts).confidence).toBeLessThan(SAME_PROPERTY_THRESHOLD);
  });

  it('a different city is not the same property even with equal areas', () => {
    const a = buildFingerprint(listingA);
    const b = buildFingerprint({ ...listingA, address: '愛知県岡崎市寺津町3丁目12番', propertyCode: null });
    expect(compareFingerprints(a.parts, b.parts).confidence).toBeLessThan(0.3);
  });

  it('never matches on price alone', () => {
    const a = buildFingerprint({ price: 31_900_000, layout: '4LDK' });
    const b = buildFingerprint({ price: 31_900_000, layout: '4LDK' });
    expect(compareFingerprints(a.parts, b.parts).confidence).toBe(0);
  });

  it('little data gives low confidence', () => {
    const a = buildFingerprint({ address: '愛知県西尾市寺津町3丁目' });
    const b = buildFingerprint({ address: '愛知県西尾市寺津町3丁目' });
    expect(compareFingerprints(a.parts, b.parts).confidence).toBeLessThan(SAME_PROPERTY_THRESHOLD);
  });
});
