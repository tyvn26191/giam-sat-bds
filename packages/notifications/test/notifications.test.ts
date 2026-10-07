import { describe, expect, it, vi } from 'vitest';
import {
  EmailChannel,
  TelegramChannel,
  TelegramClient,
  createEmailProvider,
  formatEmail,
  formatTelegram,
  type NotificationPayload,
} from '../src';

const AT = Date.UTC(2026, 9, 7, 21, 15); // 2026/10/08 06:15 JST

function payload(over: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    primary: 'PRICE_DECREASE',
    types: ['PRICE_DECREASE'],
    severity: 'CRITICAL',
    propertyId: 'p1',
    title: '西尾市○○町 1号棟',
    site: 'SUUMO',
    url: 'https://suumo.jp/ikkodate/aichi/sc_nishio/nc_76543210/',
    detailUrl: 'https://watch.example.web.app/p/p1',
    at: AT,
    timezone: 'Asia/Tokyo',
    price: { oldPrice: 31_900_000, newPrice: 30_900_000, difference: -1_000_000, percentage: -3.1348 },
    currentPrice: 30_900_000,
    alerts: [],
    fieldChanges: [],
    textDiff: null,
    status: 'PRICE_CHANGED',
    error: null,
    match: null,
    screenshotUrl: null,
    ...over,
  };
}

