import type { ChangeType, NotificationChannelId, PropertyStatus, Severity, SiteId, TextDiff } from '@gsb/shared';

/** Everything a channel needs to render one notification (one per property per check). */
export interface NotificationPayload {
  primary: ChangeType;
  types: ChangeType[];
  severity: Severity;
  propertyId: string;
  title: string;
  site: SiteId;
  url: string;
  /** Link to the property page in the web app (only used when it is a public https URL). */
  detailUrl: string | null;
  at: number;
  timezone: string;
  price: { oldPrice: number; newPrice: number; difference: number; percentage: number | null } | null;
  currentPrice: number | null;
  alerts: string[];
  fieldChanges: { label: string; before: string | null; after: string | null }[];
  textDiff: TextDiff | null;
  status: PropertyStatus | null;
  error: { code: string; message: string } | null;
  match: { url: string; title: string | null; confidence: number; oldPrice: number | null } | null;
  screenshotUrl: string | null;
}

export type SendResult =
  | { ok: true; messageId: string | null }
  | { ok: false; error: string; retryable: boolean };

/**
 * A delivery channel. Telegram and Email ship today; LINE / Discord / Webhook only need a new
 * class implementing this interface and a recipient field in the user settings.
 */
export interface NotificationChannel {
  readonly id: NotificationChannelId;
  isConfigured(): boolean;
  send(payload: NotificationPayload, recipient: string): Promise<SendResult>;
  sendTest(recipient: string): Promise<SendResult>;
}
