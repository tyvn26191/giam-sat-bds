# Kiến trúc — Property Watch

## 1. Tổng quan

```
                ┌─────────────────────────── Firebase Hosting (https://<project>.web.app) ─────────────┐
 Điện thoại/PC ─┤  React SPA (apps/web)        /api/** ──rewrite──►  Cloud Run "gsb-worker" (apps/worker) │
                └──────┬─────────────────────────────────────────────────────▲─────────┬──────────────┘
                       │ Firestore SDK (đọc dữ liệu của mình,                 │         │ HTTP (tầng 1) / Playwright (tầng 2)
                       │ sửa cài đặt — Rules kiểm tra)                       │         ▼
                       ▼                                                      │   SUUMO · HOME'S · at home · site khác
                 Cloud Firestore  ◄──── Admin SDK (kết quả kiểm tra) ─────────┤
                                                                              │ OIDC token
                                                   Cloud Scheduler ───────────┘ mỗi 5 phút: POST /tasks/run-due
                                                                                 03:30 JST:   POST /tasks/cleanup
                 Secret Manager (TELEGRAM_BOT_TOKEN, SMTP…) ──env──► worker ──► Telegram Bot API / Email provider
                 Cloud Storage (tùy chọn) ◄── ảnh chụp + HTML khi có thay đổi quan trọng
```

- **Web (apps/web)**: React 19 + Vite + TypeScript, tiếng Việt, mobile-first, sáng/tối. Đọc Firestore trực tiếp
  (realtime) cho dữ liệu của chính người dùng; mọi thao tác "nguy hiểm" (thêm URL, đổi URL, xóa, Check now,
  Test URL, gửi thử) đi qua API của worker.
- **Worker (apps/worker)**: Node.js 22 trên Cloud Run, một service duy nhất:
  - `/tasks/*` — Cloud Scheduler gọi (xác thực OIDC: đúng issuer Google, đúng audience, đúng service account).
  - `/api/*` — web gọi qua Firebase Hosting rewrite (xác thực Firebase ID token + custom claim `role`).
