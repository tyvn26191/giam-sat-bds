// BaseAdapter: generic extraction that works on most Japanese property pages (labelled
// 物件概要 tables, JSON-LD, OpenGraph, regex fallbacks). Site adapters subclass it and only
// override what is specific to their site.

import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import {
  FIELD_KEYS,
  buildFingerprint,
  parseJapanesePrice,
  type Confidence,
  type FieldKey,
  type Fingerprint,
  type SiteId,
} from '@gsb/shared';
import { detectBlocked, detectNeedsBrowser, detectRemovedStrong, detectRemovedWeak, redirectedAway } from './classify';
import { absoluteUrl, bodyText, clean, extractJsonLd, extractLabelPairs, extractMeta, ldTypes, selectText } from './html';
import { normalizePageText } from './normalize';
import type {
  PageInput,
  PageState,
  ParseContext,
  ParseOptions,
  ParseResult,
  ParsedPriceValue,
  ParsedValue,
  PropertySiteAdapter,
} from './types';

export const MIN_PRICE_CONFIDENCE = 0.7;

const LD_PROPERTY_TYPES = /^(Product|Offer|RealEstateListing|Residence|House|SingleFamilyResidence|Apartment|Accommodation|Place|Landform|ApartmentComplex)$/;

export interface SiteHints {
  /** Selectors tried for the price before generic extraction (cross-checked with the 価格 label). */
  priceSelectors: string[];
  titleSelectors: string[];
  addressSelectors: string[];
  imageSelectors: string[];
  /** Site name fragments removed from <title>/og:title. */
  titleNoise: RegExp[];
  /** Multiplier for generic confidences (a known site's 価格 label is more trustworthy). */
  labelConfidence: number;
}

const DEFAULT_HINTS: SiteHints = {
  priceSelectors: [],
  titleSelectors: ['h1'],
  addressSelectors: [],
  imageSelectors: [],
  titleNoise: [],
  labelConfidence: 0.9,
};

type PriceCandidate = ParsedPriceValue;

export abstract class BaseAdapter implements PropertySiteAdapter {
  abstract readonly id: SiteId;
  abstract readonly name: string;
  readonly version: number = 1;
  protected hints: SiteHints = DEFAULT_HINTS;

  abstract canHandle(url: URL): boolean;

  /** Is this URL a property detail page (vs. a list/search/top page)? */
  isDetailUrl(_url: URL): boolean {
    return true;
  }

  extractPropertyId(_url: URL, _$?: CheerioAPI, ctx?: ParseContext): string | null {
    const code = ctx?.labels.get('propertyCode')?.[0];
    if (!code) return null;
    const m = /[A-Za-z0-9-]{4,40}/.exec(code);
    return m ? m[0] : null;
  }

  parse(page: PageInput, options: ParseOptions = {}): ParseResult {
    const $ = cheerio.load(page.html);
    let url: URL;
    try {
      url = new URL(page.finalUrl || page.url);
    } catch {
      url = new URL('https://invalid.example/');
    }
    const ctx: ParseContext = {
      page,
      url,
      options,
      labels: extractLabelPairs($),
      jsonLd: extractJsonLd($),
      meta: extractMeta($),
      bodyText: bodyText($).normalize('NFKC'),
    };

    const price = this.parsePrice($, ctx);
    const title = this.parseTitle($, ctx);
    const address = this.parseAddress($, ctx);
    const fields = this.parsePropertyData($, ctx);
    let requested = url;
    try {
      requested = new URL(page.url);
    } catch {
      // keep finalUrl
    }
    const propertyCode = this.extractPropertyId(requested, $, ctx) ?? this.extractPropertyId(url, $, ctx);
    if (propertyCode && !fields.propertyCode) fields.propertyCode = propertyCode;
    if (address && !fields.address) fields.address = address.value;
    const imageUrl = this.parseImage($, ctx);

    const reviewReasons: string[] = [];
    if (price) {
      if (price.confidence < MIN_PRICE_CONFIDENCE) reviewReasons.push('LOW_PRICE_CONFIDENCE');
      if (price.source.includes('conflict')) reviewReasons.push('PRICE_CONFLICT');
    }
    if (address && address.confidence < 0.6) reviewReasons.push('LOW_ADDRESS_CONFIDENCE');

    const { state, reason } = this.detectPageState($, ctx, { price, title, address, fields });
    if (state === 'OK' && !price) reviewReasons.push('PRICE_NOT_FOUND');

    const confidence: Confidence = {
      price: price?.confidence ?? 0,
      title: title?.confidence ?? 0,
      address: address?.confidence ?? 0,
      overall: 0,
    };
    confidence.overall = Math.round((confidence.price * 0.5 + confidence.address * 0.3 + confidence.title * 0.2) * 100) / 100;

    const partial = {
      site: this.id,
      parser: `${this.id.toLowerCase()}@${this.version}`,
      state,
      stateReason: reason,
      title,
      price,
      address,
      propertyCode: propertyCode ?? null,
      imageUrl,
      fields,
      confidence,
      needsReview: state === 'OK' && reviewReasons.length > 0,
      reviewReasons,
    };
    const normalizedText = this.normalize($, partial, ctx);
    const withText = { ...partial, normalizedText };
    return { ...withText, fingerprint: this.createFingerprint(withText) };
  }

