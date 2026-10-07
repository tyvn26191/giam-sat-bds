import { Link } from 'react-router-dom';
import { formatPercent, formatRelativeVi, formatTime, formatYen } from '@gsb/shared';
import type { Property } from '../data';
import { displayName, displayStatus } from '../util';
import { SiteBadge, StatusBadge } from './badges';
import { Img } from './Img';

export function PropertyCard({ p, now, tz }: { p: Property; now: number; tz: string }) {
  const change = p.lastPriceChange;
  const down = change?.type === 'PRICE_DECREASE';
  const status = displayStatus(p);
  return (
    <Link to={`/p/${p.id}`} className={`card prop-card ${down ? 'is-down' : ''} ${status === 'PAUSED' ? 'is-paused' : ''}`}>
      <div className="prop-thumb">
        <Img src={p.imageUrl} />
        <SiteBadge site={p.site} />
      </div>
      <div className="prop-body">
        <h3 className="prop-title" title={displayName(p)}>
          {displayName(p)}
        </h3>
        {p.name && p.title && <p className="muted small clamp1">{p.title}</p>}
        <div className="prop-prices">
          {change && p.previousPrice !== null ? (
            <>
              <div className="price-old">{formatYen(p.previousPrice)}</div>
              <div className={`price-now ${down ? 'down' : 'up'}`}>
                {down ? '↓' : '↑'} {p.price !== null ? formatYen(p.price) : '—'} {down ? '🔴' : ''}
              </div>
              <div className={`price-diff ${down ? 'down' : 'up'}`}>
                {change.difference < 0 ? '-' : '+'}
                {formatYen(Math.abs(change.difference)).replace('-', '')}
                {change.percentage !== null && <span className="muted"> ({formatPercent(change.percentage)})</span>}
              </div>
            </>
          ) : (
            <div className="price-now">{p.price !== null ? formatYen(p.price) : <span className="muted">Chưa có giá</span>}</div>
          )}
        </div>
        <div className="prop-meta">
          <StatusBadge status={status} />
          {p.needsReview && <span className="pill pill-warn" title={p.reviewReasons.join(', ')}>NEEDS_REVIEW</span>}
          {p.lastNotification && (
            <span className={`pill ${p.lastNotification.ok ? 'pill-ok' : 'pill-danger'}`} title={`Thông báo ${p.lastNotification.type}`}>
              🔔 {p.lastNotification.ok ? 'đã gửi' : 'lỗi gửi'}
            </span>
          )}
        </div>
        <div className="muted small">
          Last check: {p.lastCheckedAt ? `${formatTime(p.lastCheckedAt, tz)} (${formatRelativeVi(p.lastCheckedAt, now)})` : 'chưa'}
          {p.groups.length > 0 && <span> · {p.groups.join(', ')}</span>}
        </div>
      </div>
    </Link>
  );
}
