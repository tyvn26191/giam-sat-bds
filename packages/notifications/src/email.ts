// Email provider abstraction. Pick one with EMAIL_PROVIDER; when nothing is configured the
// system keeps working with Telegram only.

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailProvider {
  readonly id: string;
  send(msg: EmailMessage): Promise<{ messageId: string | null }>;
}

type Env = Record<string, string | undefined>;

async function postJson(fetchImpl: typeof fetch, url: string, headers: Record<string, string>, body: unknown) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

export class ResendProvider implements EmailProvider {
  readonly id = 'resend';
  constructor(private apiKey: string, private from: string, private fetchImpl: typeof fetch = fetch) {}
  async send(msg: EmailMessage) {
    const res = await postJson(this.fetchImpl, 'https://api.resend.com/emails', { authorization: `Bearer ${this.apiKey}` }, {
      from: this.from,
      to: [msg.to],
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { messageId: data.id ?? null };
  }
}

export class SendGridProvider implements EmailProvider {
  readonly id = 'sendgrid';
  constructor(private apiKey: string, private from: string, private fetchImpl: typeof fetch = fetch) {}
  async send(msg: EmailMessage) {
    const res = await postJson(this.fetchImpl, 'https://api.sendgrid.com/v3/mail/send', { authorization: `Bearer ${this.apiKey}` }, {
      personalizations: [{ to: [{ email: msg.to }] }],
      from: { email: this.from },
      subject: msg.subject,
      content: [
        { type: 'text/plain', value: msg.text },
        { type: 'text/html', value: msg.html },
      ],
    });
    return { messageId: res.headers.get('x-message-id') };
  }
}

export class MailgunProvider implements EmailProvider {
  readonly id = 'mailgun';
  constructor(
    private apiKey: string,
    private domain: string,
    private from: string,
    private region: 'us' | 'eu' = 'us',
    private fetchImpl: typeof fetch = fetch,
  ) {}
  async send(msg: EmailMessage) {
    const base = this.region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';
    const form = new URLSearchParams({ from: this.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
    const res = await this.fetchImpl(`${base}/v3/${encodeURIComponent(this.domain)}/messages`, {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`api:${this.apiKey}`).toString('base64')}` },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { messageId: data.id ?? null };
  }
}

export class SmtpProvider implements EmailProvider {
  readonly id = 'smtp';
  private transport: Promise<{ sendMail(o: object): Promise<{ messageId?: string }> }> | null = null;
  constructor(private cfg: { host: string; port: number; secure: boolean; user?: string; pass?: string; from: string }) {}
  private getTransport() {
    this.transport ??= import('nodemailer').then((m) =>
      m.default.createTransport({
        host: this.cfg.host,
        port: this.cfg.port,
        secure: this.cfg.secure,
        auth: this.cfg.user ? { user: this.cfg.user, pass: this.cfg.pass } : undefined,
      }),
    );
    return this.transport;
  }
  async send(msg: EmailMessage) {
    const t = await this.getTransport();
    const info = await t.sendMail({ from: this.cfg.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
    return { messageId: info.messageId ?? null };
  }
}

/** Build the provider from env; returns null when email is not configured. */
export function createEmailProvider(env: Env, fetchImpl: typeof fetch = fetch): EmailProvider | null {
  const provider = (env.EMAIL_PROVIDER ?? 'none').toLowerCase();
  const from = env.EMAIL_FROM;
  if (provider === 'none' || !from) return null;
  switch (provider) {
    case 'resend':
      return env.RESEND_API_KEY ? new ResendProvider(env.RESEND_API_KEY, from, fetchImpl) : null;
    case 'sendgrid':
      return env.SENDGRID_API_KEY ? new SendGridProvider(env.SENDGRID_API_KEY, from, fetchImpl) : null;
    case 'mailgun':
      return env.MAILGUN_API_KEY && env.MAILGUN_DOMAIN
        ? new MailgunProvider(env.MAILGUN_API_KEY, env.MAILGUN_DOMAIN, from, env.MAILGUN_REGION === 'eu' ? 'eu' : 'us', fetchImpl)
        : null;
    case 'smtp': {
      if (!env.SMTP_HOST) return null;
      const port = Number(env.SMTP_PORT ?? 587);
      return new SmtpProvider({
        host: env.SMTP_HOST,
        port,
        secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
        from,
      });
    }
    default:
      return null;
  }
}

export function isValidEmail(s: string | null | undefined): boolean {
  return !!s && s.length <= 254 && /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[A-Za-z]{2,}$/.test(s);
}
