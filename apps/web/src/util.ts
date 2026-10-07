import {
  SITE_LABELS,
  formatDateTime,
  toCsv,
  type PropertyDoc,
  type PropertyStatus,
} from '@gsb/shared';
import type { Property } from './data';

/** PAUSED is derived: a disabled property keeps its last real status in the database. */
export function displayStatus(p: Pick<PropertyDoc, 'enabled' | 'status'>): PropertyStatus {
  return p.enabled ? p.status : 'PAUSED';
}

export function displayName(p: Pick<PropertyDoc, 'name' | 'title' | 'url'>): string {
  return p.name || p.title || p.url;
}

/** 万円 input ↔ JPY */
export function manToYen(v: string): number | null {
  const n = Number(v.replace(/[,\s]/g, ''));
  return v.trim() && Number.isFinite(n) && n > 0 ? Math.round(n * 10_000) : null;
}

export function yenToMan(v: number | null | undefined): string {
  return v ? String(v / 10_000) : '';
}

export function totalDrop(p: PropertyDoc): { amount: number; percent: number } | null {
  const base = p.priceStats.initial;
  if (base === null || p.price === null || p.price >= base) return null;
  return { amount: base - p.price, percent: ((base - p.price) / base) * 100 };
}

export function exportCsv(list: Property[], tz: string): void {
  const rows = [
    ['name', 'url', 'site', 'currentPrice', 'previousPrice', 'difference', 'address', 'lastCheckedAt', 'status', 'groups', 'title'],
    ...list.map((p) => [
      p.name ?? '',
      p.url,
      SITE_LABELS[p.site],
      p.price,
      p.previousPrice,
      p.price !== null && p.previousPrice !== null ? p.price - p.previousPrice : null,
      p.address ?? '',
      p.lastCheckedAt ? formatDateTime(p.lastCheckedAt, tz) : '',
      displayStatus(p),
      p.groups.join(' / '),
      p.title ?? '',
    ]),
  ];
  const blob = new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  a.download = `property-watch-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const REVIEW_REASON_VI: Record<string, string> = {
  LOW_PRICE_CONFIDENCE: 'Độ tin cậy của giá thấp — giá chưa được dùng để so sánh',
  PRICE_CONFLICT: 'Nhiều nguồn trên trang cho giá khác nhau',
  PRICE_NOT_FOUND: 'Không tìm thấy giá trên trang',
  LOW_ADDRESS_CONFIDENCE: 'Địa chỉ đoán từ nội dung trang (độ tin cậy thấp)',
  FIELDS_MISSING: 'Thiếu nhiều trường so với lần trước — có thể trang đổi cấu trúc',
  JS_REQUIRED: 'Trang cần JavaScript để hiển thị dữ liệu',
  PRICE_RANGE: 'Giá dạng khoảng (価格帯) — dùng giá thấp nhất',
};
