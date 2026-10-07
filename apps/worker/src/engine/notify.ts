// Delivery with exactly-once intent: each (property, revision, channel) gets a deterministic
// notificationLogs id that is created before sending; a second attempt for the same change
// (overlapping runs, retries after a crash) finds the id and skips.

import { ConsoleChannel, type NotificationChannel, type NotificationPayload } from '@gsb/notifications';
import {
  type NotificationChannelId,
  type PropertyDoc,
  type UserSettings,
} from '@gsb/shared';
import type { Logger } from '../log';
import type { Store } from '../store/types';
import type { NotifyPlan } from './evaluate';
import { sha } from './hash';

export interface NotifierDeps {
  store: Store;
  channels: Record<NotificationChannelId, NotificationChannel>;
  /** Log messages instead of sending them (development). */
  dryRun: boolean;
  appUrl: string | null;
  now: () => number;
  logRetentionDays: number;
  log: Logger;
}

export interface DispatchResult {
  attempted: number;
  sent: number;
}

export class Notifier {
  private readonly dry: Record<NotificationChannelId, ConsoleChannel>;

  constructor(private readonly deps: NotifierDeps) {
    const log = (s: string) => deps.log.info(s);
    this.dry = { TELEGRAM: new ConsoleChannel('TELEGRAM', log), EMAIL: new ConsoleChannel('EMAIL', log) };
  }

  channel(id: NotificationChannelId): NotificationChannel {
    return this.deps.dryRun ? this.dry[id] : this.deps.channels[id];
  }

  isConfigured(id: NotificationChannelId): boolean {
    return this.deps.dryRun || this.deps.channels[id].isConfigured();
  }

  buildPayload(propertyId: string, prop: PropertyDoc, plan: NotifyPlan, at: number, timezone: string): NotificationPayload {
    return {
      primary: plan.primary,
      types: plan.types,
      severity: plan.severity,
      propertyId,
      title: prop.name || prop.title || prop.url,
      site: prop.site,
      url: prop.url,
      detailUrl: this.deps.appUrl ? `${this.deps.appUrl.replace(/\/$/, '')}/p/${propertyId}` : null,
      at,
      timezone,
      price: plan.price,
      currentPrice: plan.currentPrice,
      alerts: plan.alerts,
      fieldChanges: plan.fieldChanges.map((c) => ({ label: c.label, before: c.before, after: c.after })),
      textDiff: plan.textDiff,
      status: plan.status,
      error: plan.error,
      match: plan.match,
      screenshotUrl: null,
    };
  }

  recipients(prop: PropertyDoc, settings: UserSettings): [NotificationChannelId, string][] {
    const out: [NotificationChannelId, string][] = [];
    if (prop.notify.telegram && settings.telegram.enabled && settings.telegram.chatId) out.push(['TELEGRAM', settings.telegram.chatId]);
    if (prop.notify.email && settings.email.enabled && settings.email.to) out.push(['EMAIL', settings.email.to]);
    return out;
  }

  async dispatch(
    propertyId: string,
    prop: PropertyDoc,
    plan: NotifyPlan,
    settings: UserSettings,
    revision: number,
    changeIds: string[],
  ): Promise<DispatchResult> {
    const now = this.deps.now();
    const payload = this.buildPayload(propertyId, prop, plan, now, settings.timezone);
    const result: DispatchResult = { attempted: 0, sent: 0 };
    for (const [channelId, recipient] of this.recipients(prop, settings)) {
      const id = sha(`${propertyId}:${revision}:${channelId}`, 40);
      const created = await this.deps.store.createNotification(id, {
        ownerId: prop.ownerId,
        propertyId,
        changeIds,
        channel: channelId,
        type: plan.primary,
        severity: plan.severity,
        title: payload.title.slice(0, 200),
        dedupeKey: `${propertyId}:${revision}:${channelId}`,
        status: 'PENDING',
        messageId: null,
        error: null,
        attempts: 0,
        createdAt: now,
        sentAt: null,
        expireAt: now + this.deps.logRetentionDays * 86400_000,
        payload: JSON.stringify(payload),
        recipient,
        retryable: false,
      });
      if (!created) {
        this.deps.log.info('notification already sent for this change; skipped', { propertyId, revision, channel: channelId });
        continue;
      }
      result.attempted++;
      const ok = await this.send(id, channelId, payload, recipient, 1);
      if (ok) result.sent++;
    }
    return result;
  }

  private async send(id: string, channelId: NotificationChannelId, payload: NotificationPayload, recipient: string, attempt: number): Promise<boolean> {
    let r;
    try {
      r = await this.channel(channelId).send(payload, recipient);
    } catch (e) {
      r = { ok: false as const, error: (e as Error).message, retryable: true };
    }
    const now = this.deps.now();
    if (r.ok) {
      await this.deps.store.updateNotification(id, { status: this.deps.dryRun ? 'DRY_RUN' : 'SENT', messageId: r.messageId, sentAt: now, attempts: attempt, error: null });
      return true;
    }
    this.deps.log.warn('notification failed', { id, channel: channelId, error: r.error, attempt });
    await this.deps.store.updateNotification(id, { status: 'FAILED', error: r.error.slice(0, 500), attempts: attempt, retryable: r.retryable });
    return false;
  }

  /** Re-send failed, retryable notifications from the last 24 h (max 3 attempts). */
  async retryFailed(): Promise<number> {
    const now = this.deps.now();
    const failed = await this.deps.store.queryFailedNotifications(now - 86400_000, 50);
    let sent = 0;
    for (const { id, data } of failed) {
      if (!data.retryable || data.attempts >= 3) continue;
      const payload = JSON.parse(data.payload) as NotificationPayload;
      if (await this.send(id, data.channel, payload, data.recipient, data.attempts + 1)) sent++;
    }
    return sent;
  }
}
