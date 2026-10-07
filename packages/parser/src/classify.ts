// Page-state heuristics. Order matters: real property data always wins, so a CAPTCHA script
// on an inquiry form never turns a working page into BLOCKED.

import type { CheerioAPI } from 'cheerio';

const BLOCK_MARKERS: RegExp[] = [
  /g-recaptcha|recaptcha\/api|hcaptcha\.com|h-captcha|px-captcha|arkoselabs|funcaptcha/i,
  /cf-chl-|challenge-platform|cf_chl_opt|Attention Required! \| Cloudflare|Just a moment\.\.\./i,
  /_Incapsula_Resource|Incapsula incident|Request unsuccessful\. Incapsula/i,
  /Access Denied[\s\S]{0,200}Reference #|You don't have permission to access/i,
  /Pardon Our Interruption|distil_r_captcha|bot detection|are you a robot|verify you are human/i,
  /(アクセスが集中|アクセスを制限|アクセス制限|不正なアクセス|ロボットではありません|画像認証|しばらく時間をおいてから再度|自動プログラムによるアクセス)/,
];

export function detectBlocked(html: string, title: string): string | null {
  const head = `${title}\n${html.slice(0, 200_000)}`;
  for (const re of BLOCK_MARKERS) {
    const m = re.exec(head);
    if (m) return m[0].slice(0, 80);
  }
  return null;
}

const STRONG_REMOVED =
  /(掲載(を|が)?終了(しました|しております|いたしました|した物件|となりました)?|掲載期間(が|は)?終了|公開(を|が)?終了|お探しの物件(は|が)?見つかりません|お探しの物件情報は(既に)?掲載(を)?終了|この物件は(すでに|既に)?(成約|販売終了|売約)|物件が見つかりませんでした|該当する物件(は|が)?(ありません|見つかりません)|ページが見つかりません|お探しのページは見つかりません|指定されたページは存在しません)/;

/** Removal phrase in prominent places (title, headings, notices). */
export function detectRemovedStrong($: CheerioAPI): string | null {
  const prominent = [
    $('title').first().text(),
    $('h1').text(),
    $('h2').slice(0, 5).text(),
    $('[class*="error"],[class*="notice"],[class*="alert"],[class*="message"],[class*="end"],[id*="error"]').slice(0, 20).text(),
  ].join('\n');
  const m = STRONG_REMOVED.exec(prominent.normalize('NFKC'));
  return m ? m[0] : null;
}

/** Removal phrase anywhere in the body (only trusted when no price was found). */
export function detectRemovedWeak(text: string): string | null {
  const m = STRONG_REMOVED.exec(text);
  return m ? m[0] : null;
}

/** Empty JS shell: very little text plus SPA markers or a "please enable JavaScript" notice. */
export function detectNeedsBrowser($: CheerioAPI, html: string, text: string): string | null {
  const noscript = $('noscript').text();
  if (/JavaScript/i.test(noscript) && /(有効|enable|オン|ON)/i.test(noscript) && text.length < 1500) {
    return 'noscript: JavaScript required';
  }
  if (text.length < 400) {
    if (/id=["'](__next|__nuxt|app|root)["']|data-reactroot|ng-app|window\.__NUXT__|__NEXT_DATA__/i.test(html)) {
      return 'SPA shell with little text';
    }
    if ($('script[src]').length >= 3) return 'script-only page';
  }
  return null;
}

/** Redirected away from a detail page to a list/search/top page. */
export function redirectedAway(requested: string, finalUrl: string, isDetail: (u: URL) => boolean): boolean {
  try {
    const a = new URL(requested);
    const b = new URL(finalUrl);
    if (a.toString() === b.toString()) return false;
    return isDetail(a) && !isDetail(b);
  } catch {
    return false;
  }
}
