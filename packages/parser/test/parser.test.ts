import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AdapterRegistry,
  BaseAdapter,
  GenericAdapter,
  decodeHtml,
  defaultRegistry,
  parseProperty,
  textDiff,
  type PageInput,
} from '../src';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8');

const SUUMO_URL = 'https://suumo.jp/ikkodate/aichi/sc_nishio/nc_76543210/';
const HOMES_URL = 'https://www.homes.co.jp/kodate/b-35003710000001/';
const ATHOME_URL = 'https://www.athome.co.jp/mansion/6981234567/';
const GENERIC_URL = 'https://www.example-fudosan.jp/property/1002';

function page(url: string, file: string, extra: Partial<PageInput> = {}): PageInput {
  return { url, finalUrl: url, status: 200, html: fixture(file), method: 'HTTP', ...extra };
}

describe('adapter registry', () => {
  it('picks the adapter by host', () => {
    expect(defaultRegistry.forUrl(SUUMO_URL).id).toBe('SUUMO');
    expect(defaultRegistry.forUrl('https://suumo.jp/chukoikkodate/aichi/sc_okazaki/nc_1/').id).toBe('SUUMO');
    expect(defaultRegistry.forUrl(HOMES_URL).id).toBe('HOMES');
    expect(defaultRegistry.forUrl(ATHOME_URL).id).toBe('ATHOME');
    expect(defaultRegistry.forUrl(GENERIC_URL).id).toBe('GENERIC');
    expect(defaultRegistry.forUrl('https://notsuumo.jp/x').id).toBe('GENERIC');
    expect(defaultRegistry.forUrl('::bad::').id).toBe('GENERIC');
  });

  it('accepts new adapters without touching the core', () => {
    class ExampleAdapter extends BaseAdapter {
      readonly id = 'GENERIC' as const;
      readonly name = 'Example Realty';
      canHandle(url: URL) {
        return url.hostname === 'www.example-fudosan.jp';
      }
    }
    const reg = new AdapterRegistry(new GenericAdapter()).register(new ExampleAdapter());
    expect(reg.forUrl(GENERIC_URL).name).toBe('Example Realty');
  });
});

describe('SuumoAdapter', () => {
  const r = parseProperty(page(SUUMO_URL, 'suumo-example.html'));

  it('extracts price, title, address, ID and important fields', () => {
    expect(r.state).toBe('OK');
    expect(r.site).toBe('SUUMO');
    expect(r.parser).toBe('suumo@1');
    expect(r.price?.value).toBe(31_900_000);
    expect(r.price?.display).toBe('3,190万円');
    expect(r.price!.confidence).toBeGreaterThanOrEqual(0.95);
    expect(r.title?.value).toBe('西尾市寺津町 1号棟');
    expect(r.address?.value).toBe('愛知県西尾市寺津町三丁目');
    expect(r.propertyCode).toBe('76543210');
    expect(r.fields).toMatchObject({
      landArea: '165.25m2(49.98坪)',
      buildingArea: '98.53m2(29.80坪)',
      layout: '4LDK',
      builtDate: '2026年9月',
      deliveryDate: '即引渡可',
      unitNumber: '1号棟',
      seller: '株式会社サンプルホーム',
      postedDate: '2026年10月1日',
      nextUpdateDate: '2026年10月15日',
      remarks: '駐車2台可。太陽光発電システム付き。',
    });
    expect(r.imageUrl).toMatch(/^https:\/\/img01\.suumo\.example\/.+76543210_0001\.jpg/);
    expect(r.needsReview).toBe(false);
  });

  it('is not BLOCKED just because the inquiry form loads reCAPTCHA', () => {
    expect(r.state).toBe('OK');
  });

  it('builds a fingerprint', () => {
    expect(r.fingerprint.cityKey).toBe('西尾市');
    expect(r.fingerprint.parts).toMatchObject({ landArea: 165.25, buildingArea: 98.53, layout: '4LDK', unitNumber: '1' });
  });

  it('ignores counters, timestamps, ads and session ids in the normalized text', () => {
    const a = parseProperty(page(SUUMO_URL, 'suumo-example.html'), { mode: 'FULL' });
    const noisy = fixture('suumo-example.html')
      .replace('2026/10/08 06:14:55', '2026/10/08 09:00:01')
      .replace('現在の閲覧数: 128', '現在の閲覧数: 999')
      .replace('a8f3c2e1b4d5f6a7b8c9d0e1f2a3b4c5', '00000000000000000000000000000000')
      .replace('岡崎市 2980万円', '豊橋市 1980万円')
      .replace('金利 0.3%', '金利 0.2%');
    const b = parseProperty({ ...page(SUUMO_URL, 'suumo-example.html'), html: noisy }, { mode: 'FULL' });
    expect(b.normalizedText).toBe(a.normalizedText);
    expect(a.normalizedText).toContain('3190万円');
    expect(a.normalizedText).not.toMatch(/閲覧数|ローンシミュレーション|Copyright/);
  });

  it('detects the price decrease page', () => {
    const d = parseProperty(page(SUUMO_URL, 'suumo-price-down.html'));
    expect(d.price?.value).toBe(30_900_000);
    expect(d.state).toBe('OK');
  });

  it('detects a removed listing (HTTP 200 with 掲載終了)', () => {
    const d = parseProperty(page(SUUMO_URL, 'suumo-removed.html'));
    expect(d.state).toBe('REMOVED');
    expect(d.price).toBeNull();
  });

  it('treats a redirect from a detail page to a search page as removed', () => {
    const html = '<html><head><title>西尾市の新築一戸建て</title></head><body><h1>検索結果</h1></body></html>';
    const d = parseProperty({ url: SUUMO_URL, finalUrl: 'https://suumo.jp/ikkodate/aichi/sc_nishio/', status: 200, html, method: 'HTTP' });
    expect(d.state).toBe('REMOVED');
  });
});

