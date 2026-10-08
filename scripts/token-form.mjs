// One-shot local form (http://127.0.0.1:8899) to store the Telegram bot token in Secret Manager
// with the gcloud of this environment. Listens on loopback only, never logs the token, exits
// after a successful save. Usage: GCLOUD=<path to gcloud.cmd> node scripts/token-form.mjs
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const PROJECT = process.env.PROJECT_ID ?? 'giam-sat-bds-1008601';
const REGION = 'asia-northeast1';
const SA = `gsb-worker@${PROJECT}.iam.gserviceaccount.com`;
const GCLOUD = process.env.GCLOUD ?? 'gcloud';
const csrf = randomBytes(16).toString('hex');

const gcloud = (args) => execFileSync(GCLOUD, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: true, encoding: 'utf8' });

const page = (body) => `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Telegram token</title><style>body{font-family:system-ui,sans-serif;max-width:520px;margin:48px auto;padding:0 16px;line-height:1.5}
input{width:100%;padding:10px;font-size:16px;box-sizing:border-box}button{margin-top:12px;padding:10px 18px;font-size:16px}
.ok{color:#18794e}.err{color:#b42318}</style></head><body>${body}</body></html>`;

const form = (msg = '') => page(`<h2>Lưu Telegram bot token</h2>
<p>Dán token BotFather gửi (dạng <code>123456789:AA…</code>). Token được lưu vào Secret Manager của project <b>${PROJECT}</b>, không lưu ở đâu khác.</p>
${msg}<form method="post"><input type="hidden" name="csrf" value="${csrf}"><input name="token" type="password" autocomplete="off" autofocus placeholder="123456789:AA..."><button>Lưu token</button></form>`);

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  if (req.method === 'GET') return res.end(form());
  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 4096) req.destroy();
  });
  req.on('end', () => {
    const p = new URLSearchParams(body);
    const token = (p.get('token') ?? '').trim();
    if (p.get('csrf') !== csrf) return res.end(form('<p class="err">Phiên không hợp lệ, tải lại trang.</p>'));
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) return res.end(form('<p class="err">Token không đúng dạng 123456789:AA… — kiểm tra lại tin nhắn của @BotFather.</p>'));
    const dir = mkdtempSync(path.join(os.tmpdir(), 'gsb-'));
    const file = path.join(dir, 't');
    try {
      writeFileSync(file, token);
      let exists = true;
      try {
        gcloud(['secrets', 'describe', 'TELEGRAM_BOT_TOKEN', '--project', PROJECT]);
      } catch {
        exists = false;
      }
      if (exists) gcloud(['secrets', 'versions', 'add', 'TELEGRAM_BOT_TOKEN', '--project', PROJECT, `--data-file=${file}`]);
      else gcloud(['secrets', 'create', 'TELEGRAM_BOT_TOKEN', '--project', PROJECT, '--replication-policy=automatic', `--data-file=${file}`]);
    } catch (e) {
      console.error('save failed:', String(e.stderr ?? e.message).split('\n')[0]);
      return res.end(form('<p class="err">Lưu thất bại — báo lại cho Claude.</p>'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    res.end(page('<h2 class="ok">✅ Đã lưu token</h2><p>Đang gắn token vào worker (khoảng 30 giây). Bạn có thể đóng trang này và quay lại Claude.</p>'));
    console.log('token stored; attaching to worker…');
    try {
      gcloud(['secrets', 'add-iam-policy-binding', 'TELEGRAM_BOT_TOKEN', '--project', PROJECT, `--member=serviceAccount:${SA}`, '--role=roles/secretmanager.secretAccessor']);
      gcloud(['run', 'services', 'update', 'gsb-worker', '--project', PROJECT, '--region', REGION, '--update-secrets=TELEGRAM_BOT_TOKEN=TELEGRAM_BOT_TOKEN:latest']);
      console.log('DONE: worker updated');
    } catch (e) {
      console.error('attach failed:', String(e.stderr ?? e.message).split('\n')[0]);
    }
    server.close();
  });
});
server.listen(8899, '127.0.0.1', () => console.log('open http://127.0.0.1:8899'));
