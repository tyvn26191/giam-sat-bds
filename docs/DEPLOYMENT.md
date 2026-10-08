# Triển khai lên Google Cloud / Firebase

Khuyến nghị chạy toàn bộ lệnh trong **Google Cloud Shell** (https://shell.cloud.google.com) — đã có sẵn
`gcloud`, `node`, `git`, `curl`. Mọi lệnh dưới đây copy/paste được.

> Cloud Run, Cloud Scheduler và Secret Manager cần dự án ở gói **Blaze (trả theo dùng)**. Với 10–30 URL chi phí
> thường nằm trong free tier (xem `docs/COST.md`), nhưng hãy **đặt cảnh báo ngân sách** (bước 1).

## 0. Lấy mã nguồn

```bash
git clone https://github.com/tyvn26191/giam-sat-bds.git
```

```bash
cd giam-sat-bds && npm ci --no-audit --no-fund
```

## 1. Firebase project

1. https://console.firebase.google.com → **Add project** (vd. `giam-sat-bds-123`). Google Analytics: không cần.
2. ⚙️ Project settings → **Usage and billing** → chuyển sang **Blaze**.
3. Google Cloud Console → Billing → **Budgets & alerts** → tạo budget (vd. 5 USD/tháng, cảnh báo 50/90/100%).

## 2. Cấu hình triển khai

```bash
cp deploy/env.sh.example deploy/env.sh
```

```bash
nano deploy/env.sh
```

Điền ít nhất `PROJECT_ID` và `ADMIN_EMAILS` (email Google bạn sẽ dùng để đăng nhập). `ENABLE_BROWSER="true"` bật
tầng Playwright (image lớn hơn, 2 GiB RAM khi chạy). Muốn lưu ảnh chụp khi có thay đổi quan trọng thì đặt
`ARTIFACT_BUCKET="<PROJECT_ID>-gsb-artifacts"`.

## 3. Bật API, Firestore, service account, IAM, TTL

```bash
./deploy/01-setup-project.sh
```

Script tạo: Firestore Native ở `asia-northeast1` (Tokyo), Artifact Registry `gsb` (giữ 3 image gần nhất),
service account `gsb-worker` (Firestore user, Firebase Auth admin, log writer) và `gsb-scheduler` (chỉ để ký OIDC),
TTL `expireAt` cho `monitorLogs`/`notificationLogs`/`monitorRuns`, bucket tùy chọn (xóa file sau 90 ngày).

## 4. Authentication

Firebase console → **Authentication** → Get started:

- **Sign-in method** → bật **Email/Password** và **Google** (chọn support email).
- **Settings → Authorized domains**: `<PROJECT_ID>.web.app` và `<PROJECT_ID>.firebaseapp.com` có sẵn.

Người dùng mới đăng ký vẫn phải được cấp quyền (admin/member) mới dùng được — xem bước 10.

## 5. Telegram Bot

1. Mở Telegram, chat với **@BotFather** → `/newbot` → đặt tên → username kết thúc bằng `bot`.
2. BotFather trả về **BOT_TOKEN** dạng `123456789:AA…` — giữ bí mật, sẽ nhập ở bước 7.
3. Mở chat với bot vừa tạo và bấm **Start** (bot chỉ nhắn được cho người đã Start).
4. Lấy **CHAT_ID** của bạn: nhắn bất kỳ cho bot rồi mở (thay `<BOT_TOKEN>`):

   ```bash
   curl -s "https://api.telegram.org/bot<BOT_TOKEN>/getUpdates" | grep -o '"chat":{"id":-\?[0-9]*' | head -1
   ```

   Hoặc nhắn cho `@userinfobot`. Nhận vào group: thêm bot vào group, nhắn 1 tin trong group, chạy lại lệnh trên
   (ID group là số âm, thường bắt đầu bằng `-100`). CHAT_ID nhập trong web: **Cài đặt → Telegram**.

## 6. Email (tùy chọn — hệ thống vẫn chạy chỉ với Telegram)

Trong `deploy/env.sh`:

| Provider | Biến | Secret (bước 7) |
|---|---|---|
| Gmail SMTP | `EMAIL_PROVIDER="smtp"`, `SMTP_HOST="smtp.gmail.com"`, `SMTP_PORT="465"`, `SMTP_USER="you@gmail.com"`, `EMAIL_FROM="you@gmail.com"` | App password (Google Account → Security → App passwords) |
| Resend | `EMAIL_PROVIDER="resend"`, `EMAIL_FROM="Watch <watch@your-domain>"` | `RESEND_API_KEY` |
| SendGrid | `EMAIL_PROVIDER="sendgrid"`, `EMAIL_FROM` (sender đã xác minh) | `SENDGRID_API_KEY` |
| Mailgun | `EMAIL_PROVIDER="mailgun"`, `MAILGUN_DOMAIN`, `EMAIL_FROM` | `MAILGUN_API_KEY` |

## 7. Secret Manager

```bash
./deploy/02-secrets.sh
```

Nhập token ở dấu nhắc ẩn (không lưu vào lịch sử shell, không ghi file). Chỉ `gsb-worker` đọc được secret.
Đổi token sau này: chạy lại script rồi `./deploy/03-deploy-worker.sh` (Cloud Run đọc `:latest` khi khởi động revision mới).

## 8. Cloud Run (worker)

```bash
./deploy/03-deploy-worker.sh
```

Cloud Build dựng image từ `apps/worker/Dockerfile` (Playwright image nếu `ENABLE_BROWSER=true`, ngược lại
`node:22-bookworm-slim`), rồi deploy `gsb-worker`: 1 vCPU, 2 GiB (hoặc 512 MiB), concurrency 10, timeout 600s,
min 0 / max 2 instance, secrets từ Secret Manager. Kết thúc bằng `curl …/health` → `{"ok":true}`.

> Nếu tổ chức Google Workspace chặn `allUsers` (policy *Domain restricted sharing*), `--allow-unauthenticated`
> sẽ lỗi. Cần cho phép ngoại lệ cho project này — Firebase Hosting gọi Cloud Run như khách công khai; bảo mật do
> worker tự kiểm tra token ở từng route.

## 9. Cloud Scheduler

```bash
./deploy/04-scheduler.sh
```

Tạo `gsb-run-due` (`*/5 * * * *`, Asia/Tokyo) và `gsb-cleanup` (03:30 hằng ngày), gọi bằng OIDC token của
`gsb-scheduler`. Mỗi property vẫn được kiểm tra theo chu kỳ riêng 15/30/60 phút — tick 5 phút chỉ để rải đều tải.

## 10. Firebase Hosting + Firestore Rules/Indexes

Firebase console → Project settings → **Your apps** → Add app → Web (`</>`) → copy config:

```bash
cp apps/web/.env.example apps/web/.env.production
```

```bash
nano apps/web/.env.production
```

Điền `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`
(đây là định danh công khai, không phải secret), để `VITE_USE_EMULATOR=0`.

```bash
npx firebase login --no-localhost
```

```bash
./deploy/05-deploy-web.sh
```

Index Firestore mới cần vài phút để build; trong lúc đó trang Logs có thể báo lỗi "requires an index".

## 11. Đăng nhập lần đầu & cấp quyền

1. Mở `https://<PROJECT_ID>.web.app`, **Đăng nhập với Google** bằng email trong `ADMIN_EMAILS` → tự thành admin.
   (Email/mật khẩu: xác minh email trước, rồi bấm "Kiểm tra lại".)
2. **Cài đặt → Telegram** → nhập CHAT_ID → Lưu → **Test Telegram**.
3. **Thêm URL** → dán URL → **Test URL** → xem giá/địa chỉ/mã → **Add Monitor**.
4. Người khác: sau khi họ đăng ký, cấp quyền bằng

   ```bash
   gcloud auth application-default login
   ```

   ```bash
   PROJECT_ID=<PROJECT_ID> node deploy/set-role.mjs ban@example.com member
   ```

   (hoặc thêm email vào `MEMBER_EMAILS` rồi deploy lại worker). Thu hồi: `… set-role.mjs ban@example.com none`.

## 12. Kiểm tra vận hành

```bash
gcloud scheduler jobs run gsb-run-due --location=asia-northeast1
```

```bash
gcloud run services logs read gsb-worker --region=asia-northeast1 --limit=30
```

Trong web: **Logs** (mỗi lần kiểm tra: method, HTTP status, parser, giá, số trường, thay đổi, đã gửi thông báo, lỗi),
**Logs → Lượt chạy scheduler** (admin).

## Cập nhật & rollback

- Worker: `./deploy/03-deploy-worker.sh` · Web/Rules: `./deploy/05-deploy-web.sh`
- Rollback worker:

  ```bash
  gcloud run revisions list --service=gsb-worker --region=asia-northeast1
  ```

  ```bash
  gcloud run services update-traffic gsb-worker --region=asia-northeast1 --to-revisions=<REVISION>=100
  ```

- Tạm dừng toàn hệ thống: web → Cài đặt → Hệ thống (admin) → "Tạm dừng toàn bộ", hoặc
  `gcloud scheduler jobs pause gsb-run-due --location=asia-northeast1`.
