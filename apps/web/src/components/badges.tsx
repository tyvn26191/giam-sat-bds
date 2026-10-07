import { CHANGE_LABEL_VI, SEVERITY_LABEL_VI, SITE_LABELS, STATUS_LABEL_VI, type ChangeType, type PropertyStatus, type Severity, type SiteId } from '@gsb/shared';

const STATUS_TONE: Record<PropertyStatus, string> = {
  PENDING: 'muted',
  ACTIVE: 'ok',
  PRICE_CHANGED: 'accent',
  UPDATED: 'warn',
  REMOVED: 'gray',
  NOT_FOUND: 'gray',
  BLOCKED: 'danger',
  ERROR: 'danger',
  PAUSED: 'muted',
};

export function StatusBadge({ status }: { status: PropertyStatus }) {
  return (
    <span className={`pill pill-${STATUS_TONE[status]}`} title={STATUS_LABEL_VI[status]}>
      {status}
    </span>
  );
}

export function SiteBadge({ site }: { site: SiteId }) {
  return <span className={`site site-${site.toLowerCase()}`}>{SITE_LABELS[site]}</span>;
}

const SEV_TONE: Record<Severity, string> = { CRITICAL: 'danger', HIGH: 'warn', MEDIUM: 'accent', LOW: 'muted' };

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`pill pill-${SEV_TONE[severity]}`}>{SEVERITY_LABEL_VI[severity]}</span>;
}

export function ChangeLabel({ type }: { type: ChangeType }) {
  return <strong>{CHANGE_LABEL_VI[type]}</strong>;
}

export function Confidence({ value, label }: { value: number; label: string }) {
  const pct = Math.round(value * 100);
  const tone = value >= 0.9 ? 'ok' : value >= 0.7 ? 'warn' : 'danger';
  return (
    <span className={`conf conf-${tone}`} title={`${label}: ${pct}%`}>
      {label} {pct}%
    </span>
  );
}
