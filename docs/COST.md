# Ước tính chi phí

Giá tham khảo (công khai, vùng Tier 1 gồm Tokyo, tháng 30 ngày) — **kiểm tra lại bảng giá hiện hành** trước khi
dùng con số này để lập ngân sách; free tier có thể thay đổi, không nên giả định có mãi mãi.

| Dịch vụ | Đơn giá dùng để tính | Free tier tham khảo |
|---|---|---|
| Cloud Run (request-based) | 0.000024 USD / vCPU-giây · 0.0000025 USD / GiB-giây · 0.40 USD / triệu request | 180,000 vCPU-s · 360,000 GiB-s · 2M request / tháng (theo billing account) |
| Firestore | ~0.06 USD/100k reads · ~0.18 USD/100k writes · ~0.02 USD/100k deletes (mức trần; Tokyo rẻ hơn) | 50k reads · 20k writes · 20k deletes / ngày |
| Cloud Scheduler | 0.10 USD / job / tháng | 3 job / billing account |
| Secret Manager | 0.06 USD / version active · 0.03 USD / 10k truy cập | 6 version · 10k truy cập |
| Artifact Registry | 0.10 USD / GB-tháng | 0.5 GB |
| Firebase Hosting / Auth | — | 10 GB lưu trữ, 360 MB/ngày; Auth email/Google miễn phí ở quy mô này |

## Khối lượng

Mỗi property 1 request HTTP mỗi chu kỳ (robots.txt cache 24h trong Firestore). Cloud Scheduler: 1 tick/5 phút =
**8,640 lượt/tháng** cho mọi quy mô (2 job → nằm trong 3 job miễn phí nếu billing account chưa dùng job khác).

| URL × chu kỳ | Lượt kiểm tra/ngày | Lượt/tháng | Request tới website/tháng |
|---|---|---|---|
| 10 × 15' | 960 | 28,800 | ~28,800 |
| 10 × 30' | 480 | 14,400 | ~14,400 |
| 30 × 15' | 2,880 | 86,400 | ~86,400 |
| 30 × 30' | 1,440 | 43,200 | ~43,200 |
| 100 × 15' | 9,600 | 288,000 | ~288,000 |
| 100 × 30' | 4,800 | 144,000 | ~144,000 |

## Cloud Run

Thời gian instance bị tính tiền ≈ thời gian tick chạy. Một lượt HTTP mất ~0.5–1.5 s (tải trang + parse ~0.1 s cho
trang ~170 KB, đã đo). Vì mỗi domain chỉ 1 request đồng thời và cách nhau 2–3 s (lịch sự với website), nếu **tất
cả URL cùng một site** thì mỗi lượt chiếm ≈ 2.5 s; nếu rải trên ≥3 site chạy song song thì ≈ 1 s. Cộng ~0.5 s cho
mỗi tick rỗng. Cấu hình 1 vCPU, 512 MiB (không bật Playwright):

| URL × chu kỳ | vCPU-s/tháng (1 site · ≥3 site) | USD không free tier | USD có free tier |
|---|---|---|---|
| 10 × 15' | 76k · 33k | 1.9 · 0.8 | **0** |
| 10 × 30' | 40k · 19k | 1.0 · 0.5 | **0** |
| 30 × 15' | 220k · 91k | 5.6 · 2.3 | ~1.0 · **0** |
| 30 × 30' | 112k · 48k | 2.8 · 1.2 | **0** |
| 100 × 15' | 724k · 292k | 18.3 · 7.4 | ~13.1 · ~2.7 |
| 100 × 30' | 364k · 148k | 9.2 · 3.7 | ~4.4 · **0** |

**Playwright (tầng 2)** chỉ chạy khi trang cần JavaScript: ~6–10 vCPU-s mỗi lượt và image chạy với 2 GiB RAM
(memory ×4). Ví dụ 30 URL × 15' mà *tất cả* cần trình duyệt ≈ 86,400 × 8 ≈ 690k vCPU-s ≈ 17 USD/tháng — vì vậy
hệ thống chỉ dùng trình duyệt khi HTTP không đọc được, và nhớ URL nào thật sự cần.

## Firestore

Mỗi lượt: 1 read (truy vấn đến hạn) + 2 writes (cập nhật property + monitorLog) + 1 delete về sau (TTL log).
Mỗi tick có việc: ~6 reads, ~2 writes, ~2 deletes (khóa, cấu hình, settings, domain, monitorRun). Thay đổi thật
(giảm giá…): +3–5 writes. Dashboard: mỗi lần mở đọc N property + cập nhật realtime.

| URL × chu kỳ | reads/ngày | writes/ngày | deletes/ngày | USD/tháng không free | Trong free tier/ngày? |
|---|---|---|---|---|---|
| 10 × 15' | ~2.7k | ~2.5k | ~1.5k | ~0.2 | ✅ |
| 30 × 15' | ~4.6k | ~6.3k | ~3.5k | ~0.45 | ✅ |
| 100 × 15' | ~11k | ~20k | ~10k | ~1.3 | ⚠️ sát ngưỡng 20k writes |
| 100 × 30' | ~6k | ~10k | ~5k | ~0.7 | ✅ |

Với 100+ URL, đặt `LOG_CHECKS=changes` (chỉ ghi log khi có thay đổi/lỗi) → writes giảm ~một nửa.

## Tổng (ước tính / tháng)

| URL × chu kỳ | Không free tier | Có free tier |
|---|---|---|
| 10 × 15' | ~1.5–2.5 USD | **~0.3 USD** (chủ yếu Artifact Registry) |
| 10 × 30' | ~1–1.5 USD | ~0.3 USD |
| 30 × 15' | ~3–6.5 USD | ~0.3–1.3 USD |
| 30 × 30' | ~2–3.5 USD | ~0.3 USD |
| 100 × 15' | ~9–20 USD | ~3–14 USD |
| 100 × 30' | ~4.5–10.5 USD | ~0.3–5 USD |

Khoảng dao động = URL rải nhiều site (thấp) ↔ dồn một site (cao). Chưa gồm Playwright, ảnh chụp (vài MB, ~0 USD),
egress (trang tải về là *ingress* — miễn phí; tin Telegram rất nhỏ).

## Đòn bẩy giảm chi phí đã có sẵn

1. HTTP trước, Playwright chỉ fallback; chặn ảnh/font/media khi render.
2. Conditional request (ETag / Last-Modified → 304, không parse).
3. Snapshot chỉ lưu lần đầu + khi có thay đổi; ảnh chụp/HTML chỉ khi thay đổi quan trọng và có bucket.
4. Log có TTL (14 ngày), snapshot cũ dọn theo `retentionDays`, Artifact Registry giữ 3 image.
5. Các trường lớn không đánh index Firestore.
6. Tick rỗng chỉ tốn 1 read; khóa/run doc chỉ ghi khi có việc.
7. Tùy chỉnh: chu kỳ 30/60', `LOG_CHECKS=changes`, `DOMAIN_MIN_SPACING_MS`, `ENABLE_BROWSER=false` (image nhỏ, 512 MiB).