  protected detectPageState(
    $: CheerioAPI,
    ctx: ParseContext,
    data: { price: PriceCandidate | null; title: ParsedValue | null; address: ParsedValue | null; fields: Partial<Record<FieldKey, string>> },
  ): { state: PageState; reason: string | null } {
    const strongRemoved = detectRemovedStrong($);
    if (strongRemoved && !(data.price && data.price.confidence >= 0.9 && Object.keys(data.fields).length >= 4)) {
      return { state: 'REMOVED', reason: strongRemoved };
    }
    const fieldCount = Object.keys(data.fields).length;
    const looksLikeProperty = !!data.price || (!!data.address && fieldCount >= 3);
    if (looksLikeProperty) return { state: 'OK', reason: null };

    const blocked = detectBlocked(ctx.page.html, ctx.meta.get('title') ?? '');
    if (blocked) return { state: 'BLOCKED', reason: blocked };
    if (redirectedAway(ctx.page.url, ctx.page.finalUrl, (u) => this.isDetailUrl(u))) {
      return { state: 'REMOVED', reason: `redirected to ${ctx.url.pathname}` };
    }
    const weak = detectRemovedWeak(ctx.bodyText);
    if (weak) return { state: 'REMOVED', reason: weak };
    const js = detectNeedsBrowser($, ctx.page.html, ctx.bodyText);
    if (js) return { state: 'NEEDS_BROWSER', reason: js };
    return { state: 'PARSE_FAILED', reason: 'no property data found' };
  }

  // ---------- price ----------

  parsePrice($: CheerioAPI, ctx: ParseContext): ParsedPriceValue | null {
    const candidates: PriceCandidate[] = [];
    const push = (raw: string | number | null | undefined, confidence: number, source: string) => {
      const p = parseJapanesePrice(raw);
      if (!p) return;
      candidates.push({
        value: p.value,
        display: p.display,
        raw: typeof raw === 'number' ? String(raw) : clean(raw ?? '', 80),
        isRange: p.isRange,
        previous: p.previous,
        confidence: p.isRange ? Math.min(confidence, 0.85) : confidence,
        source,
      });
    };

    // 1) A selector chosen by the user wins outright.
    const custom = selectText($, [ctx.options.selectors?.price]);
    if (custom) {
      push(custom.text, 0.95, `selector:${custom.selector}`);
      if (candidates.length) return candidates[0]!;
    }

    // 2) Labelled values and structured data, cross-checked against each other.
    for (const v of ctx.labels.get('price') ?? []) push(v, this.hints.labelConfidence + 0.05, 'label:価格');

    for (const obj of ctx.jsonLd) {
      if (!ldTypes(obj).some((t) => LD_PROPERTY_TYPES.test(t))) continue;
      const offers = (Array.isArray(obj.offers) ? obj.offers[0] : obj.offers) as Record<string, unknown> | undefined;
      const currency = (offers?.priceCurrency ?? obj.priceCurrency) as string | undefined;
      if (currency && currency.toUpperCase() !== 'JPY') continue;
      const price = (offers?.price ?? offers?.lowPrice ?? obj.price) as string | number | undefined;
      if (price !== undefined) push(typeof price === 'string' && /^\d+(\.\d+)?$/.test(price) ? Number(price) : price, 0.88, 'json-ld');
    }

    for (const key of ['product:price:amount', 'og:price:amount', 'price']) {
      const m = ctx.meta.get(key);
      if (m && /^\d+(\.\d+)?$/.test(m)) push(Number(m), 0.85, `meta:${key}`);
    }
    $('[itemprop="price"]').slice(0, 3).each((_, el) => {
      const $el = $(el);
      const c = $el.attr('content');
      push(c && /^\d+(\.\d+)?$/.test(c) ? Number(c) : ($el.text() || c), 0.85, 'microdata');
    });

    // 3) Site-specific selectors, then regex fallbacks (lower confidence).
    if (candidates.length === 0) {
      const site = selectText($, this.hints.priceSelectors);
      if (site) push(site.text, this.hints.labelConfidence - 0.05, `site:${site.selector}`);
    }
    if (candidates.length === 0) {
      const m = /(?<!最多|平均|参考|想定|月々|査定)価格(?!帯|相場|査定|推移|シミュレーション|表|比較|を|の)[^\d\n]{0,12}((?:[\d.,]+億)?[\d.,]+\s*万?円?(?:\s*[~～〜→]\s*(?:[\d.,]+億)?[\d.,]+\s*万?円)?)/.exec(ctx.bodyText);
      if (m) push(m[1], 0.6, 'regex:body');
    }
    if (candidates.length === 0) {
      for (const key of ['og:title', 'title', 'description', 'og:description']) {
        const t = ctx.meta.get(key);
        if (!t) continue;
        const m = /((?:[\d.,]+億)?[\d.,]+万円)/.exec(t.normalize('NFKC'));
        if (m) {
          push(m[1], 0.55, `regex:${key}`);
          break;
        }
      }
    }
    return pickPrice(candidates);
  }

