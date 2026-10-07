import { AthomeAdapter } from './adapters/athome';
import { GenericAdapter } from './adapters/generic';
import { HomesAdapter } from './adapters/homes';
import { SuumoAdapter } from './adapters/suumo';
import type { PageInput, ParseOptions, ParseResult, PropertySiteAdapter } from './types';

/**
 * Picks the adapter for a URL. Adding a site = writing one adapter class and registering it
 * here; nothing in the worker or the web app needs to change.
 */
export class AdapterRegistry {
  private readonly adapters: PropertySiteAdapter[] = [];

  constructor(private readonly fallback: PropertySiteAdapter) {}

  register(adapter: PropertySiteAdapter): this {
    this.adapters.push(adapter);
    return this;
  }

  forUrl(url: string | URL): PropertySiteAdapter {
    let u: URL;
    try {
      u = typeof url === 'string' ? new URL(url) : url;
    } catch {
      return this.fallback;
    }
    return this.adapters.find((a) => a.canHandle(u)) ?? this.fallback;
  }

  list(): PropertySiteAdapter[] {
    return [...this.adapters, this.fallback];
  }
}

export function createDefaultRegistry(): AdapterRegistry {
  return new AdapterRegistry(new GenericAdapter())
    .register(new SuumoAdapter())
    .register(new HomesAdapter())
    .register(new AthomeAdapter());
}

export const defaultRegistry = createDefaultRegistry();

export function parseProperty(page: PageInput, options?: ParseOptions): ParseResult {
  return defaultRegistry.forUrl(page.url).parse(page, options);
}
