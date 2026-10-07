import type { CheerioAPI } from 'cheerio';
import { hostMatches } from '@gsb/shared';
import { BaseAdapter } from '../base-adapter';
import type { ParseContext } from '../types';

/**
 * at home (athome.co.jp). Detail URLs end with a numeric property number,
 * e.g. https://www.athome.co.jp/kodate/6981234567/ (query strings such as ?DOWN=1 are kept).
 * at home is known to show bot-protection pages to automated clients; those are reported as
 * BLOCKED and never bypassed.
 */
export class AthomeAdapter extends BaseAdapter {
  readonly id = 'ATHOME' as const;
  readonly name = 'at home';
  protected override hints = {
    priceSelectors: ['.price-main', '[class*="price"] [class*="num"]'],
    titleSelectors: ['h1'],
    addressSelectors: [],
    imageSelectors: ['meta[property="og:image"]'],
    titleNoise: [/【アットホーム】/g, /アットホーム/g, /[(（]物件番号[:：]?\s*\d+[)）]/g],
    labelConfidence: 0.92,
  };

  canHandle(url: URL): boolean {
    return hostMatches(url.hostname, 'athome.co.jp');
  }

  override isDetailUrl(url: URL): boolean {
    return /\/\d{8,12}\/?$/.test(url.pathname);
  }

  override extractPropertyId(url: URL, $?: CheerioAPI, ctx?: ParseContext): string | null {
    const m = /\/(\d{8,12})\/?$/.exec(url.pathname);
    return m ? m[1]! : super.extractPropertyId(url, $, ctx);
  }
}
