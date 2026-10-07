# Property Watch — Giám sát bất động sản Nhật Bản

Nhập URL một căn nhà trên **SUUMO, LIFULL HOME'S, at home** hoặc bất kỳ trang bất động sản nào. Hệ thống tự kiểm
tra định kỳ (mặc định 15 phút; 30/60 phút), phát hiện **giảm/tăng giá** và thay đổi thông tin quan trọng, lưu lịch
sử, rồi báo ngay qua **Telegram** (email là kênh phụ).

```
🔴 GIÁ NHÀ GIẢM

Tên: 西尾市○○町 1号棟
Site: SUUMO
Giá cũ: 3,190万円
Giá mới: 3,090万円
Giảm: 100万円
Tỷ lệ: -3.13%
Thời gian: 2026/10/08 06:15
[Open Property] [Xem lịch sử]
```

Stack: React + Vite + TypeScript (Firebase Hosting) · Cloud Firestore · Firebase Auth (email/mật khẩu, Google) ·
Node.js 22 + TypeScript trên **Cloud Run** · **Cloud Scheduler** · Secret Manager · Playwright chỉ làm tầng dự phòng.

## Trạng thái theo giai đoạn

| Giai đoạn | Nội dung | Trạng thái |
|---|---|---|
| 1 | Firebase, Auth + phê duyệt tài khoản, Firestore schema + Rules, Dashboard, Thêm URL (Test URL → preview → lưu) | ✅ |
| 2 | Monitoring engine 2 tầng, lịch 15/30/60', retry 30s/2'/10', backoff, khóa chạy, lịch sử Firestore | ✅ |
| 3 | GenericAdapter + SUUMO / HOME'S / at home adapters, Telegram (+ Email SMTP/Resend/SendGrid/Mailgun) | ✅ |
| 4 | Lịch sử & biểu đồ giá, thống kê giảm giá, fingerprint "possible same property", snapshot + diff, ảnh chụp khi thay đổi quan trọng (Cloud Storage), tối ưu chi phí | ✅ |
| Kiểm thử | 163 unit/integration test + 11 test Security Rules (emulator) + chạy thử end-to-end trên emulator | ✅ |

