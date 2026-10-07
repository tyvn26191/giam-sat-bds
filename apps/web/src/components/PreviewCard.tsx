import { FIELD_DEF, formatManYen, type FieldKey, type UrlPreview } from '@gsb/shared';
import { REVIEW_REASON_VI } from '../util';
import { Confidence, SiteBadge } from './badges';
import { Img } from './Img';

const OUTCOME_HELP: Record<string, string> = {
  BLOCKED:
    'Website chặn truy cập tự động (CAPTCHA / 403 / robots.txt). Hệ thống sẽ KHÔNG cố vượt qua. Bạn vẫn có thể lưu để thử lại sau, nhưng có thể không theo dõi được trang này.',
  REMOVED: 'Trang không còn (404 / tin đã gỡ / chuyển hướng về trang tìm kiếm).',
  ERROR: 'Không đọc được dữ liệu từ trang.',
};

export function PreviewCard({ p }: { p: UrlPreview }) {
  const ok = p.outcome === 'OK';
  return (
    <div className={`card preview ${ok ? '' : 'preview-bad'}`}>
      <div className="preview-head">
        {p.imageUrl && <Img src={p.imageUrl} className="preview-img" />}
        <div className="stack-sm">
          <div className="row wrap">
            <span className="muted small">Detected site:</span> <SiteBadge site={p.site} />
            <span className="muted small">
              {p.method ?? '—'} · HTTP {p.httpStatus ?? '—'} · {p.parser} · {p.durationMs} ms
            </span>
          </div>
          <h3>{p.title ?? <span className="muted">Không tìm thấy tiêu đề</span>}</h3>
        </div>
      </div>

      {!ok && (
        <p className="notice notice-error">
          <strong>{p.outcome}</strong> — {p.errorCode}: {p.errorMessage}
          <br />
          {OUTCOME_HELP[p.outcome] ?? ''}
        </p>
      )}
      {p.duplicateOf && <p className="notice notice-warn">URL này đã được theo dõi.</p>}

      <dl className="kv">
        <dt>Detected price</dt>
        <dd>
          {p.price !== null ? (
            <>
              <strong className="big">{p.priceDisplay ?? formatManYen(p.price)}</strong> <span className="muted">(¥{p.price.toLocaleString('en-US')})</span>{' '}
              <Confidence value={p.confidence.price} label="tin cậy" />
              {p.priceRaw && <div className="muted small">Văn bản gốc: 「{p.priceRaw}」</div>}
            </>
          ) : (
            <span className="muted">Không tìm thấy</span>
          )}
        </dd>
        <dt>Detected address</dt>
        <dd>
          {p.address ?? <span className="muted">Không tìm thấy</span>} {p.address && <Confidence value={p.confidence.address} label="tin cậy" />}
        </dd>
        <dt>Detected property ID</dt>
        <dd>{p.propertyCode ?? <span className="muted">—</span>}</dd>
        {(Object.entries(p.fields) as [FieldKey, string][])
          .filter(([k]) => k !== 'address' && k !== 'propertyCode')
          .map(([k, v]) => (
            <FieldRow key={k} k={k} v={v} />
          ))}
      </dl>

      {p.needsReview && (
        <div className="notice notice-warn">
          <strong>NEEDS_REVIEW</strong> — dữ liệu chưa chắc chắn, hệ thống sẽ không tự tin gửi thông báo giá dựa trên phần này:
          <ul>
            {p.reviewReasons.map((r) => (
              <li key={r}>{REVIEW_REASON_VI[r] ?? r}</li>
            ))}
          </ul>
          Có thể nhập CSS selector thủ công ở mục “Nâng cao”.
        </div>
      )}
    </div>
  );
}

function FieldRow({ k, v }: { k: FieldKey; v: string }) {
  return (
    <>
      <dt>{FIELD_DEF[k]?.ja ?? k}</dt>
      <dd>{v}</dd>
    </>
  );
}
