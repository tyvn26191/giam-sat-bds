// Switch what a mock URL returns in the local stack: node scripts/mock.mjs <url> <fixture.html|404> [status]
const [url, file, status] = process.argv.slice(2);
if (!url || !file) {
  console.log('usage: npm run dev:mock -- <url> <fixture.html | 404> [status]');
  process.exit(1);
}
const body = file === '404' ? { url, file: null, status: 404 } : { url, file, status: Number(status ?? 200) };
const r = await fetch('http://127.0.0.1:8787/dev/mock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
console.log(r.status, await r.text());
