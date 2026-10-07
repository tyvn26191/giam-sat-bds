import { describe, expect, it } from 'vitest';
import { isPrivateIp, normalizeUrl, parseIPv6, validatePublicUrl } from '../src/url';

describe('validatePublicUrl (SSRF)', () => {
  it.each([
    'https://suumo.jp/ikkodate/aichi/sc_nishio/nc_76543210/',
    'https://www.homes.co.jp/kodate/b-1234567890/',
    'https://www.athome.co.jp/kodate/6981234567/',
    'http://example.co.jp/property/123',
    'https://8.8.8.8/x',
    'https://[2001:4860:4860::8888]/',
  ])('allows %s', (u) => {
    expect(validatePublicUrl(u).ok).toBe(true);
  });

  it.each([
    'http://localhost/',
    'http://localhost:8080/',
    'http://127.0.0.1/',
    'http://127.1/',
    'http://2130706433/',
    'http://0x7f.0.0.1/',
    'http://0177.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://10.0.0.5/',
    'http://172.16.3.4/',
    'http://192.168.1.1/',
    'http://100.64.0.1/',
    'http://0.0.0.0/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:169.254.169.254]/',
    'http://[fd00::1]/',
    'http://[fe80::1]/',
    'http://intranet/',
    'http://foo.internal/',
    'http://printer.local/',
    'ftp://suumo.jp/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://user:pass@suumo.jp/',
    'https://suumo.jp:8443/',
    'not a url',
    '',
  ])('rejects %s', (u) => {
    expect(validatePublicUrl(u).ok).toBe(false);
  });
});

describe('isPrivateIp', () => {
  it('classifies IPv4', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('203.0.113.5')).toBe(true);
    expect(isPrivateIp('172.32.0.1')).toBe(false);
    expect(isPrivateIp('172.31.255.255')).toBe(true);
    expect(isPrivateIp('224.0.0.1')).toBe(true);
  });
  it('classifies IPv6 including embedded IPv4', () => {
    expect(isPrivateIp('2001:4860:4860::8888')).toBe(false);
    expect(isPrivateIp('::')).toBe(true);
    expect(isPrivateIp('::1')).toBe(true);
    expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false);
    expect(isPrivateIp('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateIp('64:ff9b::a9fe:a9fe')).toBe(true);
    expect(isPrivateIp('2002:7f00:0001::')).toBe(true);
    expect(isPrivateIp('fc00::1')).toBe(true);
    expect(isPrivateIp('ff02::1')).toBe(true);
    expect(isPrivateIp('garbage')).toBe(true);
  });
  it('parses IPv6 forms', () => {
    expect(parseIPv6('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(parseIPv6('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parseIPv6('1::8')).toEqual([1, 0, 0, 0, 0, 0, 0, 8]);
    expect(parseIPv6('1:2:3')).toBeNull();
    expect(parseIPv6('1::2::3')).toBeNull();
  });
});

describe('normalizeUrl', () => {
  it('drops fragments and tracking parameters only', () => {
    expect(normalizeUrl('https://suumo.jp/x/nc_1/?utm_source=a&gclid=b&id=5#photo')).toBe('https://suumo.jp/x/nc_1/?id=5');
  });
});
