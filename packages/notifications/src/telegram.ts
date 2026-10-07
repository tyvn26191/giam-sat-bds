// Telegram Bot API client (sendMessage only). The bot token comes from Secret Manager / env.

export interface TelegramOptions {
  botToken: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export type TelegramResult = { ok: true; messageId: string } | { ok: false; error: string; retryable: boolean };

interface TelegramResponse {
  ok: boolean;
  result?: { message_id: number };
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class TelegramClient {
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: TelegramOptions) {
    this.apiBase = opts.apiBase ?? 'https://api.telegram.org';
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  async sendMessage(chatId: string, text: string, buttons: { text: string; url: string }[][] = []): Promise<TelegramResult> {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    };
    if (buttons.length) body.reply_markup = { inline_keyboard: buttons };

    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.apiBase}/bot${this.opts.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (e) {
        if (attempt === 0) {
          await this.sleep(1000);
          continue;
        }
        return { ok: false, error: `network: ${(e as Error).message}`, retryable: true };
      }
      let data: TelegramResponse;
      try {
        data = (await res.json()) as TelegramResponse;
      } catch {
        return { ok: false, error: `HTTP ${res.status}`, retryable: res.status >= 500 };
      }
      if (data.ok && data.result) return { ok: true, messageId: String(data.result.message_id) };
      const retryAfter = data.parameters?.retry_after;
      if (res.status === 429 && attempt === 0 && retryAfter !== undefined && retryAfter <= 30) {
        await this.sleep(retryAfter * 1000);
        continue;
      }
      // Never echo the token: the description comes from Telegram and does not contain it.
      return {
        ok: false,
        error: `${data.error_code ?? res.status}: ${data.description ?? 'unknown error'}`,
        retryable: res.status === 429 || res.status >= 500,
      };
    }
    return { ok: false, error: 'retry exhausted', retryable: true };
  }
}

export function isValidChatId(chatId: string | null | undefined): boolean {
  return !!chatId && /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/.test(chatId);
}
