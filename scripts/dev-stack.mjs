// Started by scripts/dev.mjs inside `firebase emulators:exec` (emulator env vars are set).
// Worker: mock sites from packages/parser/fixtures, dry-run notifications (unless .env has a
// real TELEGRAM_BOT_TOKEN), internal 60 s tick instead of Cloud Scheduler. Web: emulator mode.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const DEV_ADMIN = { email: 'admin@example.com', password: 'property-watch-dev' }; // emulator-only test account

function dotenv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const local = dotenv(path.join(root, '.env'));
const workerEnv = {
  ...process.env,
  ...local,
  PORT: '8787',
  GOOGLE_CLOUD_PROJECT: 'demo-gsb',
  MOCK_FETCH_DIR: local.MOCK_FETCH_DIR === 'off' ? '' : path.join(root, 'packages/parser/fixtures'),
  NOTIFY_DRY_RUN: local.TELEGRAM_BOT_TOKEN ? (local.NOTIFY_DRY_RUN ?? 'false') : 'true',
  TASKS_AUTH: 'none',
  DEV_TICK_SECONDS: local.DEV_TICK_SECONDS ?? '60',
  ADMIN_EMAILS: local.ADMIN_EMAILS ?? DEV_ADMIN.email,
  MEMBER_EMAILS: local.MEMBER_EMAILS ?? '@example.com',
  CORS_ORIGINS: 'http://localhost:5180',
  APP_URL: local.APP_URL ?? 'http://localhost:5180',
  LOG_CHECKS: 'all',
};
delete workerEnv.K_SERVICE;

const procs = [];
const run = (name, args, env) => {
  const p = spawn('npm', args, { cwd: root, env, stdio: 'inherit', shell: true });
  p.on('exit', (code) => {
    console.log(`[dev] ${name} exited (${code})`);
    for (const q of procs) if (q !== p) q.kill();
    process.exit(code ?? 0);
  });
  procs.push(p);
  return p;
};

async function waitFor(url, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timeout waiting for ${url}`);
}

async function seedAdmin() {
  const host = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9199'}`;
  const r = await fetch(`${host}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...DEV_ADMIN, returnSecureToken: true }),
  });
  const data = await r.json();
  if (!data.localId) return; // already exists
  await fetch(`${host}/identitytoolkit.googleapis.com/v1/projects/demo-gsb/accounts:update`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ localId: data.localId, emailVerified: true, customAttributes: JSON.stringify({ role: 'admin' }) }),
  });
  console.log(`[dev] emulator admin account: ${DEV_ADMIN.email} (password in scripts/dev-stack.mjs)`);
}

run('worker', ['run', 'dev', '-w', '@gsb/worker'], workerEnv);
await waitFor('http://127.0.0.1:8787/healthz');
await seedAdmin();
run('web', ['run', 'dev', '-w', '@gsb/web'], { ...process.env, VITE_USE_EMULATOR: '1' });
console.log('[dev] web: http://localhost:5180  ·  worker: http://127.0.0.1:8787');
console.log('[dev] simulate a price drop: npm run dev:mock -- https://suumo.jp/ikkodate/aichi/sc_nishio/nc_76543210/ suumo-price-down.html');
