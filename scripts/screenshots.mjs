// Local UI screenshots against the emulator stack (npm run dev must be running).
// node scripts/screenshots.mjs <outDir> [path ...]
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? 'screenshots';
const paths = process.argv.slice(3).length ? process.argv.slice(3) : ['/'];
const exe = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ executablePath: exe, headless: true });

for (const [label, viewport, mobile] of [
  ['desktop', { width: 1440, height: 900 }, false],
  ['mobile', { width: 390, height: 844 }, true],
]) {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, colorScheme: scheme });
    const page = await ctx.newPage();
    await page.goto('http://localhost:5180/');
    await page.fill('input[type=email]', 'admin@example.com');
    await page.fill('input[type=password]', 'property-watch-dev');
    await page.click('button.btn-primary');
    await page.waitForSelector('.page-head', { timeout: 15000 });
    for (const p of paths) {
      await page.goto(`http://localhost:5180${p}`);
      await page.waitForTimeout(1500);
      const name = `${label}-${scheme}-${p.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home'}.png`;
      await page.screenshot({ path: `${out}/${name}`, fullPage: true });
      console.log('saved', name);
    }
    await ctx.close();
  }
}
await browser.close();
