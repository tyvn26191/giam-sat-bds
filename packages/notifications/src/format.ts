// Message rendering (Vietnamese UI text; property data stays Japanese).

import {
  SITE_LABELS,
  STATUS_LABEL_VI,
  formatDateTime,
  formatManYen,
  formatPercent,
  type ChangeType,
} from '@gsb/shared';
import type { NotificationPayload } from './types';

export const HEADLINES: Record<ChangeType, string> = {
  PRICE_DECREASE: '🔴 GIÁ NHÀ GIẢM',
  PRICE_ALERT: '🎯 ĐẠT NGƯỠNG GIÁ',
  PRICE_INCREASE: '🔺 GIÁ NHÀ TĂNG',
  REMOVED: '⚠️ PROPERTY REMOVED',
  RESTORED: '🟢 PROPERTY ĐĂNG LẠI',
  POSSIBLE_RELIST: '🔁 CÓ THỂ LÀ CĂN CŨ ĐĂNG LẠI',
  FIELD_CHANGED: '🟡 PROPERTY UPDATED',
  MINOR_CHANGED: '⚪ THAY ĐỔI NHỎ',
  IMAGE_CHANGED: '🖼️ ẢNH CHÍNH THAY ĐỔI',
  BLOCKED: '⛔ BỊ CHẶN TRUY CẬP',
  ERROR: '❗ LỖI KIỂM TRA',
  RECOVERED: '✅ HẾT LỖI',
};

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cut(s: string | null, n = 80): string {
  if (!s) return '—';
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Lines as [label, value] pairs; null label = free-form line. */
export function messageLines(p: NotificationPayload): [string | null, string][] {
  const lines: [string | null, string][] = [];
  lines.push(['Tên', p.title]);
  lines.push(['Site', SITE_LABELS[p.site]]);
  if (p.price) {
    const down = p.price.difference < 0;
    lines.push(['Giá cũ', formatManYen(p.price.oldPrice)]);
    lines.push(['Giá mới', formatManYen(p.price.newPrice)]);
    lines.push([down ? 'Giảm' : 'Tăng', formatManYen(Math.abs(p.price.difference))]);
    if (p.price.percentage !== null) lines.push(['Tỷ lệ', formatPercent(p.price.percentage)]);
  } else if (p.currentPrice !== null && p.primary !== 'ERROR' && p.primary !== 'BLOCKED') {
    lines.push(['Giá', formatManYen(p.currentPrice)]);
  }
  for (const a of p.alerts) lines.push([null, `🎯 ${a}`]);
  if (p.match) {
    lines.push([null, `🔁 Có thể là căn cũ (độ tin cậy ${Math.round(p.match.confidence * 100)}%): ${cut(p.match.title, 40)}`]);
    if (p.match.oldPrice !== null && p.currentPrice !== null) {
      lines.push(['Giá cũ (tin trước)', `${formatManYen(p.match.oldPrice)} → ${formatManYen(p.currentPrice)}`]);
    }
  }
  if (p.fieldChanges.length) {
    lines.push([null, p.primary === 'FIELD_CHANGED' ? 'Thay đổi:' : 'Thay đổi khác:']);
    for (const c of p.fieldChanges.slice(0, 8)) lines.push([null, `• ${c.label}: ${cut(c.before, 40)} → ${cut(c.after, 40)}`]);
    if (p.fieldChanges.length > 8) lines.push([null, `… và ${p.fieldChanges.length - 8} mục khác`]);
  }
  if (p.textDiff && (p.textDiff.added.length || p.textDiff.removed.length)) {
    for (const l of p.textDiff.removed.slice(0, 3)) lines.push([null, `− ${cut(l, 60)}`]);
    for (const l of p.textDiff.added.slice(0, 3)) lines.push([null, `+ ${cut(l, 60)}`]);
  }
  if (p.status && (p.primary === 'BLOCKED' || p.primary === 'ERROR' || p.primary === 'REMOVED')) {
    lines.push(['Trạng thái', `${p.status} (${STATUS_LABEL_VI[p.status]})`]);
  }
  if (p.error) lines.push(['Lỗi', `${p.error.code}: ${cut(p.error.message, 120)}`]);
  lines.push(['Thời gian', formatDateTime(p.at, p.timezone)]);
  return lines;
}

function publicLink(u: string | null): string | null {
  if (!u) return null;
  try {
    const x = new URL(u);
    if (x.protocol !== 'https:' || /^(localhost|127\.|\[::1\])/.test(x.hostname)) return null;
    return x.toString();
  } catch {
    return null;
  }
}

export interface TelegramMessage {
  text: string;
  buttons: { text: string; url: string }[][];
}

export function formatTelegram(p: NotificationPayload): TelegramMessage {
  const out = [`<b>${escapeHtml(HEADLINES[p.primary])}</b>`, ''];
  for (const [label, value] of messageLines(p)) {
    out.push(label ? `<b>${escapeHtml(label)}:</b> ${escapeHtml(value)}` : escapeHtml(value));
  }
  const row: { text: string; url: string }[] = [];
  const open = publicLink(p.url);
  if (open) row.push({ text: 'Open Property', url: open });
  const detail = publicLink(p.detailUrl);
  if (detail) row.push({ text: 'Xem lịch sử', url: detail });
  const shot = publicLink(p.screenshotUrl);
  const buttons = row.length ? [row] : [];
  if (shot) buttons.push([{ text: 'Open snapshot', url: shot }]);
  if (!open) out.push('', `URL: ${escapeHtml(p.url)}`);
  return { text: out.join('\n'), buttons };
}

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export function formatEmail(p: NotificationPayload): EmailContent {
  const headline = HEADLINES[p.primary].replace(/^\S+\s/, '');
  const priceBit = p.price ? ` ${formatManYen(p.price.oldPrice)}→${formatManYen(p.price.newPrice)}` : '';
  const subject = `[Property Watch] ${headline}${priceBit} – ${cut(p.title, 60)}`;
  const lines = messageLines(p);
  const text = [HEADLINES[p.primary], '', ...lines.map(([l, v]) => (l ? `${l}: ${v}` : v)), '', `URL: ${p.url}`, p.detailUrl ? `Chi tiết: ${p.detailUrl}` : '']
    .filter((x) => x !== undefined)
    .join('\n');
  const rows = lines
    .map(([l, v]) =>
      l
        ? `<tr><th align="left" style="padding:4px 12px 4px 0;color:#555;white-space:nowrap">${escapeHtml(l)}</th><td style="padding:4px 0">${escapeHtml(v)}</td></tr>`
        : `<tr><td colspan="2" style="padding:4px 0">${escapeHtml(v)}</td></tr>`,
    )
    .join('');
  const link = (href: string | null, label: string) =>
    href ? `<a href="${escapeHtml(href)}" style="display:inline-block;margin:12px 8px 0 0;padding:8px 14px;background:#0f6fff;color:#fff;border-radius:6px;text-decoration:none">${escapeHtml(label)}</a>` : '';
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;font-size:14px;color:#111">
<h2 style="margin:0 0 12px">${escapeHtml(HEADLINES[p.primary])}</h2>
<table style="border-collapse:collapse">${rows}</table>
${link(publicLink(p.url), 'Open Property')}${link(publicLink(p.detailUrl), 'Xem lịch sử')}${link(publicLink(p.screenshotUrl), 'Open snapshot')}
</body></html>`;
  return { subject, text, html };
}
