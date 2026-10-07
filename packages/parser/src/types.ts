import type { CheerioAPI } from 'cheerio';
import type {
  Confidence,
  CustomSelectors,
  FetchMethod,
  FieldKey,
  Fingerprint,
  MonitorMode,
  SiteId,
} from '@gsb/shared';

/** A fetched page handed to an adapter. */
export interface PageInput {
  url: string;
  finalUrl: string;
  status: number;
  html: string;
  method: FetchMethod;
}

export interface ParseOptions {
  mode?: MonitorMode;
  selectors?: CustomSelectors | null;
}

/**
 * OK            property data found
 * REMOVED       listing ended / not found page / redirected to a search page
 * BLOCKED       CAPTCHA / bot wall / access denied — never bypassed
 * NEEDS_BROWSER page is rendered by JavaScript; plain HTTP got an empty shell
 * PARSE_FAILED  page loaded but no property data recognised (layout changed?)
 */
export type PageState = 'OK' | 'REMOVED' | 'BLOCKED' | 'NEEDS_BROWSER' | 'PARSE_FAILED';

export interface ParsedValue<T = string> {
  value: T;
  confidence: number;
  source: string;
}

export interface ParsedPriceValue extends ParsedValue<number> {
  display: string;
  raw: string;
  isRange: boolean;
  previous: number | null;
}

export interface ParseResult {
  site: SiteId;
  parser: string;
  state: PageState;
  stateReason: string | null;
  title: ParsedValue | null;
  price: ParsedPriceValue | null;
  address: ParsedValue | null;
  propertyCode: string | null;
  imageUrl: string | null;
  fields: Partial<Record<FieldKey, string>>;
  confidence: Confidence;
  needsReview: boolean;
  reviewReasons: string[];
  /** Text used for change detection (important fields, or the cleaned page in FULL mode). */
  normalizedText: string;
  fingerprint: Fingerprint;
}

/** Facts extracted once per page and shared by the parse* steps. */
export interface ParseContext {
  page: PageInput;
  url: URL;
  options: ParseOptions;
  labels: Map<FieldKey | 'price', string[]>;
  jsonLd: Record<string, unknown>[];
  meta: Map<string, string>;
  bodyText: string;
}

export interface FetchedPage {
  url: string;
  finalUrl: string;
  status: number;
  html: string;
  headers: Record<string, string>;
  method: FetchMethod;
  durationMs: number;
}

/**
 * One adapter per site. Everything has a generic default in BaseAdapter, so a new site only
 * overrides what differs (host match, ID in the URL, selectors, removal phrases).
 */
export interface PropertySiteAdapter {
  readonly id: SiteId;
  readonly name: string;
  readonly version: number;
  canHandle(url: URL): boolean;
  /** Optional site-specific fetch (e.g. an official API). Default: the worker's HTTP → browser pipeline. */
  fetch?(url: string): Promise<FetchedPage>;
  /** Whether plain HTTP is known not to work for this site (skip straight to the browser tier). */
  prefersBrowser?(url: URL): boolean;
  parse(page: PageInput, options?: ParseOptions): ParseResult;
  parsePrice($: CheerioAPI, ctx: ParseContext): ParsedPriceValue | null;
  parseTitle($: CheerioAPI, ctx: ParseContext): ParsedValue | null;
  parseAddress($: CheerioAPI, ctx: ParseContext): ParsedValue | null;
  parsePropertyData($: CheerioAPI, ctx: ParseContext): Partial<Record<FieldKey, string>>;
  extractPropertyId(url: URL, $?: CheerioAPI, ctx?: ParseContext): string | null;
  normalize($: CheerioAPI, result: Omit<ParseResult, 'normalizedText' | 'fingerprint'>, ctx: ParseContext): string;
  createFingerprint(result: Omit<ParseResult, 'fingerprint'>): Fingerprint;
}
