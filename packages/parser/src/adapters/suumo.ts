import type { CheerioAPI } from 'cheerio';
import { hostMatches } from '@gsb/shared';
import { BaseAdapter } from '../base-adapter';
import type { ParseContext } from '../types';

/**
 * SUUMO (suumo.jp). Detail URLs end with /nc_<digits>/ (sale) or /bc_<digits>/ (rent),
 * e.g. https://suumo.jp/chukoikkodate/aichi/sc_nishio/nc_76543210/
 * Data lives in 物件概要 / 物件詳細情報 tables (th/td), which the base label extraction reads.
 */
export class SuumoAdapter extends BaseAdapter {
  readonly id = 'SUUMO' as const;
  readonly name = 'SUUMO';
  protected override hints = {
    priceSelectors: ['.property_view_note-emphasis', '.property_view_main-emphasis'],
    titleSelectors: ['h1.section_h1-header-title', '.section_h1-header-title', 'h1'],
    addressSelectors: [],
    imageSelectors: ['meta[property="og:image"]', '#js-view_gallery-main img', '.property_view_gallery-slide-item img'],
    titleNoise: [/【SUUMO(\(スーモ\))?】/g, /SUUMO\(スーモ\)/g, /物件情報$/],
    labelConfidence: 0.92,
  };

  canHandle(url: URL): boolean {
    return hostMatches(url.hostname, 'suumo.jp');
  }

  override isDetailUrl(url: URL): boolean {
    return /\/(nc|bc)_\d+/.test(url.pathname);
  }

  override extractPropertyId(url: URL, $?: CheerioAPI, ctx?: ParseContext): string | null {
    const m = /\/(nc|bc)_(\d+)/.exec(url.pathname);
    return m ? m[2]! : super.extractPropertyId(url, $, ctx);
  }
}
