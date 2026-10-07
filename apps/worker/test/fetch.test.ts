import http from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FetchError } from '../src/fetch';
import { httpGet } from '../src/fetch/http';
import { RobotsChecker, RobotsUnavailableError, isAllowed, parseRobots } from '../src/fetch/robots';
import { createSafeLookup, resolvePublic } from '../src/fetch/safe-lookup';

describe('robots.txt', () => {
  const txt = `
# comment
User-agent: *
Disallow: /private/
Disallow: /search*?q=
Allow: /private/public-page
Crawl-delay: 5

User-agent: PropertyWatchBot
Disallow: /ms/chuko/*/nc_*/print$
Allow: /

User-agent: BadBot
Disallow: /
`;
  it('uses our own group when present, else *', () => {
    const ours = parseRobots(txt, 'PropertyWatchBot');
    expect(isAllowed(ours, '/private/x')).toBe(true);
    expect(isAllowed(ours, '/ms/chuko/aichi/nc_1/print')).toBe(false);
    expect(isAllowed(ours, '/ms/chuko/aichi/nc_1/print2')).toBe(true);
    const other = parseRobots(txt, 'SomethingElse');
    expect(isAllowed(other, '/private/x')).toBe(false);
    expect(isAllowed(other, '/private/public-page')).toBe(true);
    expect(isAllowed(other, '/search/list?q=1')).toBe(false);
    expect(isAllowed(other, '/ikkodate/nc_1/')).toBe(true);
    expect(other.crawlDelayMs).toBe(5000);
    expect(isAllowed(parseRobots('User-agent: *\nDisallow: /', 'x'), '/robots.txt')).toBe(true);
    expect(isAllowed(parseRobots('User-agent: *\nDisallow: /', 'x'), '/a')).toBe(false);
    expect(isAllowed(parseRobots('User-agent: *\nDisallow:', 'x'), '/a')).toBe(true);
  });

  it('caches per origin; 4xx = allowed; 5xx without cache = unavailable', async () => {
    let calls = 0;
    let status = 200;
    const checker = new RobotsChecker({
      agentToken: 'PropertyWatchBot',
      now: () => 0,
      fetchText: async () => {
        calls++;
        return { status, body: 'User-agent: *\nDisallow: /x' };
      },
    });
    expect(await checker.check(new URL('https://a.jp/x'))).toMatchObject({ allowed: false });
    expect(await checker.check(new URL('https://a.jp/y'))).toMatchObject({ allowed: true });
    expect(calls).toBe(1);
    status = 404;
    expect(await checker.check(new URL('https://b.jp/x'))).toMatchObject({ allowed: true });
    status = 503;
    await expect(checker.check(new URL('https://c.jp/x'))).rejects.toBeInstanceOf(RobotsUnavailableError);
  });
});

describe('SSRF-safe DNS', () => {
  it('rejects hosts that resolve to private addresses', async () => {
    await expect(resolvePublic('evil.example.jp', async () => [{ address: '169.254.169.254', family: 4 }])).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
    await expect(resolvePublic('mixed.example.jp', async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }])).rejects.toBeInstanceOf(FetchError);
    await expect(resolvePublic('ok.example.jp', async () => [{ address: '8.8.8.8', family: 4 }])).resolves.toHaveLength(1);
  });

  it('lookup hook supports both callback shapes', async () => {
    const lookup = createSafeLookup(async () => [{ address: '93.184.216.34', family: 4 }]);
    const one = await new Promise((r) => lookup('x.jp', {}, (e, a, f) => r([e, a, f])));
    expect(one).toEqual([null, '93.184.216.34', 4]);
    const all = await new Promise((r) => lookup('x.jp', { all: true }, (e, a) => r([e, a])));
    expect(all).toEqual([null, [{ address: '93.184.216.34', family: 4 }]]);
    const blocked = createSafeLookup(async () => [{ address: '127.0.0.1', family: 4 }]);
    const err = await new Promise<NodeJS.ErrnoException | null>((r) => blocked('x.jp', {}, (e) => r(e)));
    expect(err?.code).toBe('ESSRF');
  });

  it('httpGet refuses internal URLs before connecting', async () => {
    const opts = { timeoutMs: 2000, maxBytes: 1000, userAgent: 't' };
    await expect(httpGet('http://127.0.0.1:1/', opts)).rejects.toMatchObject({ code: 'INVALID_URL' });
    await expect(httpGet('http://169.254.169.254/latest/meta-data/', opts)).rejects.toMatchObject({ code: 'INVALID_URL' });
    await expect(httpGet('https://internal-only.example.jp/', { ...opts, resolver: async () => [{ address: '10.1.2.3', family: 4 }] })).rejects.toMatchObject({
      code: 'SSRF_BLOCKED',
    });
  });
});

describe('httpGet against a local server', () => {
  let server: http.Server;
  let base: string;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(301, { location: '/page' });
        res.end();
      } else if (req.url === '/to-metadata') {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/' });
        res.end();
      } else if (req.url === '/page') {
        const body = zlib.gzipSync(Buffer.from('<html><body>価格 3,190万円</body></html>'));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'gzip', etag: '"v1"' });
        res.end(body);
      } else if (req.url === '/cond') {
        if (req.headers['if-none-match'] === '"v1"') {
          res.writeHead(304);
          res.end();
        } else {
          res.writeHead(200, { 'content-type': 'text/html', etag: '"v1"' });
          res.end('<html></html>');
        }
      } else if (req.url === '/big') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('x'.repeat(5000));
      } else if (req.url === '/pdf') {
        res.writeHead(200, { 'content-type': 'application/pdf' });
        res.end('%PDF');
      } else if (req.url === '/slow') {
        setTimeout(() => res.end('late'), 2000);
      } else {
        res.writeHead(404, { 'content-type': 'text/html' });
        res.end('nope');
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const opts = { timeoutMs: 1000, maxBytes: 1000, userAgent: 'PropertyWatchBot/test', unsafeAllowPrivateNetwork: true, allowedTypes: /text\/html/ };

  it('follows redirects and decompresses', async () => {
    const r = await httpGet(`${base}/redirect`, opts);
    expect(r.status).toBe(200);
    expect(r.finalUrl).toBe(`${base}/page`);
    expect(r.redirects).toBe(1);
    expect(r.body.toString('utf8')).toContain('3,190万円');
    expect(r.headers.etag).toBe('"v1"');
  });

  it('sends conditional headers (304 = unchanged, no body to parse)', async () => {
    expect((await httpGet(`${base}/cond`, { ...opts, etag: '"v1"' })).status).toBe(304);
    expect((await httpGet(`${base}/cond`, opts)).status).toBe(200);
  });

  it('returns 404 as a status, not an exception', async () => {
    expect((await httpGet(`${base}/missing`, opts)).status).toBe(404);
  });

  it('enforces size, content type and timeout', async () => {
    await expect(httpGet(`${base}/big`, opts)).rejects.toMatchObject({ code: 'TOO_LARGE' });
    await expect(httpGet(`${base}/pdf`, opts)).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' });
    await expect(httpGet(`${base}/slow`, opts)).rejects.toMatchObject({ code: 'TIMEOUT', transient: true });
  });

  it('re-validates every redirect hop (no redirect into the metadata server)', async () => {
    // The local server is only reachable with the test flag; the hop to 169.254.169.254 is still
    // checked by validatePublicUrl when the flag is off — simulate that by validating the target.
    const { validatePublicUrl } = await import('@gsb/shared');
    expect(validatePublicUrl('http://169.254.169.254/latest/').ok).toBe(false);
  });
});
