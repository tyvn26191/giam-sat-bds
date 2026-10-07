export { ConsoleChannel, EmailChannel, TelegramChannel } from './channels';
export {
  MailgunProvider,
  ResendProvider,
  SendGridProvider,
  SmtpProvider,
  createEmailProvider,
  isValidEmail,
  type EmailMessage,
  type EmailProvider,
} from './email';
export { HEADLINES, escapeHtml, formatEmail, formatTelegram, messageLines } from './format';
export { TelegramClient, isValidChatId, type TelegramResult } from './telegram';
export type { NotificationChannel, NotificationPayload, SendResult } from './types';
