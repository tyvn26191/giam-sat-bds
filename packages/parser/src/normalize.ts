// Normalisation before diffing, so that timestamps, counters, ads and tracking never look
// like a change. Also a small line diff for "before / after" views.

import * as cheerio from 'cheerio';
import type { TextDiff } from '@gsb/shared';
import { stripUiNoise } from './html';

const REMOVE_TAGS = 'script,style,noscript,iframe,svg,template,link,meta,button,form,input,select,textarea,header,footer,nav,aside,video,audio,canvas,object,embed';
const HIDDEN = '[hidden],[aria-hidden="true"],[style*="display:none"],[style*="display: none"],[style*="visibility:hidden"]';
const NOISE_CLASS =
  /(^|[\s_-])(ad|ads|adv|advert|advertisement|banner|recommend|recommendation|ranking|popular|sns|share|social|tracking|analytics|gtm|cookie|modal|breadcrumb|history|related|kanren|osusume|pickup|campaign|pr|sponsor|footer|global-nav|gnav|sidebar)([\s_-]|$)/i;

// Text that changes by itself between visits.
const DYNAMIC_PATTERNS: RegExp[] = [
  /\d{1,4}[\/年.-]\d{1,2}[\/月.-]\d{1,2}日?\s*\d{1,2}:\d{2}(:\d{2})?/g, // date + time
  /\b\d{1,2}:\d{2}(:\d{2})?\b/g, // time of day
  /\d+\s*(秒|分|時間|日)前/g,
  /(閲覧数|閲覧者数|アクセス数|PV|いいね|お気に入り登録数)[:：]?\s*[\d,]+/g,
  /[\d,]+\s*人が(閲覧|検討|見て)/g,
  /\b[A-Za-z0-9_-]{24,}\b/g, // session ids / tokens
  /(sid|session|token|nonce|cb|_)=[\w-]+/gi,
];

const NOISE_LINES = /(閲覧|この物件を見た人|最近見た物件|閲覧履歴|おすすめ物件|おすすめの物件|ランキング|人気の物件|新着物件|広告|PR|Copyright|©|All Rights Reserved|ログイン|会員登録|お気に入りに追加|シェア|ツイート|LINEで送る|ページの先頭へ|資料請求|お問い合わせ)/;

export function stripDynamic(line: string): string {
  let s = line;
  for (const re of DYNAMIC_PATTERNS) s = s.replace(re, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

const BLOCK_TAGS = 'p,div,li,tr,td,th,dt,dd,h1,h2,h3,h4,h5,h6,section,article,table,ul,ol,br,dl';

/**
 * Cleaned text of the whole page (or of `contentSelector` only), one block per line,
 * deduplicated, without dynamic tokens. Used in FULL monitoring mode.
 */
export function normalizePageText(html: string, contentSelector?: string | null, maxChars = 30_000): string {
  const $ = cheerio.load(html);
  let $root: cheerio.Cheerio<any> = $('body');
  if (contentSelector) {
    try {
      const $c = $(contentSelector).first();
      if ($c.length) $root = $c;
    } catch {
      // invalid selector: fall back to body
    }
  }
  $root.find(REMOVE_TAGS).remove();
  $root.find(HIDDEN).remove();
  $root.find('*').each((_, el) => {
    const $el = $(el);
    const cls = `${$el.attr('class') ?? ''} ${$el.attr('id') ?? ''}`;
    if (NOISE_CLASS.test(cls)) $el.remove();
  });
  $root.find(BLOCK_TAGS).each((_, el) => {
    $(el).append('\n');
  });
  const seen = new Set<string>();
  const lines: string[] = [];
  let total = 0;
  for (const raw of $root.text().normalize('NFKC').split('\n')) {
    const line = stripDynamic(stripUiNoise(raw));
    if (line.length < 2 || NOISE_LINES.test(line) || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
    total += line.length + 1;
    if (total > maxChars) break;
  }
  return lines.join('\n');
}

/** Line-level diff (order-insensitive), capped for storage. */
export function textDiff(before: string, after: string, maxLines = 30, maxLen = 200): TextDiff {
  const a = before.split('\n').filter(Boolean);
  const b = after.split('\n').filter(Boolean);
  const count = (list: string[]) => {
    const m = new Map<string, number>();
    for (const l of list) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const ca = count(a);
  const cb = count(b);
  const cut = (l: string) => (l.length > maxLen ? `${l.slice(0, maxLen)}…` : l);
  const removed: string[] = [];
  const added: string[] = [];
  for (const l of a) {
    const n = cb.get(l) ?? 0;
    if (n > 0) cb.set(l, n - 1);
    else if (removed.length < maxLines) removed.push(cut(l));
  }
  for (const l of b) {
    const n = ca.get(l) ?? 0;
    if (n > 0) ca.set(l, n - 1);
    else if (added.length < maxLines) added.push(cut(l));
  }
  return { added, removed };
}
