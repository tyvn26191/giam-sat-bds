import type { CheerioAPI } from 'cheerio';
import { hostMatches } from '@gsb/shared';
import { BaseAdapter } from '../base-adapter';
import type { ParseContext } from '../types';

/**
 * LIFULL HOME'S (homes.co.jp). Detail URLs contain /b-<id>/,
 * e.g. https://www.homes.co.jp/kodate/b-35003710000001/
 */
export class HomesAdapter extends BaseAdapter {
  readonly id = 'HOMES' as const;
  readonly name = "LIFULL HOME'S";
  protected override hints = {
    priceSelectors: ['.priceLabel', '[class*="price"] .num', '[data-component="price"]'],
    titleSelectors: ['h1 .bukkenName', 'h1'],
    addressSelectors: [],
    imageSelectors: ['meta[property="og:image"]'],
    titleNoise: [/【?LIFULL HOME'?S】?/gi, /\[?ホームズ\]?/g, /【ホームズ】/g, /で(物件|住宅)?(情報|購入).*$/],
    labelConfidence: 0.92,
  };

  canHandle(url: URL): boolean {
    return hostMatches(url.hostname, 'homes.co.jp');
  }

  override isDetailUrl(url: URL): boolean {
    return /\/b-[0-9a-z]+/i.test(url.pathname);
  }

  override extractPropertyId(url: URL, $?: CheerioAPI, ctx?: ParseContext): string | null {
    const m = /\/b-([0-9a-z]+)/i.exec(url.pathname);
    return m ? m[1]! : super.extractPropertyId(url, $, ctx);
  }
}