describe('HomesAdapter', () => {
  const r = parseProperty(page(HOMES_URL, 'homes-example.html'));
  it('reads dl/dt/dd specs', () => {
    expect(r.site).toBe('HOMES');
    expect(r.state).toBe('OK');
    expect(r.price?.value).toBe(24_800_000);
    expect(r.title?.value).toBe('岡崎市美合町 中古一戸建て');
    expect(r.address?.value).toBe('愛知県岡崎市美合町字平端');
    expect(r.propertyCode).toBe('35003710000001');
    expect(r.fields).toMatchObject({ layout: '4LDK', builtDate: '2008年3月', occupancy: '空家', deliveryDate: '相談' });
    expect(r.fields.landArea).toContain('201.43');
    expect(r.imageUrl).toContain('b-35003710000001/main.jpg');
    expect(r.fingerprint.cityKey).toBe('岡崎市');
  });
});

describe('AthomeAdapter', () => {
  const r = parseProperty(page(ATHOME_URL, 'athome-example.html'));
  it('parses 億 prices and ignores 管理費', () => {
    expect(r.site).toBe('ATHOME');
    expect(r.price?.value).toBe(118_000_000);
    expect(r.price?.display).toBe('1億1,800万円');
    expect(r.propertyCode).toBe('6981234567');
    expect(r.fields).toMatchObject({ floorArea: '85.12m2(壁芯)', unitNumber: '702号室', projectName: 'サンプルマンション三河安城' });
    expect(r.imageUrl).toBe('https://img.athome.example/image_files/path/6981234567_main.jpg');
  });

  it('reports bot protection as BLOCKED, never as REMOVED', () => {
    const b = parseProperty(page(ATHOME_URL, 'athome-blocked.html'));
    expect(b.state).toBe('BLOCKED');
    const cf = parseProperty(page(ATHOME_URL, 'cloudflare-challenge.html'));
    expect(cf.state).toBe('BLOCKED');
  });
});

