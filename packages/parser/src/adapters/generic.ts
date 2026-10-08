import type { CheerioAPI } from 'cheerio';
import { BaseAdapter } from '../base-adapter';
import type { ParseContext } from '../types';

/**
 * Fallback for any site without a dedicated adapter: JSON-LD, meta / OpenGraph, labelled
 * tables, price and address regexes. Confidences are lower than for known sites.
 */
export class GenericAdapter extends BaseAdapter {
  readonly id = 'GENERIC' as const;
  readonly name = 'Generic';
  protected override hints = {
    priceSelectors: ['#price', '[id*="price"]', '[itemprop="price"]', '[class*="price"] [class*="num"]', '[class*="price"]'],
    titleSelectors: ['h1'],
    addressSelectors: ['[class*="address"]', '[itemprop="address"]'],
    imageSelectors: [],
    titleNoise: [],
    labelConfidence: 0.85,
  };

  canHandle(): boolean {
    return true;
  }

  /** Fallback: a long number at the end of the URL path (…/detail/713791962). */
  override extractPropertyId(url: URL, $?: CheerioAPI, ctx?: ParseContext): string | null {
    return super.extractPropertyId(url, $, ctx) ?? /\/(\d{6,})\/?$/.exec(url.pathname)?.[1] ?? null;
  }
}
