import type { NotificationChannelId } from '@gsb/shared';
import type { EmailProvider } from './email';
import { isValidEmail } from './email';
import { formatEmail, formatTelegram } from './format';
import { TelegramClient, isValidChatId } from './telegram';
import type { NotificationChannel, NotificationPayload, SendResult } from './types';

export class TelegramChannel implements NotificationChannel {
  readonly id = 'TELEGRAM' as const;
  constructor(private readonly client: TelegramClient | null) {}

  isConfigured(): boolean {
    return this.client !== null;
  }

  async send(payload: NotificationPayload, chatId: string): Promise<SendResult> {
    if (!this.client) return { ok: false, error: 'TELEGRAM_BOT_TOKEN chưa được cấu hình', retryable: false };
    if (!isValidChatId(chatId)) return { ok: false, error: 'Chat ID không hợp lệ', retryable: false };
    const msg = formatTelegram(payload);
    const r = await this.client.sendMessage(chatId, msg.text, msg.buttons);
    return r.ok ? { ok: true, messageId: r.messageId } : r;
  }

  async sendTest(chatId: string): Promise<SendResult> {
    if (!this.client) return { ok: false, error: 'TELEGRAM_BOT_TOKEN chưa được cấu hình', retryable: false };
    if (!isValidChatId(chatId)) return { ok: false, error: 'Chat ID không hợp lệ', retryable: false };
    const r = await this.client.sendMessage(chatId, '✅ <b>Property Watch</b>\nKết nối Telegram thành công. Bạn sẽ nhận thông báo thay đổi giá tại đây.');
    return r.ok ? { ok: true, messageId: r.messageId } : r;
  }
}

export class EmailChannel implements NotificationChannel {
  readonly id = 'EMAIL' as const;
  constructor(private readonly provider: EmailProvider | null) {}

  isConfigured(): boolean {
    return this.provider !== null;
  }

  async send(payload: NotificationPayload, to: string): Promise<SendResult> {
    if (!this.provider) return { ok: false, error: 'Email chưa được cấu hình (EMAIL_PROVIDER)', retryable: false };
    if (!isValidEmail(to)) return { ok: false, error: 'Địa chỉ email không hợp lệ', retryable: false };
    const m = formatEmail(payload);
    try {
      const r = await this.provider.send({ to, ...m });
      return { ok: true, messageId: r.messageId };
    } catch (e) {
      return { ok: false, error: (e as Error).message.slice(0, 300), retryable: true };
    }
  }

  async sendTest(to: string): Promise<SendResult> {
    if (!this.provider) return { ok: false, error: 'Email chưa được cấu hình (EMAIL_PROVIDER)', retryable: false };
    if (!isValidEmail(to)) return { ok: false, error: 'Địa chỉ email không hợp lệ', retryable: false };
    try {
      const r = await this.provider.send({
        to,
        subject: '[Property Watch] Email thử nghiệm',
        text: 'Kết nối email thành công. Bạn sẽ nhận thông báo thay đổi giá tại địa chỉ này.',
        html: '<p>Kết nối email thành công. Bạn sẽ nhận thông báo thay đổi giá tại địa chỉ này.</p>',
      });
      return { ok: true, messageId: r.messageId };
    } catch (e) {
      return { ok: false, error: (e as Error).message.slice(0, 300), retryable: true };
    }
  }
}

/** Logs instead of sending (local development / NOTIFY_DRY_RUN=true). */
export class ConsoleChannel implements NotificationChannel {
  readonly sent: { recipient: string; text: string }[] = [];
  constructor(readonly id: NotificationChannelId, private readonly log: (s: string) => void = console.log) {}
  isConfigured(): boolean {
    return true;
  }
  async send(payload: NotificationPayload, recipient: string): Promise<SendResult> {
    const text = this.id === 'TELEGRAM' ? formatTelegram(payload).text : formatEmail(payload).text;
    this.sent.push({ recipient, text });
    this.log(`[dry-run ${this.id} → ${recipient}]\n${text}\n`);
    return { ok: true, messageId: `dry-run-${this.sent.length}` };
  }
  async sendTest(recipient: string): Promise<SendResult> {
    this.log(`[dry-run ${this.id} → ${recipient}] test message`);
    return { ok: true, messageId: 'dry-run-test' };
  }
}