  // ---------- title ----------

  parseTitle($: CheerioAPI, ctx: ParseContext): ParsedValue | null {
    const custom = selectText($, [ctx.options.selectors?.title]);
    if (custom) return { value: custom.text, confidence: 0.95, source: `selector:${custom.selector}` };
    const site = selectText($, this.hints.titleSelectors);
    if (site && site.text.length <= 120) return { value: this.cleanTitle(site.text), confidence: 0.85, source: `site:${site.selector}` };
    const og = ctx.meta.get('og:title');
    if (og) return { value: this.cleanTitle(og), confidence: 0.75, source: 'og:title' };
    for (const obj of ctx.jsonLd) {
      if (typeof obj.name === 'string' && ldTypes(obj).some((t) => LD_PROPERTY_TYPES.test(t))) {
        return { value: clean(obj.name, 120), confidence: 0.75, source: 'json-ld' };
      }
    }
    const t = ctx.meta.get('title');
    if (t) return { value: this.cleanTitle(t), confidence: 0.6, source: 'title' };
    const project = ctx.labels.get('projectName')?.[0];
    return project ? { value: project, confidence: 0.6, source: 'label:物件名' } : null;
  }

  protected cleanTitle(raw: string): string {
    let s = raw.normalize('NFKC');
    for (const re of this.hints.titleNoise) s = s.replace(re, ' ');
    const parts = s.split(/\s*[|｜]\s*|\s+-\s+/).map((p) => p.trim()).filter(Boolean);
    return clean(parts[0] ?? s, 120);
  }

  // ---------- address ----------

  parseAddress($: CheerioAPI, ctx: ParseContext): ParsedValue | null {
    const custom = selectText($, [ctx.options.selectors?.address]);
    if (custom) return { value: custom.text, confidence: 0.95, source: `selector:${custom.selector}` };
    const label = ctx.labels.get('address')?.[0];
    if (label) return { value: label, confidence: this.hints.labelConfidence, source: 'label:所在地' };
    const site = selectText($, this.hints.addressSelectors);
    if (site) return { value: site.text, confidence: 0.85, source: `site:${site.selector}` };
    for (const obj of ctx.jsonLd) {
      const a = obj.address as unknown;
      if (typeof a === 'string' && a.length > 4) return { value: clean(a), confidence: 0.82, source: 'json-ld' };
      if (a && typeof a === 'object') {
        const o = a as Record<string, unknown>;
        const v = [o.addressRegion, o.addressLocality, o.streetAddress].filter((x) => typeof x === 'string').join('');
        if (v.length > 4) return { value: clean(v), confidence: 0.82, source: 'json-ld' };
      }
    }
    const near = /(?:所在地|住所)[：:\s]*((?:北海道|東京都|京都府|大阪府|[^\s\d、。]{2,3}県)[^\s、。]{2,40})/.exec(ctx.bodyText);
    if (near) return { value: clean(near[1]), confidence: 0.7, source: 'regex:label' };
    const any = /((?:北海道|東京都|京都府|大阪府|(?:青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄)県)[^\s、。,()（）]{2,30}[市区町村郡][^\s、。,()（）]{0,20})/.exec(ctx.bodyText);
    if (any) return { value: clean(any[1]), confidence: 0.45, source: 'regex:body' };
    return null;
  }