Đã chạy thử trọn luồng trên emulator với "site giả": thêm URL SUUMO → baseline 3,190万円 → giảm 3,090万円
(PRICE_DECREASE, -100万円, -3.13%) → 2,990万円 (đạt ngưỡng ≤ 3,000万円 → tin "🎯 ĐẠT NGƯỠNG GIÁ").
**Chưa** chạy với website thật và **chưa** deploy lên Google Cloud (cần project + billing của bạn) — xem
[Hạn chế](#hạn-chế-đã-biết).

## Kiến trúc

```
Web (React, Firebase Hosting) ──/api/**──► Cloud Run worker ──HTTP──► SUUMO / HOME'S / at home / khác
        │ Firestore SDK (Rules)                  ▲  │ Playwright (chỉ khi cần JS)
        ▼                                         │  ├─► Telegram Bot API / Email provider
   Cloud Firestore ◄── Admin SDK ─────────────────┘  └─► Cloud Storage (ảnh chụp, tùy chọn)
                          Cloud Scheduler (5') ──OIDC──► /tasks/run-due
```

Chi tiết (luồng kiểm tra, retry, phân loại thay đổi, chống spam, adapter, fingerprint, **database schema**):
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Điểm chính:

- **Monitoring 2 tầng**: HTTP fetch + parser trước; Playwright chỉ khi trang trả về khung JavaScript rỗng, và nhớ
  URL nào cần trình duyệt. Có timeout, retry, exponential backoff, giới hạn đồng thời toàn cục + **mỗi domain 1–2
  request**, giãn cách 2–3 s + jitter, tôn trọng robots.txt / Crawl-delay / 429 Retry-After.
- **Không vượt** CAPTCHA, login wall, bot protection → `BLOCKED` (không bao giờ nhầm thành `REMOVED`).
- **Giá chuẩn hóa** về số nguyên JPY: `3,190万円`, `3億1,900万円`, `¥31,900,000`, `31,900,000円`, `29,800万円`,
  `1.5億円`, `2,980万円～3,280万円` (価格帯), `3,190万円→3,090万円`…
- **Chỉ báo thay đổi có ý nghĩa**: chuẩn hóa HTML (bỏ script/style/quảng cáo/gợi ý/bộ đếm/timestamp/session id),
  hash theo vùng (giá, trường quan trọng, nội dung, ảnh), mức độ CRITICAL/HIGH/MEDIUM/LOW, chống gửi trùng 3 lớp.
- **Không tự tin giả**: mỗi trường có điểm tin cậy; giá < 0.7 hoặc các nguồn mâu thuẫn → `NEEDS_REVIEW`, không báo.
- **SiteAdapter** mở rộng được: thêm site = 1 class + fixture + test.

## Cấu trúc thư mục

```
apps/
  web/                  React SPA (pages: Dashboard, Thêm URL, Chi tiết, Sửa, Cài đặt, Logs)
  worker/               Cloud Run service
    src/engine/         observe (fetch 2 tầng) · evaluate (thuần) · check · runner · notify · matching
    src/fetch/          http (SSRF-safe) · browser (Playwright) · robots · mock (dev)
    src/store/          FirestoreStore · MemoryStore (test)
    src/http/           server · api · auth (Firebase ID token, OIDC)
    Dockerfile
packages/
  shared/               types, giá Nhật, URL/SSRF, fingerprint, lịch, CSV, giờ Tokyo
  parser/               PropertySiteAdapter, BaseAdapter(Generic), SUUMO, HOME'S, at home + fixtures/*.html
  notifications/        Telegram, EmailProvider (SMTP/Resend/SendGrid/Mailgun), định dạng tin
tests/rules/            Firestore Security Rules tests
deploy/                 01…05 scripts gcloud/firebase, cloudbuild, set-role.mjs, env.sh.example
docs/                   ARCHITECTURE · DEPLOYMENT · COST · SECURITY
scripts/                dev stack (emulator + worker giả lập + web), mock, screenshots
firestore.rules · firestore.indexes.json · firebase.json · docker-compose.yml · .env.example
```

## Chạy thử trên máy (không cần Google Cloud, không chạm website thật)

Yêu cầu: Node.js ≥ 20.11 (khuyên 22), Java ≥ 21 (Firebase emulator).

```bash
npm ci
```

```bash
npm run dev
```

Lệnh này chạy Auth + Firestore emulator, worker (chế độ **site giả** đọc `packages/parser/fixtures`, thông báo
**dry-run** in ra console, tick 60 s thay Cloud Scheduler) và web ở http://localhost:5180.
Tài khoản thử trên emulator: `admin@example.com` (mật khẩu trong `scripts/dev-stack.mjs`).

Thử luồng giảm giá: Thêm URL `https://suumo.jp/ikkodate/aichi/sc_nishio/nc_76543210/` → Test URL → Add Monitor, rồi:

```bash
npm run dev:mock -- https://suumo.jp/ikkodate/aichi/sc_nishio/nc_76543210/ suumo-price-down.html
```

và bấm **Check now** (hoặc chờ tick). Các URL giả khác: `packages/parser/fixtures/mock-routes.json`
(HOME'S, at home, at home bị chặn, trang generic JSON-LD). `404` thay cho tên file để giả lập tin bị gỡ.
Muốn nhận Telegram thật khi chạy local: tạo `.env` ở thư mục gốc với `TELEGRAM_BOT_TOKEN=…`.

## Lệnh

| Lệnh | Việc |
|---|---|
| `npm run dev` | Emulator + worker (mock) + web |
| `npm run typecheck` | TypeScript toàn repo |
| `npm test` | Unit + integration (parser, giá, fingerprint, engine, notifications, fetch/SSRF, API) |
| `npm run test:rules` | Firestore Rules trong emulator |
| `npm run build` | Build web (`apps/web/dist`) + bundle worker (`apps/worker/dist`) |
| `npm run check` | typecheck + test + build |

## Kiểm thử

- `packages/shared/test` — chuẩn hóa giá (`3,190万円`, `3億1,900万円`, `¥31,900,000`, `31,900,000円`…),
  PRICE_DECREASE/INCREASE/UNCHANGED/UNKNOWN, SSRF (localhost, 169.254.169.254, IPv6, dạng số thập phân/hex…),
  fingerprint (đăng lại = cùng căn; khác 号棟/khác thành phố/chỉ có giá = không).
- `packages/parser/test` — fixtures SUUMO/HOME'S/at home/generic: giá, địa chỉ, mã, trường; REMOVED (掲載終了,
  redirect), BLOCKED (CAPTCHA, Cloudflare), NEEDS_BROWSER, PARSE_FAILED, selector thủ công, Shift_JIS, bỏ nhiễu.
- `packages/notifications/test` — định dạng tin Telegram đúng mẫu, escape HTML, 429 retry, email providers.
- `apps/worker/test` — engine end-to-end với store/fetcher giả: baseline, giảm giá → đúng 1 tin, không lặp,
  chống ghi đè đồng thời, cảnh báo ngưỡng, REMOVED cần 2 lần xác nhận, BLOCKED ≠ REMOVED, retry 30s/2'/10' → ERROR,
  429, robots.txt, đăng lại; HTTP thật với server local (redirect, gzip, 304, timeout, giới hạn kích thước);
  API (quyền, SSRF, trùng URL, giới hạn, rate limit).
- `tests/rules` — Security Rules (đọc/ghi đúng chủ, chặn trường do worker quản lý, validate cài đặt).

## Biến môi trường

Toàn bộ biến của worker kèm giải thích: [.env.example](.env.example). Web: [apps/web/.env.example](apps/web/.env.example).
Cấu hình triển khai: [deploy/env.sh.example](deploy/env.sh.example).

## Triển khai

Hướng dẫn đầy đủ, copy/paste từng lệnh (Firebase project, API, Firestore, Auth, Secret Manager, Telegram Bot,
Email, Cloud Run, Cloud Scheduler, Hosting, cấp quyền): **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

```
deploy/01-setup-project.sh → 02-secrets.sh → 03-deploy-worker.sh → 04-scheduler.sh → 05-deploy-web.sh
```

## Chi phí

[docs/COST.md](docs/COST.md) — tóm tắt/tháng: 10 URL × 15' ≈ 0.3 USD (trong free tier) · 30 URL × 15' ≈ 0.3–1.3 USD ·
100 URL × 15' ≈ 3–14 USD (không free tier: lần lượt ~2, ~3–6.5, ~9–20 USD). Playwright tốn hơn nhiều nên chỉ là fallback.

## Bảo mật

[docs/SECURITY.md](docs/SECURITY.md) — Secret Manager, chống SSRF (kiểm tra URL + DNS pinning + mọi redirect),
Rules tối thiểu quyền, OIDC cho Scheduler, CSP chặt, robots.txt/không vượt CAPTCHA.

## Giả định (assumptions)

- Mỗi người dùng chỉ thấy property của mình; admin thấy tất cả + cấu hình hệ thống. Người đăng ký mới phải được cấp
  quyền (tránh người lạ dùng worker để tải trang).
- Tick Cloud Scheduler 5 phút; property "đến hạn" khi `nextCheckAt ≤ now + 2.5'` → khoảng cách thực tế bằng chu kỳ đã
  chọn (sai số trong một tick), jitter ±90 s đối xứng nên trung bình vẫn đúng 15'.
- Ngưỡng "giảm ≥ X円 / ≥ Y%" tính cho **một lần** đổi giá; "giá ≤ X" báo **một lần** khi vượt ngưỡng (báo lại nếu giá
  lên trên ngưỡng rồi xuống lại).
- 価格帯 (nhiều căn): dùng giá thấp nhất, độ tin cậy ≤ 0.85.
- REMOVED cần 2 lần quan sát liên tiếp; BLOCKED cần 2 lần (trừ robots.txt cấm). URL chưa từng đọc được thì hiện lỗi
  ngay, không gửi thông báo.
- Đổi URL của property = mốc so sánh mới (lịch sử cũ giữ nguyên).
- "Pause all" chỉ bật lại đúng những URL nó đã tạm dừng.
- UI tiếng Việt; dữ liệu BĐS giữ nguyên tiếng Nhật; giờ hiển thị Asia/Tokyo (đổi được); tiền JPY.
- Telegram dùng chung 1 bot (token ở Secret Manager); mỗi người tự nhập chat ID của mình.

## Hạn chế đã biết

- **Selector/nhãn của SUUMO, HOME'S, at home được viết theo cấu trúc phổ biến và kiểm thử trên HTML mẫu tự tạo,
  chưa đối chiếu với trang thật.** Parser chủ yếu dựa vào bảng nhãn 物件概要 (価格, 所在地, 土地面積…) nên chịu được
  thay đổi giao diện, nhưng cần chạy "Test URL" với vài URL thật và bổ sung fixture/selector nếu site khác mẫu.
- **Điều khoản sử dụng**: nhiều cổng BĐS Nhật cấm thu thập dữ liệu tự động trong 利用規約; hệ thống tôn trọng
  robots.txt và giữ tải rất thấp nhưng **không** tự kiểm tra ToS — bạn cần tự xác nhận trước khi theo dõi một site.
- Site có bot protection (at home được biết là hay hiện trang xác minh) sẽ ở trạng thái `BLOCKED`; đó là chủ đích,
  không có cơ chế vượt. Fallback hợp lệ: theo dõi cùng căn trên site khác (fingerprint sẽ liên kết), hoặc giãn chu kỳ.
- XPath thủ công chưa hỗ trợ (chỉ CSS selector).
- Không crawl trang danh sách/tìm kiếm để tự tìm tin đăng lại — chỉ liên kết khi bạn thêm URL mới.
- Rate limit theo domain tính trong từng instance Cloud Run (max 2 instance, tick có khóa nên chỉ 1 instance chạy
  lịch; "Check now" có thể chạy song song ở instance khác).
- Firebase Hosting → Cloud Run giới hạn 60 s/request: "Run check now" xử lý trong ~40 s, phần còn lại vào tick sau.
- Chưa build/deploy image thật trên Google Cloud trong phiên phát triển này (máy không có Docker); các bước image
  đã được mô phỏng (cài production deps + chạy bundle với emulator).

## Roadmap

1. Chạy "Test URL" với URL thật của từng site → bổ sung fixture & selector (adapter version 2).
2. Thêm kênh LINE Messaging API, Discord, Webhook (giao diện `NotificationChannel` đã sẵn).
3. Adapter mới: Yahoo!不動産, 三井のリハウス, 東急リバブル, レインズ(nếu được phép)…
4. Liên kết Telegram bằng mã xác nhận (`/start <code>`) thay vì tự nhập chat ID; lệnh bot `/list`, `/pause`.
5. XPath; chọn vùng theo dõi bằng cách click trên ảnh chụp trang.
6. Digest hằng ngày; giờ yên lặng (quiet hours).
7. Cloud Tasks cho hàng đợi lớn (500+ URL), tách service renderer Playwright riêng.
8. PWA + Web Push.
