// Development-only fake internet: serves fixture HTML for configured URLs so the whole flow
// (add → check → price drop → notification) can be tried without touching real sites.
// Enabled with MOCK_FETCH_DIR; refused on Cloud Run (K_SERVICE set).

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { HttpResponse } from './http';

export interface MockRoute {
  file: string | null;
  status: number;
}

export class MockSites {
  private readonly routes = new Map<string, MockRoute>();

  constructor(private readonly dir: string) {
    const manifest = path.join(dir, 'mock-routes.json');
    if (existsSync(manifest)) {
      const data = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, Partial<MockRoute>>;
      for (const [url, r] of Object.entries(data)) this.routes.set(url, { file: r.file ?? null, status: r.status ?? 200 });
    }
  }

  set(url: string, route: MockRoute): void {
    if (route.file && (route.file.includes('..') || path.isAbsolute(route.file))) throw new Error('invalid fixture name');
    this.routes.set(url, route);
  }

  list(): Record<string, MockRoute> {
    return Object.fromEntries(this.routes);
  }

  get(url: string): HttpResponse {
    const route = this.routes.get(url);
    const status = route ? route.status : 404;
    let html = '<html><head><title>404 Not Found</title></head><body><h1>ページが見つかりません</h1></body></html>';
    if (route?.file) html = readFileSync(path.join(this.dir, route.file), 'utf8');
    return {
      url,
      finalUrl: url,
      status,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: Buffer.from(html, 'utf8'),
      contentType: 'text/html; charset=utf-8',
      durationMs: 5,
      redirects: 0,
    };
  }
}
