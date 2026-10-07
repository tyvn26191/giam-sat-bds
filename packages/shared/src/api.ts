// HTTP API contract between the web app and the worker (/api/*).

import type { FieldKey } from './fields';
import type { SiteId } from './sites';
import type { ChangeType, PropertyStatus } from './status';
import type {
  CheckOutcome,
  Confidence,
  FetchMethod,
  NotificationChannelId,
  PropertySettings,
  Role,
} from './types';

export interface UrlPreview {
  url: string;
  finalUrl: string;
  site: SiteId;
  siteLabel: string;
  parser: string;
  method: FetchMethod | null;
  httpStatus: number | null;
  outcome: CheckOutcome;
  errorCode: string | null;
  errorMessage: string | null;
  title: string | null;
  price: number | null;
  priceDisplay: string | null;
  priceRaw: string | null;
  address: string | null;
  propertyCode: string | null;
  imageUrl: string | null;
  fields: Partial<Record<FieldKey, string>>;
  confidence: Confidence;
  needsReview: boolean;
  reviewReasons: string[];
  durationMs: number;
  /** Same URL already monitored by this user. */
  duplicateOf: { propertyId: string } | null;
}

export interface CreatePropertyRequest {
  url: string;
  settings?: Partial<PropertySettings>;
}

export interface CheckSummary {
  propertyId: string;
  outcome: CheckOutcome;
  status: PropertyStatus;
  changed: boolean;
  changeTypes: ChangeType[];
  price: number | null;
  priceDisplay: string | null;
  previousPrice: number | null;
  notificationSent: boolean;
  error: { code: string; message: string } | null;
  checkedAt: number;
  durationMs: number;
  method: FetchMethod | null;
}

export interface CreatePropertyResponse {
  id: string;
  check: CheckSummary | null;
}

export interface RunNowResponse {
  processed: number;
  changed: number;
  errors: number;
  remaining: number;
}

export interface TestNotificationRequest {
  channel: NotificationChannelId;
}

export interface TestNotificationResponse {
  success: boolean;
  channel: NotificationChannelId;
  messageId: string | null;
  error: string | null;
}

export interface MeResponse {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  role: Role | null;
  claimsUpdated: boolean;
  features: { browser: boolean; screenshots: boolean; telegram: boolean; email: boolean };
}

export interface ApiError {
  error: string;
  message: string;
}