describe('GenericAdapter', () => {
  it('uses JSON-LD and labelled lines, with agreeing sources', () => {
    const r = parseProperty(page(GENERIC_URL, 'generic-jsonld.html'));
    expect(r.site).toBe('GENERIC');
    expect(r.state).toBe('OK');
    expect(r.price?.value).toBe(33_800_000);
    expect(r.price!.confidence).toBeGreaterThanOrEqual(0.9);
    expect(r.title?.value).toBe('寺津の杜 2号棟');
    expect(r.address?.value).toBe('愛知県西尾市寺津町四丁目');
    expect(r.fields).toMatchObject({ layout: '4LDK', deliveryDate: '2027年2月予定' });
    expect(r.fingerprint.parts.unitNumber).toBe('2');
  });

  it('flags NEEDS_REVIEW when only a title regex gives the price', () => {
    const r = parseProperty(page('https://machi-fudosan.example.jp/p/9', 'generic-og-only.html'));
    expect(r.price?.value).toBe(31_900_000);
    expect(r.price!.confidence).toBeLessThan(0.7);
    expect(r.needsReview).toBe(true);
    expect(r.reviewReasons).toContain('LOW_PRICE_CONFIDENCE');
  });

  it('flags conflicting prices instead of trusting one', () => {
    const html = `<html><body><h1>物件A</h1><table><tr><th>価格</th><td>3,190万円</td></tr><tr><th>所在地</th><td>愛知県西尾市寺津町</td></tr></table>
      <script type="application/ld+json">{"@type":"Product","offers":{"price":29900000,"priceCurrency":"JPY"}}</script></body></html>`;
    const r = parseProperty({ url: GENERIC_URL, finalUrl: GENERIC_URL, status: 200, html, method: 'HTTP' });
    expect(r.price!.confidence).toBeLessThanOrEqual(0.6);
    expect(r.reviewReasons).toContain('PRICE_CONFLICT');
  });

  it('recognises a JavaScript-only shell', () => {
    const r = parseProperty(page(GENERIC_URL, 'spa-shell.html'));
    expect(r.state).toBe('NEEDS_BROWSER');
  });

  it('reports PARSE_FAILED for unrelated pages', () => {
    const html = `<html><body><h1>会社概要</h1><p>${'私たちは地域密着の不動産会社です。'.repeat(40)}</p></body></html>`;
    const r = parseProperty({ url: GENERIC_URL, finalUrl: GENERIC_URL, status: 200, html, method: 'HTTP' });
    expect(r.state).toBe('PARSE_FAILED');
  });

  it('honours custom CSS selectors', () => {
    const html = `<html><body><div class="x"><span id="kakaku">2,750万円</span></div><div class="y">愛知県碧南市新川町</div></body></html>`;
    const r = parseProperty(
      { url: GENERIC_URL, finalUrl: GENERIC_URL, status: 200, html, method: 'HTTP' },
      { selectors: { price: '#kakaku', address: '.y', title: null, content: null } },
    );
    expect(r.price).toMatchObject({ value: 27_500_000, confidence: 0.95 });
    expect(r.address?.value).toBe('愛知県碧南市新川町');
  });

  it('survives an invalid custom selector', () => {
    const r = parseProperty(page(GENERIC_URL, 'generic-jsonld.html'), { selectors: { price: '###', title: null, address: null, content: null } });
    expect(r.price?.value).toBe(33_800_000);
  });
});

describe('decodeHtml', () => {
  it('decodes Shift_JIS declared in a meta tag', () => {
    // "<meta charset="Shift_JIS">価格" with 価格 = 0x89BF 0x8A69 in Shift_JIS
    const head = Buffer.from('<meta charset="Shift_JIS">', 'ascii');
    const bytes = Buffer.concat([head, Buffer.from([0x89, 0xbf, 0x8a, 0x69])]);
    expect(decodeHtml(bytes)).toBe('<meta charset="Shift_JIS">価格');
  });
  it('prefers the Content-Type charset', () => {
    const bytes = Buffer.from([0x89, 0xbf, 0x8a, 0x69]);
    expect(decodeHtml(bytes, 'text/html; charset=Shift_JIS')).toBe('価格');
    expect(decodeHtml(Buffer.from('価格', 'utf8'), 'text/html')).toBe('価格');
  });
});

describe('textDiff', () => {
  it('lists added and removed lines', () => {
    expect(textDiff('a\nb\nc', 'a\nc\nd')).toEqual({ added: ['d'], removed: ['b'] });
  });
});

describe('bot challenge interstitial', () => {
  it('recognises the random-script challenge page', () => {
    const r = parseProperty(page('https://www.athome.co.jp/kodate/1194102416/', 'athome-challenge-405.html'));
    expect(r.state).toBe('BLOCKED');
  });
});

describe('sibling label/value markup and other-listing blocks', () => {
  const url = 'https://www.sample-home.example.jp/buy/detail/713791962';
  const r = parseProperty(page(url, 'generic-sibling-labels.html'));
  it('reads <span>価格</span><span id="price">… and ignores 値下げ物件 / similar listings', () => {
    expect(r.price?.value).toBe(29_900_000);
    expect(r.price!.confidence).toBeGreaterThanOrEqual(0.9);
    expect(r.needsReview).toBe(false);
    expect(r.title?.value).toBe('西尾市中畑町 D号棟');
    expect(r.address?.value).toBe('西尾市中畑町宮東22-1');
    expect(r.propertyCode).toBe('713791962');
  });
});
