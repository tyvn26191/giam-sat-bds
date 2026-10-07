# Bảo mật & tuân thủ

## Bí mật

- Không có token/khóa nào trong repo. `TELEGRAM_BOT_TOKEN`, `SMTP_PASS`, `RESEND_API_KEY`, … nằm trong
  **Secret Manager**, chỉ service account `gsb-worker` đọc được, được gắn vào Cloud Run bằng `--set-secrets`.
- `deploy/02-secrets.sh` nhận giá trị qua dấu nhắc ẩn (không qua tham số → không vào lịch sử shell / process list).
- Lỗi từ Telegram được ghi log mà không kèm URL chứa token (có test).
- Cấu hình web Firebase (`VITE_FIREBASE_*`) là định danh công khai; quyền thực sự do Security Rules quyết định.
- `.env`, `deploy/env.sh`, `apps/web/.env.local` bị `.gitignore`.

## Chống SSRF (worker tự tải URL người dùng nhập)

1. `validatePublicUrl`: chỉ `http/https`, không user:pass, chỉ cổng 80/443, chặn `localhost`, `*.local`,
   `*.internal`, `metadata.google.internal`, tên miền một nhãn, IP literal riêng tư (kể cả dạng `2130706433`,
   `0x7f.1`, `[::ffff:127.0.0.1]`, NAT64, 6to4, link-local, CGNAT, multicast…).
2. **DNS pinning**: hàm `lookup` tùy biến cho `http(s).request` phân giải DNS, từ chối nếu *bất kỳ* địa chỉ nào là
   riêng tư, và socket kết nối đúng địa chỉ vừa kiểm tra (không có khe hở DNS-rebinding giữa kiểm tra và kết nối).
3. Mỗi bước redirect (tối đa 5) được kiểm tra lại; giới hạn thời gian 20 s, 5 MB, chỉ nhận `text/html`.
4. Tầng Playwright: mọi request con của trang (script, XHR, redirect) đi qua cùng kiểm tra URL + DNS; ảnh/font/media
   bị chặn; không tải file. (Trình duyệt tự phân giải DNS lại → rủi ro rebinding còn lại rất nhỏ; Cloud Run không có
   VPC nên chỉ còn metadata server, vốn đòi header `Metadata-Flavor` mà trang web không gửi được.)
5. Kiểm tra URL ở cả web (UX) lẫn worker (bắt buộc) và Rules (client không được tự đổi `url`).

## Xác thực & phân quyền

- Web → API: Firebase ID token (`verifyIdToken`), custom claim `role ∈ {member, admin}`; chưa có role → 403.
- Admin tự động chỉ cho email **đã xác minh** trong `ADMIN_EMAILS`; thành viên qua `MEMBER_EMAILS` hoặc
  `deploy/set-role.mjs` (có `revokeRefreshTokens`).
- Cloud Scheduler → `/tasks/*`: OIDC token do Google ký, kiểm tra audience (URL service) + email service account.
  `TASKS_AUTH=none` bị từ chối khi chạy trên Cloud Run; endpoint `/dev/*` chỉ tồn tại ở chế độ mock local.
- Mọi handler kiểm tra lại quyền sở hữu phía server (`ownerId`), không tin UI.
- Rate limit theo người dùng (Test URL 10/phút, Check now 6/phút + tối thiểu 60 s/property, Run now 2/phút…).
- Body JSON tối đa 64 KB.

## Firestore Security Rules (`firestore.rules`, test ở `tests/rules`)

- Đọc: chỉ tài liệu của mình (`ownerId == uid`), admin đọc tất cả; truy vấn phải lọc theo `ownerId`.
- Ghi từ client: chỉ `users/{uid}` (cài đặt đã validate: chat ID, email, enum, khóa cho phép) và các trường cài đặt
  của property (`name`, `groups` ≤10×40 ký tự, `intervalMin ∈ {15,30,60}`, `alerts` trong khoảng hợp lệ,
  `selectors` ≤300 ký tự…), `updatedAt == request.time`.
- Không client nào ghi được giá, trạng thái, lịch sử, log, `url`, `ownerId`, `nextCheckAt`, `system/lock_*`.
- `system/config`: chỉ admin, giá trị trong giới hạn.

## Web

- CSP chặt (`script-src 'self'` + Google sign-in, không `unsafe-inline`/`unsafe-eval`), HSTS, `X-Frame-Options: DENY`,
  `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `noindex`.
- Không dùng `dangerouslySetInnerHTML`; dữ liệu trang bất động sản luôn hiển thị như text. Tin Telegram/email
  escape HTML.
- Ảnh tải với `referrerPolicy="no-referrer"`. Link ra ngoài `rel="noopener noreferrer"`.
- CSV export chống formula injection (`=`, `+`, `-`, `@` ở đầu ô).

## Tuân thủ website (ToS, robots.txt, tải)

- Đọc và tôn trọng **robots.txt** (RFC 9309, cache 24 h; 5xx/không truy cập được → coi như cấm tạm thời) và
  `Crawl-delay`.
- User-Agent trung thực: `PropertyWatchBot/1.0 (+<APP_URL>; personal property price monitor)`.
- 1 request đồng thời/domain (tối đa 2), giãn cách 2–3 s + jitter, tối đa 4 lượt song song toàn hệ thống, 429 →
  nghỉ cả domain theo `Retry-After`.
- **Không** vượt CAPTCHA, đăng nhập, bot protection, không giả lập vân tay trình duyệt, không xoay IP/proxy. Trang chặn
  → `BLOCKED`, ghi log, báo người dùng, giãn lịch kiểm tra.
- Chỉ theo dõi URL người dùng tự nhập (không crawl trang tìm kiếm). Người dùng tự chịu trách nhiệm kiểm tra
  Điều khoản sử dụng (利用規約) của từng site — nhiều cổng BĐS Nhật cấm thu thập tự động; nếu site cấm, hãy dừng
  theo dõi site đó.

## Dữ liệu & lưu trữ

- Timestamp UTC; log có TTL; snapshot cũ được dọn theo `retentionDays`; bucket ảnh tự xóa sau 90 ngày, private,
  truy cập qua signed URL 10 phút sau khi kiểm tra quyền sở hữu.
- Xóa property = xóa cả subcollection (`recursiveDelete`).