function okFetch(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

describe('formatTelegram', () => {
  it('renders the price-decrease message in the requested format', () => {
    const m = formatTelegram(payload());
    expect(m.text).toBe(
      [
        '<b>🔴 GIÁ NHÀ GIẢM</b>',
        '',
        '<b>Tên:</b> 西尾市○○町 1号棟',
        '<b>Site:</b> SUUMO',
        '<b>Giá cũ:</b> 3,190万円',
        '<b>Giá mới:</b> 3,090万円',
        '<b>Giảm:</b> 100万円',
        '<b>Tỷ lệ:</b> -3.13%',
        '<b>Thời gian:</b> 2026/10/08 06:15',
      ].join('\n'),
    );
    expect(m.buttons).toEqual([
      [
        { text: 'Open Property', url: 'https://suumo.jp/ikkodate/aichi/sc_nishio/nc_76543210/' },
        { text: 'Xem lịch sử', url: 'https://watch.example.web.app/p/p1' },
      ],
    ]);
  });

  it('renders removed and updated messages', () => {
    const removed = formatTelegram(payload({ primary: 'REMOVED', types: ['REMOVED'], price: null, status: 'REMOVED' }));
    expect(removed.text).toContain('⚠️ PROPERTY REMOVED');
    expect(removed.text).toContain('REMOVED (Đã gỡ)');
    const updated = formatTelegram(
      payload({
        primary: 'FIELD_CHANGED',
        types: ['FIELD_CHANGED'],
        price: null,
        fieldChanges: [
          { label: '建物面積', before: '98.53m2', after: '99.10m2' },
          { label: '引渡時期', before: '即引渡可', after: '2026年12月上旬予定' },
          { label: '備考', before: 'A', after: 'B' },
        ],
      }),
    );
    expect(updated.text).toContain('🟡 PROPERTY UPDATED');
    expect(updated.text).toContain('Thay đổi:\n• 建物面積: 98.53m2 → 99.10m2\n• 引渡時期: 即引渡可 → 2026年12月上旬予定\n• 備考: A → B');
  });

  it('escapes HTML in property data', () => {
    const m = formatTelegram(payload({ title: '<b>罠</b> & "x"' }));
    expect(m.text).toContain('&lt;b&gt;罠&lt;/b&gt; &amp; &quot;x&quot;');
  });

  it('drops non-public links from buttons (Telegram rejects localhost)', () => {
    const m = formatTelegram(payload({ detailUrl: 'http://localhost:5180/p/p1' }));
    expect(m.buttons[0]).toHaveLength(1);
  });
});

describe('TelegramClient', () => {
  it('returns the message id on success', async () => {
    const f = okFetch({ ok: true, result: { message_id: 42 } });
    const c = new TelegramClient({ botToken: 'T', fetchImpl: f as unknown as typeof fetch });
    await expect(c.sendMessage('123', 'hi')).resolves.toEqual({ ok: true, messageId: '42' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/botT/sendMessage');
    expect(JSON.parse(init.body as string)).toMatchObject({ chat_id: '123', parse_mode: 'HTML' });
  });

  it('waits retry_after once on 429', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 2 } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), { status: 200 }));
    const sleep = vi.fn(async () => {});
    const c = new TelegramClient({ botToken: 'T', fetchImpl: f as unknown as typeof fetch, sleep });
    await expect(c.sendMessage('1', 'x')).resolves.toEqual({ ok: true, messageId: '7' });
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('reports API errors without retrying 400s', async () => {
    const f = okFetch({ ok: false, error_code: 400, description: 'Bad Request: chat not found' }, 400);
    const c = new TelegramClient({ botToken: 'SECRET', fetchImpl: f as unknown as typeof fetch });
    const r = await c.sendMessage('1', 'x');
    expect(r).toEqual({ ok: false, error: '400: Bad Request: chat not found', retryable: false });
    expect(JSON.stringify(r)).not.toContain('SECRET');
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('channels', () => {
  it('Telegram channel validates the chat id and needs a token', async () => {
    await expect(new TelegramChannel(null).send(payload(), '1')).resolves.toMatchObject({ ok: false, retryable: false });
    const ch = new TelegramChannel(new TelegramClient({ botToken: 'T', fetchImpl: okFetch({ ok: true, result: { message_id: 1 } }) as unknown as typeof fetch }));
    await expect(ch.send(payload(), 'not-a-chat')).resolves.toMatchObject({ ok: false });
    await expect(ch.send(payload(), '-1001234567890')).resolves.toEqual({ ok: true, messageId: '1' });
    await expect(ch.sendTest('@my_channel')).resolves.toMatchObject({ ok: true });
  });

  it('Email is optional: no provider configured → null', () => {
    expect(createEmailProvider({})).toBeNull();
    expect(createEmailProvider({ EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'a@b.jp' })).toBeNull();
    expect(createEmailProvider({ EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'a@b.jp', RESEND_API_KEY: 'k' })?.id).toBe('resend');
    expect(createEmailProvider({ EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'a@b.jp', SMTP_HOST: 'smtp.example.com' })?.id).toBe('smtp');
    expect(createEmailProvider({ EMAIL_PROVIDER: 'sendgrid', EMAIL_FROM: 'a@b.jp', SENDGRID_API_KEY: 'k' })?.id).toBe('sendgrid');
    expect(createEmailProvider({ EMAIL_PROVIDER: 'mailgun', EMAIL_FROM: 'a@b.jp', MAILGUN_API_KEY: 'k', MAILGUN_DOMAIN: 'mg.example.com' })?.id).toBe('mailgun');
  });

  it('Email channel sends through the provider', async () => {
    const f = okFetch({ id: 'em_1' });
    const ch = new EmailChannel(createEmailProvider({ EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'watch@example.com', RESEND_API_KEY: 'k' }, f as unknown as typeof fetch));
    await expect(ch.send(payload(), 'me@example.com')).resolves.toEqual({ ok: true, messageId: 'em_1' });
    await expect(ch.send(payload(), 'bad address')).resolves.toMatchObject({ ok: false });
    expect(new EmailChannel(null).isConfigured()).toBe(false);
  });

  it('formats email subject/body', () => {
    const e = formatEmail(payload());
    expect(e.subject).toBe('[Property Watch] GIÁ NHÀ GIẢM 3,190万円→3,090万円 – 西尾市○○町 1号棟');
    expect(e.text).toContain('Giảm: 100万円');
    expect(e.html).toContain('Open Property');
  });
});