  // ---------- other fields ----------

  parsePropertyData(_$: CheerioAPI, ctx: ParseContext): Partial<Record<FieldKey, string>> {
    const out: Partial<Record<FieldKey, string>> = {};
    for (const key of FIELD_KEYS) {
      const v = ctx.labels.get(key)?.[0];
      if (v) out[key] = v;
    }
    return out;
  }

  protected parseImage($: CheerioAPI, ctx: ParseContext): string | null {
    for (const sel of this.hints.imageSelectors) {
      try {
        const $img = $(sel).first();
        const src = $img.attr('data-src') ?? $img.attr('src') ?? $img.attr('content');
        const abs = absoluteUrl(src, ctx.page.finalUrl);
        if (abs) return abs;
      } catch {
        // ignore
      }
    }
    const og = absoluteUrl(ctx.meta.get('og:image'), ctx.page.finalUrl);
    if (og) return og;
    for (const obj of ctx.jsonLd) {
      const img = obj.image as unknown;
      const src = typeof img === 'string' ? img : Array.isArray(img) ? img[0] : (img as Record<string, unknown> | undefined)?.url;
      const abs = absoluteUrl(typeof src === 'string' ? src : null, ctx.page.finalUrl);
      if (abs) return abs;
    }
    return null;
  }

  // ---------- normalisation / fingerprint ----------

  normalize($: CheerioAPI, result: Omit<ParseResult, 'normalizedText' | 'fingerprint'>, ctx: ParseContext): string {
    if (ctx.options.mode === 'FULL') {
      return normalizePageText(ctx.page.html, ctx.options.selectors?.content);
    }
    const lines: string[] = [];
    if (result.title) lines.push(`title: ${result.title.value}`);
    if (result.price) lines.push(`price: ${result.price.display}`);
    for (const key of FIELD_KEYS) {
      const v = result.fields[key];
      if (v) lines.push(`${key}: ${v}`);
    }
    if (result.imageUrl) lines.push(`image: ${stripQuery(result.imageUrl)}`);
    if (ctx.options.selectors?.content) {
      const c = selectText($, [ctx.options.selectors.content]);
      if (c) lines.push(`content: ${c.text}`);
    }
    return lines.join('\n');
  }

  createFingerprint(result: Omit<ParseResult, 'fingerprint'>): Fingerprint {
    const f = result.fields;
    return buildFingerprint({
      address: result.address?.value ?? f.address,
      landArea: f.landArea,
      buildingArea: f.buildingArea,
      floorArea: f.floorArea,
      layout: f.layout,
      projectName: f.projectName,
      title: result.title?.value,
      unitNumber: f.unitNumber,
      propertyCode: result.propertyCode,
      site: this.id,
      seller: f.seller,
      builtDate: f.builtDate,
      price: result.price?.value ?? null,
    });
  }
}

export function stripQuery(u: string): string {
  try {
    const x = new URL(u);
    x.search = '';
    x.hash = '';
    return x.toString();
  } catch {
    return u;
  }
}

/** Best candidate; agreeing sources raise confidence, disagreeing strong sources lower it. */
function pickPrice(candidates: PriceCandidate[]): ParsedPriceValue | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const best = { ...sorted[0]! };
  const others = sorted.slice(1).filter((c) => c.confidence >= 0.8);
  const agree = others.filter((c) => c.value === best.value).length;
  const conflict = others.some((c) => c.value !== best.value && !(c.isRange || best.isRange));
  if (conflict) {
    best.confidence = Math.min(best.confidence, 0.6);
    best.source = `${best.source}+conflict`;
  } else if (agree > 0) {
    best.confidence = Math.min(0.99, best.confidence + 0.02 * agree);
  }
  best.confidence = Math.round(best.confidence * 100) / 100;
  return best;
}
