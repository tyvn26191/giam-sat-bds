import { BaseAdapter } from '../base-adapter';

/**
 * Fallback for any site without a dedicated adapter: JSON-LD, meta / OpenGraph, labelled
 * tables, price and address regexes. Confidences are lower than for known sites.
 */
export class GenericAdapter extends BaseAdapter {
  readonly id = 'GENERIC' as const;
  readonly name = 'Generic';
  protected override hints = {
    priceSelectors: ['[class*="price"] [class*="num"]', '[class*="price"]', '[id*="price"]'],
    titleSelectors: ['h1'],
    addressSelectors: ['[class*="address"]', '[itemprop="address"]'],
    imageSelectors: [],
    titleNoise: [],
    labelConfidence: 0.85,
  };

  canHandle(): boolean {
    return true;
  }
}
