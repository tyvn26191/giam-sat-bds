// DOM helpers shared by all adapters.

import type { Cheerio, CheerioAPI } from 'cheerio';
import { fieldForLabel, type FieldKey } from '@gsb/shared';

type Sel = Cheerio<any>;

const UI_NOISE = [
  /\[\s*[^\]]{1,12}\s*\]/g, // "[ 地図 ]", "[ 周辺環境 ]"
  /［\s*[^］]{1,12}\s*］/g,
  /(地図を見る|周辺環境を見る|地図で確認|ローンシミュレーション|支払いシミュレーション|支払シミュレーション|ヒント|この物件の周辺環境)/g,
];

export function stripUiNoise(text: string): string {
  let s = text;
  for (const re of UI_NOISE) s = s.replace(re, ' ');
  return s;
}

export function clean(text: string | null | undefined, max = 300): string {
  if (!text) return '';
  const s = stripUiNoise(text.normalize('NFKC')).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Text of a cell with <br> as spaces and scripts removed. */
export function cellText($el: Sel): string {
  const c = $el.clone();
  c.find('script,style,noscript,button').remove();
  c.find('br').replaceWith(' ');
  return clean(c.text());
}

/**
 * Collect "label → value" pairs from 物件概要 tables (th/td), definition lists (dt/dd) and
 * "所在地：…" lines. Values are kept in document order per field.
 */
export function extractLabelPairs($: CheerioAPI): Map<FieldKey | 'price', string[]> {
  const out = new Map<FieldKey | 'price', string[]>();
  const add = (label: string, value: string) => {
    const key = fieldForLabel(label);
    if (!key || !value || value === '-' || value === '－' || value === '―') return;
    const list = out.get(key) ?? [];
    if (!list.includes(value)) list.push(value);
    out.set(key, list);
  };

  $('th').each((_, th) => {
    const $th = $(th);
    const $td = $th.nextAll('td').first();
    if ($td.length) add(cellText($th), cellText($td));
  });
  $('dt').each((_, dt) => {
    const $dt = $(dt);
    const $dd = $dt.nextAll('dd').first();
    if ($dd.length) add(cellText($dt), cellText($dd));
  });
  // Label/value pairs written as sibling elements with explicit classes, e.g.
  // <div class="label">価格</div><div class="value">3,190万円</div>
  $('[class*="label"],[class*="Label"],[class*="title"],[class*="head"]').each((_, el) => {
    const $el = $(el);
    if ($el.children().length > 2) return;
    const label = cellText($el);
    if (label.length > 14 || !fieldForLabel(label)) return;
    const $next = $el.next();
    if ($next.length && !/^(th|dt)$/i.test(($next.get(0) as { tagName?: string })?.tagName ?? '')) add(label, cellText($next));
  });
  // "所在地：愛知県…" in a single element
  $('li,p,span,div').each((_, el) => {
    const $el = $(el);
    if ($el.children().length > 3) return;
    const t = cellText($el);
    if (t.length > 120) return;
    const m = /^([^：:]{1,12})[：:]\s*(.+)$/.exec(t);
    if (m) add(m[1]!, clean(m[2]!));
  });
  return out;
}

export function extractMeta($: CheerioAPI): Map<string, string> {
  const meta = new Map<string, string>();
  $('meta').each((_, el) => {
    const $el = $(el);
    const key = ($el.attr('property') ?? $el.attr('name') ?? $el.attr('itemprop') ?? '').toLowerCase();
    const content = $el.attr('content');
    if (key && content && !meta.has(key)) meta.set(key, content.trim());
  });
  const title = $('title').first().text().trim();
  if (title) meta.set('title', title);
  return meta;
}

export function extractJsonLd($: CheerioAPI): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const visit = (node: unknown, depth = 0) => {
    if (depth > 6 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((n) => visit(n, depth + 1));
      return;
    }
    const obj = node as Record<string, unknown>;
    out.push(obj);
    if (obj['@graph']) visit(obj['@graph'], depth + 1);
    if (obj.mainEntity) visit(obj.mainEntity, depth + 1);
    if (obj.itemOffered) visit(obj.itemOffered, depth + 1);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw || raw.length > 500_000) return;
    try {
      visit(JSON.parse(raw));
    } catch {
      // Broken JSON-LD is common; ignore it.
    }
  });
  return out;
}

export function ldTypes(obj: Record<string, unknown>): string[] {
  const t = obj['@type'];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string');
}

/** Visible text of the body (scripts/styles removed), single-spaced. */
export function bodyText($: CheerioAPI): string {
  const $b = $('body').clone();
  $b.find('script,style,noscript,template,svg').remove();
  return $b.text().replace(/\s+/g, ' ').trim();
}

export function absoluteUrl(src: string | undefined | null, base: string): string | null {
  if (!src) return null;
  try {
    const u = new URL(src.trim(), base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** First matching selector's text, ignoring invalid selectors. */
export function selectText($: CheerioAPI, selectors: (string | null | undefined)[]): { text: string; selector: string } | null {
  for (const sel of selectors) {
    if (!sel) continue;
    try {
      const $el = $(sel).first();
      if ($el.length) {
        const text = cellText($el);
        if (text) return { text, selector: sel };
      }
    } catch {
      // invalid CSS selector (user input): skip
    }
  }
  return null;
}
