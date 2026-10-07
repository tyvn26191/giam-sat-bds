// Known sites. Detection of the adapter happens in @gsb/parser; this is the display side.

export const SITE_IDS = ['SUUMO', 'HOMES', 'ATHOME', 'GENERIC'] as const;
export type SiteId = (typeof SITE_IDS)[number];

export const SITE_LABELS: Record<SiteId, string> = {
  SUUMO: 'SUUMO',
  HOMES: "LIFULL HOME'S",
  ATHOME: 'at home',
  GENERIC: 'Khác',
};

/** Host suffixes per site (used by the parser registry and for UI hints). */
export const SITE_HOSTS: Record<Exclude<SiteId, 'GENERIC'>, string[]> = {
  SUUMO: ['suumo.jp'],
  HOMES: ['homes.co.jp'],
  ATHOME: ['athome.co.jp'],
};

export function hostMatches(host: string, suffix: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return h === suffix || h.endsWith(`.${suffix}`);
}

export function guessSite(host: string): SiteId {
  for (const [site, suffixes] of Object.entries(SITE_HOSTS)) {
    if (suffixes.some((s) => hostMatches(host, s))) return site as SiteId;
  }
  return 'GENERIC';
}
