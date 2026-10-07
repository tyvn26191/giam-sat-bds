// Status, change and severity codes shared by worker, web and notifications.

export const PROPERTY_STATUSES = [
  'PENDING', // added, never checked
  'ACTIVE',
  'PRICE_CHANGED', // price changed within the last 24h
  'UPDATED', // important field changed within the last 24h
  'REMOVED', // was listed before, now 404 / "掲載終了" (confirmed twice)
  'NOT_FOUND', // never parsed successfully and the page is missing
  'BLOCKED', // 403 / CAPTCHA / robots.txt disallow — never bypassed
  'ERROR', // repeated technical failures (timeout, DNS, 5xx, parser)
  'PAUSED', // monitoring disabled by the user
] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

export const CHANGE_TYPES = [
  'PRICE_DECREASE',
  'PRICE_INCREASE',
  'PRICE_ALERT',
  'FIELD_CHANGED',
  'MINOR_CHANGED',
  'IMAGE_CHANGED',
  'REMOVED',
  'RESTORED',
  'POSSIBLE_RELIST',
  'BLOCKED',
  'ERROR',
  'RECOVERED',
] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export type PriceChangeType = 'PRICE_DECREASE' | 'PRICE_INCREASE' | 'PRICE_UNCHANGED' | 'PRICE_UNKNOWN';

export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_RANK: Record<Severity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

export const CHANGE_SEVERITY: Record<ChangeType, Severity> = {
  PRICE_DECREASE: 'CRITICAL',
  PRICE_ALERT: 'CRITICAL',
  PRICE_INCREASE: 'LOW',
  REMOVED: 'HIGH',
  FIELD_CHANGED: 'HIGH', // MEDIUM when only medium-importance fields changed
  MINOR_CHANGED: 'LOW',
  IMAGE_CHANGED: 'LOW',
  RESTORED: 'MEDIUM',
  POSSIBLE_RELIST: 'MEDIUM',
  BLOCKED: 'MEDIUM',
  ERROR: 'MEDIUM',
  RECOVERED: 'LOW',
};

/** Change types a user can subscribe to (RECOVERED is informational only). */
export const NOTIFY_TYPES = [
  'PRICE_DECREASE',
  'PRICE_INCREASE',
  'PRICE_ALERT',
  'REMOVED',
  'RESTORED',
  'POSSIBLE_RELIST',
  'FIELD_CHANGED',
  'MINOR_CHANGED',
  'IMAGE_CHANGED',
  'BLOCKED',
  'ERROR',
] as const;
export type NotifyType = (typeof NOTIFY_TYPES)[number];

export const STATUS_LABEL_VI: Record<PropertyStatus, string> = {
  PENDING: 'Chờ kiểm tra',
  ACTIVE: 'Đang hoạt động',
  PRICE_CHANGED: 'Đổi giá',
  UPDATED: 'Có cập nhật',
  REMOVED: 'Đã gỡ',
  NOT_FOUND: 'Không tìm thấy',
  BLOCKED: 'Bị chặn',
  ERROR: 'Lỗi',
  PAUSED: 'Tạm dừng',
};

export const CHANGE_LABEL_VI: Record<ChangeType, string> = {
  PRICE_DECREASE: 'Giảm giá',
  PRICE_INCREASE: 'Tăng giá',
  PRICE_ALERT: 'Đạt ngưỡng giá',
  FIELD_CHANGED: 'Thông tin quan trọng thay đổi',
  MINOR_CHANGED: 'Thay đổi nhỏ',
  IMAGE_CHANGED: 'Ảnh chính thay đổi',
  REMOVED: 'Tin đã bị gỡ',
  RESTORED: 'Tin đăng lại',
  POSSIBLE_RELIST: 'Có thể là căn cũ đăng lại',
  BLOCKED: 'Bị chặn truy cập',
  ERROR: 'Lỗi kiểm tra',
  RECOVERED: 'Hết lỗi',
};

export const SEVERITY_LABEL_VI: Record<Severity, string> = {
  CRITICAL: 'Khẩn',
  HIGH: 'Cao',
  MEDIUM: 'Vừa',
  LOW: 'Thấp',
};

export function maxSeverity(list: Severity[]): Severity {
  return list.reduce<Severity>((m, s) => (SEVERITY_RANK[s] > SEVERITY_RANK[m] ? s : m), 'LOW');
}