- **packages/**: code dùng chung, không phụ thuộc hạ tầng.
  - `shared` — kiểu dữ liệu, chuẩn hóa giá Nhật, chống SSRF, fingerprint, định dạng giờ Tokyo, CSV.
  - `parser` — `PropertySiteAdapter` + `BaseAdapter` (Generic) + SUUMO/HOME'S/at home, nhận diện trạng thái trang.
  - `notifications` — định dạng tin, Telegram, EmailProvider (SMTP/Resend/SendGrid/Mailgun).

## 2. Luồng một lần kiểm tra

```
Scheduler tick (5') → queryDue(enabled && nextCheckAt ≤ now+2.5') → khóa runDue (Firestore lease)
  → xen kẽ theo domain → pool (MAX_CONCURRENT_CHECKS) → với mỗi property:
     observe():
       validatePublicUrl  ──► robots.txt (cache 24h)  ──► HostLimiter (1–2 đồng thời/domain, giãn cách 2–3s)
       Tầng 1: HTTP GET (DNS pinning chống SSRF, redirect ≤5 kiểm tra từng bước, timeout 20s, ≤5MB, gzip/br,
               ETag/Last-Modified → 304 = không đổi)
         404/410 → REMOVED · 401/403 → BLOCKED · 429 → chờ (Retry-After / 30') · 5xx/timeout/DNS → lỗi tạm thời
         200 → adapter.parse() → OK | REMOVED (掲載終了…) | BLOCKED (CAPTCHA…) | NEEDS_BROWSER | PARSE_FAILED
       Tầng 2 (chỉ khi NEEDS_BROWSER/PARSE_FAILED và ENABLE_BROWSER): Playwright Chromium, chặn ảnh/font,
               mọi request con cũng qua kiểm tra SSRF; nhớ needsBrowser để lần sau đi thẳng tầng 2.
       Lỗi tạm thời → thử lại sau 30s ngay trong lượt (nếu còn thời gian)
     evaluate() (hàm thuần, có test):  so với trạng thái cũ → patch + changes + priceHistory + snapshot + kế hoạch thông báo
     findMatches() (lần đọc thành công đầu tiên): "Possible same property"
     commitCheck(): 1 batch Firestore, điều kiện lastUpdateTime (chống ghi đè khi 2 tiến trình cùng xử lý)
     Notifier.dispatch(): id = sha(propertyId:revision:channel) tạo trước khi gửi → không bao giờ gửi trùng
     monitorLogs (TTL 14 ngày)
  → thử gửi lại thông báo FAILED (≤3 lần, 24h) → monitorRuns
```

Ngân sách thời gian mỗi tick: `RUN_BUDGET_MS` (4 phút). Hết giờ thì dừng nhận việc mới; phần còn lại vẫn "đến hạn"
và được xử lý ở tick sau (sắp theo `nextCheckAt` cũ nhất trước).

## 3. Lịch kiểm tra, retry, backoff

| Tình huống | Lần kế tiếp |
|---|---|
| OK / không đổi | `interval ± jitter` (jitter đối xứng ≤ min(90s, 10%) → trung bình vẫn đúng 15/30/60') |
| Lỗi tạm thời lần 1 (đã thử lại 30s) | +2 phút |
| Lỗi lần 2 | +10 phút |
| Lỗi lần 3 | **ERROR** + thông báo 1 lần; sau đó `interval × 2^n` (tối đa 6 giờ) — không retry vô hạn |
| 404/掲載終了 lần 1 (đã từng OK) | +2 phút để xác nhận |
| 404/掲載終了 lần 2 | **REMOVED** + thông báo; vẫn kiểm tra thưa (≥60', tăng dần) vì tin có thể đăng lại |
| CAPTCHA/403 lần 1 | +10 phút |
| CAPTCHA/403 lần 2 / robots.txt cấm | **BLOCKED** + thông báo; thưa dần (≥1h … 6h). Không bao giờ vượt CAPTCHA |
| URL chưa từng đọc được | hiện ngay NOT_FOUND / BLOCKED / ERROR, không gửi thông báo |
| 429 | tôn trọng `Retry-After` (mặc định 30'), cả domain tạm nghỉ |

`BLOCKED` và `REMOVED` là hai nhánh riêng: trang chặn bot chỉ thành `REMOVED` nếu không có dữ liệu VÀ có cụm
"掲載終了/お探しの物件は見つかりません…" hoặc HTTP 404/410 — trang CAPTCHA luôn là `BLOCKED`.

## 4. Phát hiện thay đổi & chống spam

Mỗi lần đọc thành công tạo các hash (sha256, 32 hex):

- `priceHash` — giá đã chuẩn hóa (chỉ khi độ tin cậy ≥ 0.7)
- `importantFieldsHash` — tiêu đề + các trường 物件概要
- `normalizedContentHash` — văn bản đã chuẩn hóa (chế độ "vùng quan trọng": các trường; "toàn trang": text đã bỏ
  script/style/quảng cáo/bộ đếm/timestamp/session id)
- `imageHash` — ảnh chính (bỏ query string)
- `snapshotHash` — tổng hợp

Snapshot hash không đổi → không có gì để ghi ngoài `lastCheckedAt`. Khi đổi, `evaluate()` phân loại:

| Loại | Mức | Ghi chú |
|---|---|---|
| PRICE_DECREASE | CRITICAL | oldPrice, newPrice, difference, percentage (4 chữ số thập phân) |
| PRICE_ALERT | CRITICAL | ngưỡng giá ≤ X (báo 1 lần khi vượt ngưỡng), giảm ≥ X円 / ≥ Y% một lần |
| REMOVED | HIGH | sau 2 lần xác nhận |
| FIELD_CHANGED | HIGH/MEDIUM | 所在地, 面積, 間取り, 築年, 引渡時期, 状態 = HIGH; 備考, 売主… = MEDIUM |
| PRICE_INCREASE | LOW | |
| MINOR_CHANGED | LOW | 更新日/次回更新日/掲載日 hoặc text toàn trang; mặc định không gửi |
| IMAGE_CHANGED | LOW | chỉ khi bật "theo dõi ảnh" |
| RESTORED / POSSIBLE_RELIST | MEDIUM | tin xuất hiện lại / URL mới có thể là căn cũ |
| BLOCKED / ERROR | MEDIUM | báo 1 lần khi chuyển trạng thái |

Không bao giờ "đoán" thay đổi giá: giá không đọc được hoặc độ tin cậy thấp → giữ giá cũ, gắn `NEEDS_REVIEW`.
Nếu số trường đọc được tụt mạnh (trang đổi cấu trúc) → giữ giá trị cũ, `FIELDS_MISSING`, không báo "mất trường".

Chống trùng: (1) hash không đổi thì không có thay đổi; (2) `revision` + commit có điều kiện → chỉ một tiến trình
ghi được một chuyển trạng thái; (3) `notificationLogs/{sha(propertyId:revision:channel)}` được `create()` trước khi
gửi — lần thứ hai gặp ALREADY_EXISTS và bỏ qua. Một lần kiểm tra = tối đa 1 tin mỗi kênh (gộp giảm giá + đạt ngưỡng
+ trường khác vào cùng một tin).

## 5. Site adapters

```ts
interface PropertySiteAdapter {
  id; name; version;
  canHandle(url): boolean;
  fetch?(url): Promise<FetchedPage>;          // tùy chọn (vd. API chính thức)
  prefersBrowser?(url): boolean;              // site biết chắc cần JS
  parse(page, options): ParseResult;          // điều phối các bước dưới
  parsePrice / parseTitle / parseAddress / parsePropertyData / extractPropertyId;
  normalize($, result, ctx): string;          // văn bản để diff
  createFingerprint(result): Fingerprint;
}
```

`BaseAdapter` (= GenericAdapter) đã làm sẵn: bảng nhãn 物件概要 (th/td, dt/dd, "所在地：…"), JSON-LD
(RealEstateListing/Product/Offer…), OpenGraph/meta, microdata, regex giá gần chữ 価格, regex địa chỉ theo 都道府県,
CSS selector thủ công của người dùng, độ tin cậy cho từng trường, phát hiện REMOVED/BLOCKED/NEEDS_BROWSER.
Adapter riêng chỉ thêm: host, mẫu URL chi tiết + mã property (SUUMO `nc_\d+`, HOME'S `b-…`, at home `\d{8,12}`),
selector dự phòng, chuỗi cần bỏ khỏi `<title>`.

**Thêm site mới** (vd. Yahoo!不動産): tạo `packages/parser/src/adapters/yahoo.ts` kế thừa `BaseAdapter`, đăng ký trong
`registry.ts`, thêm fixture HTML + test. Không phải sửa worker hay web.

Độ tin cậy giá: selector người dùng 0.95 · nhãn 価格 trên site đã biết 0.97 (+0.02 khi nhiều nguồn khớp) ·
JSON-LD 0.88 · meta 0.85 · regex nội dung 0.6 · regex tiêu đề 0.55. Hai nguồn mạnh lệch nhau → ≤0.6 + `PRICE_CONFLICT`.
Ngưỡng dùng giá để so sánh: 0.7.

## 6. Fingerprint — "Possible same property"

Từ địa chỉ chuẩn hóa (NFKC, 三丁目→3丁目, ヶ→ケ…), 都道府県/市区町村/町, diện tích đất/xây dựng/sàn (sai lệch ≤0.5%
= khớp), 間取り, số căn (号棟/区画/号室), tên dự án, năm xây, 売主, mã property, giá (trọng số rất nhỏ).
`confidence = (điểm khớp / điểm có dữ liệu) × độ phủ × hệ số phạt` — khác thành phố ×0.2, khác số căn ×0.3,
diện tích lệch >10% ×0.5. Không có địa chỉ hoặc diện tích → 0 (không bao giờ ghép chỉ bằng giá).
≥ 0.75 → lưu vào `matches` của cả hai property; nếu căn cũ đang REMOVED → thông báo `POSSIBLE_RELIST` kèm giá cũ → mới.

## 7. Firestore schema

Tất cả thời gian lưu là `Timestamp` (UTC); UI hiển thị theo `Asia/Tokyo` (đổi được trong Cài đặt).

| Đường dẫn | Ai ghi | Nội dung chính |
|---|---|---|
| `users/{uid}` | chủ tài khoản (Rules) / worker tạo mặc định | `email`, `displayName`, `settings{defaultIntervalMin, timezone, telegram{enabled,chatId}, email{enabled,to}, notifyTypes{…}, minSeverity}`, `createdAt`, `updatedAt` |
| `properties/{id}` | worker; chủ sở hữu chỉ sửa trường cài đặt | `ownerId`, `url`, `site`, `host`, cài đặt (`name`, `groups[]`, `intervalMin`, `enabled`, `pausedByAll`, `monitorMode`, `selectors`, `notify`, `track`, `alerts`, `note`), dữ liệu đọc được (`title`, `address`, `propertyCode`, `imageUrl`, `fields{…}`), giá (`price`, `priceDisplay`, `previousPrice`, `lastPriceChange{type,oldPrice,newPrice,difference,percentage,at}`, `priceStats{initial,max,min,dropCount,increaseCount,firstDropAt,lastDropAt}`), `status`, `needsReview`, `reviewReasons[]`, `confidence{price,title,address,overall}`, `parser`, `method`, `httpStatus`, `needsBrowser`, `hashes{snapshot,content,price,fields,image}`, `fingerprint{key,cityKey,parts}`, `matches[]`, `failure{kind,count,code,message,sinceAt}`, `lastError`, `alertState`, `httpCache{etag,lastModified}`, `lastSnapshotId`, `lastNotification`, `lastCheckedAt`, `lastSuccessAt`, `lastChangedAt`, `nextCheckAt`, `createdAt`, `updatedAt`, `revision` |
| `properties/{id}/priceHistory/{id}` | worker | `at`, `price` (JPY int), `display`, `changeType` (INITIAL/PRICE_DECREASE/PRICE_INCREASE), `difference`, `percentage` |
| `properties/{id}/changes/{id}` | worker | `type`, `severity`, `revision`, giá cũ/mới, `fieldChanges[{key,label,before,after,importance}]`, `textDiff{added,removed}`, `statusBefore/After`, `beforeSnapshotId`, `afterSnapshotId`, `message`, `dedupeKey`, `screenshotPath` |
| `properties/{id}/snapshots/{id}` | worker | lần đầu + mỗi lần có thay đổi: `price`, `title`, `address`, `fields`, `normalizedText` (≤30k ký tự), `hashes`, `method`, `parser`, `confidence`, `htmlPath?`, `screenshotPath?` |
| `notificationLogs/{sha}` | worker | `ownerId`, `propertyId`, `channel`, `type`, `severity`, `status` (PENDING/SENT/FAILED/DRY_RUN), `messageId`, `error`, `attempts`, `payload` (để gửi lại), `createdAt`, `sentAt`, `expireAt` (TTL) |
| `monitorLogs/{id}` | worker | `runId` (monitorRunId), `propertyId`, `trigger`, `startedAt`, `finishedAt`, `durationMs`, `method`, `httpStatus`, `parser`, `outcome`, `priceDetected`, `fieldsDetected[]`, `changed`, `changeTypes[]`, `notificationSent`, `error`, `expireAt` (TTL) |
| `monitorRuns/{runId}` | worker | `trigger`, `startedAt`, `finishedAt`, `due`, `processed`, `changed`, `errors`, `skipped`, `notifications`, `expireAt` |
| `domains/{host}` | worker | robots.txt đã phân tích (24h), `cooldownUntil` (429) |
| `system/config` | admin (Rules) | `paused`, `maxConcurrentChecks`, `perDomainConcurrency`, `retentionDays` |
| `system/lock_runDue` | worker | lease chống chạy chồng tick |

Indexes: `firestore.indexes.json` (due query `enabled+nextCheckAt`, logs theo `ownerId`/`propertyId`, retry
notification). Các trường lớn (`normalizedText`, `fields`, `payload`, `hashes`…) được loại khỏi index để giảm chi phí ghi.

## 8. Quyền truy cập

- Custom claim `role`: `admin` | `member`. Không có role → màn hình "Chờ cấp quyền".
  Cấp quyền: email trong `ADMIN_EMAILS` / `MEMBER_EMAILS` (đã xác minh) tự nhận khi đăng nhập, hoặc
  `deploy/set-role.mjs`.
- Rules: chỉ đọc dữ liệu có `ownerId == uid` (admin đọc tất cả); client chỉ sửa trường cài đặt đã validate;
  tạo/xóa property, đổi URL, kết quả kiểm tra, log: chỉ worker. Chi tiết: `firestore.rules` + `tests/rules`.
