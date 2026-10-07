import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  CHANGE_LABEL_VI,
  FIELD_DEF,
  SEVERITY_RANK,
  STATUS_LABEL_VI,
  formatDate,
  formatDateTime,
  formatDiffManYen,
  formatManYen,
  formatPercent,
  formatRelativeVi,
  withUserDefaults,
  type ChangeRecord,
  type CheckSummary,
  type FieldKey,
  type SnapshotRecord,
} from '@gsb/shared';
import { api, errorText } from '../api';
import { useMe } from '../auth';
import { Confidence, SeverityBadge, SiteBadge, StatusBadge } from '../components/badges';
import { IconExternal, IconPause, IconPlay, IconRefresh } from '../components/icons';
import { Img } from '../components/Img';
import { PriceChart } from '../components/PriceChart';
import { useToast } from '../components/Toast';
import {
  fromFs,
  loadSnapshots,
  useChanges,
  useMonitorLogs,
  useNotificationLogs,
  usePriceHistory,
  useProperty,
  useUserDoc,
  type Property,
  type WithId,
} from '../data';
import { db } from '../firebase';
import { REVIEW_REASON_VI, displayName, displayStatus, totalDrop } from '../util';

type Tab = 'changes' | 'snapshots' | 'checks' | 'notifications';

export function PropertyDetailPage() {
  const { id = '' } = useParams();
  const { uid } = useMe();
  const tz = withUserDefaults(useUserDoc(uid).data?.settings).timezone;
  const { data: p, loading, error } = useProperty(id);
  const [tab, setTab] = useState<Tab>('changes');
  const now = Date.now();

  if (loading) return <p className="page muted">Đang tải…</p>;
  if (error || !p) {
    return (
      <div className="page">
        <p className="notice notice-error">{error ?? 'Không tìm thấy property (có thể đã bị xóa).'}</p>
        <Link to="/">← Về danh sách</Link>
      </div>
    );
  }

  return (
    <div className="page">
      <Header p={p} tz={tz} now={now} />
      <div className="detail-grid">
        <PriceSection p={p} tz={tz} now={now} />
        <InfoSection p={p} tz={tz} now={now} />
      </div>
      <div className="tabs" role="tablist">
        {(
          [
            ['changes', 'Lịch sử thay đổi'],
            ['snapshots', 'Snapshot'],
            ['checks', 'Log kiểm tra / lỗi'],
            ['notifications', 'Thông báo'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'changes' && <ChangesSection p={p} tz={tz} />}
      {tab === 'snapshots' && <SnapshotsSection p={p} tz={tz} />}
      {tab === 'checks' && <ChecksSection p={p} uid={uid} tz={tz} />}
      {tab === 'notifications' && <NotificationsSection p={p} uid={uid} tz={tz} />}
    </div>
  );
}

function Header({ p, tz, now }: { p: Property; tz: string; now: number }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const status = displayStatus(p);

  const checkNow = async () => {
    setBusy('check');
    try {
      const r = await api<CheckSummary>(`/api/properties/${p.id}/check`, { method: 'POST' });
      const what = r.changed ? `Có thay đổi: ${r.changeTypes.map((t) => CHANGE_LABEL_VI[t]).join(', ')}` : 'Không có thay đổi';
      toast(`${r.outcome} · ${what}${r.error ? ` · ${r.error.code}` : ''} (${(r.durationMs / 1000).toFixed(1)}s)`, r.outcome === 'OK' || r.outcome === 'NOT_MODIFIED' ? 'ok' : 'error');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  const togglePause = async () => {
    setBusy('pause');
    try {
      await updateDoc(doc(db, 'properties', p.id), { enabled: !p.enabled, pausedByAll: false, updatedAt: serverTimestamp() });
      toast(p.enabled ? 'Đã tạm dừng giám sát' : 'Đã bật lại giám sát', 'ok');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Xóa "${displayName(p)}" và toàn bộ lịch sử giá/thay đổi? Không thể hoàn tác.`)) return;
    setBusy('delete');
    try {
      await api(`/api/properties/${p.id}`, { method: 'DELETE' });
      toast('Đã xóa', 'ok');
      navigate('/');
    } catch (e) {
      toast(errorText(e), 'error');
      setBusy(null);
    }
  };

  return (
    <div className="detail-head card">
      <div className="detail-photo">
        <Img src={p.imageUrl} />
      </div>
      <div className="stack-sm grow">
        <Link to="/" className="muted small">
          ← Danh sách
        </Link>
        <div className="row wrap">
          <SiteBadge site={p.site} />
          <StatusBadge status={status} />
          {p.needsReview && <span className="pill pill-warn">NEEDS_REVIEW</span>}
          {p.groups.map((g) => (
            <span key={g} className="pill pill-muted">
              {g}
            </span>
          ))}
        </div>
        <h1 className="detail-title">{displayName(p)}</h1>
        {p.name && p.title && <p className="muted">{p.title}</p>}
        <p className="muted small">
          {STATUS_LABEL_VI[status]} · Last check {p.lastCheckedAt ? `${formatDateTime(p.lastCheckedAt, tz)} (${formatRelativeVi(p.lastCheckedAt, now)})` : 'chưa'} · Kế tiếp{' '}
          {p.enabled ? formatDateTime(p.nextCheckAt, tz) : '— (tạm dừng)'}
        </p>
        <div className="row wrap">
          <a className="btn btn-primary" href={p.url} target="_blank" rel="noopener noreferrer">
            <IconExternal /> Open original URL
          </a>
          <button className="btn" onClick={() => void checkNow()} disabled={!!busy}>
            <IconRefresh /> {busy === 'check' ? 'Đang kiểm tra…' : 'Check now'}
          </button>
          <button className="btn" onClick={() => void togglePause()} disabled={!!busy}>
            {p.enabled ? <IconPause /> : <IconPlay />} {p.enabled ? 'Tạm dừng' : 'Tiếp tục'}
          </button>
          <Link className="btn" to={`/p/${p.id}/edit`}>
            Sửa
          </Link>
          <button className="btn btn-danger" onClick={() => void remove()} disabled={!!busy}>
            Xóa
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'down' | 'up' }) {
  return (
    <div className="stat">
      <span className="muted small">{label}</span>
      <strong className={tone ?? ''}>{value}</strong>
    </div>
  );
}

function PriceSection({ p, tz, now }: { p: Property; tz: string; now: number }) {
  const history = usePriceHistory(p.id);
  const s = p.priceStats;
  const drop = totalDrop(p);
  const c = p.lastPriceChange;
  return (
    <section className="card stack">
      <h2>Giá</h2>
      <div className="price-hero">
        <div>
          <span className="muted small">Giá hiện tại</span>
          <div className="hero-number">{p.price !== null ? formatManYen(p.price) : '—'}</div>
          {p.price !== null && <span className="muted">¥{p.price.toLocaleString('en-US')}</span>}
        </div>
        {c && (
          <div className={`change-chip ${c.type === 'PRICE_DECREASE' ? 'down' : 'up'}`}>
            <span>
              {formatManYen(c.oldPrice)} → {formatManYen(c.newPrice)}
            </span>
            <strong>
              {formatDiffManYen(c.difference)} {c.percentage !== null ? `(${formatPercent(c.percentage)})` : ''}
            </strong>
            <span className="small">{formatDateTime(c.at, tz)}</span>
          </div>
        )}
      </div>
      <div className="stats">
        <Stat label="Giá cũ (trước lần đổi)" value={p.previousPrice !== null ? formatManYen(p.previousPrice) : '—'} />
        <Stat label="Giá ban đầu" value={s.initial !== null ? formatManYen(s.initial) : '—'} />
        <Stat label="Giá cao nhất" value={s.max !== null ? formatManYen(s.max) : '—'} />
        <Stat label="Giá thấp nhất" value={s.min !== null ? formatManYen(s.min) : '—'} />
        <Stat label="Tổng mức giảm" value={drop ? `-${formatManYen(drop.amount)}` : '0円'} tone={drop ? 'down' : undefined} />
        <Stat label="Tổng % giảm" value={drop ? `-${drop.percent.toFixed(2)}%` : '0%'} tone={drop ? 'down' : undefined} />
        <Stat label="Số lần giảm giá" value={String(s.dropCount)} />
        <Stat label="Ngày giảm đầu tiên" value={s.firstDropAt ? formatDate(s.firstDropAt, tz) : '—'} />
        <Stat label="Ngày giảm gần nhất" value={s.lastDropAt ? formatDate(s.lastDropAt, tz) : '—'} />
      </div>
      <h3>Giá theo thời gian</h3>
      <PriceChart points={history.data.map((h) => ({ at: h.at, price: h.price }))} now={now} tz={tz} />
      {history.data.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>Giá</th>
                <th>Thay đổi</th>
              </tr>
            </thead>
            <tbody>
              {[...history.data].reverse().map((h) => (
                <tr key={h.id}>
                  <td>{formatDateTime(h.at, tz)}</td>
                  <td>
                    <strong>{formatManYen(h.price)}</strong> <span className="muted small">¥{h.price.toLocaleString('en-US')}</span>
                  </td>
                  <td className={h.changeType === 'PRICE_DECREASE' ? 'down' : h.changeType === 'PRICE_INCREASE' ? 'up' : 'muted'}>
                    {h.difference !== null ? `${formatDiffManYen(h.difference)} (${h.percentage !== null ? formatPercent(h.percentage) : '?'})` : 'Giá đầu tiên'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function InfoSection({ p, tz, now }: { p: Property; tz: string; now: number }) {
  return (
    <section className="card stack">
      {p.needsReview && (
        <div className="notice notice-warn">
          <strong>NEEDS_REVIEW</strong>
          <ul>
            {p.reviewReasons.map((r) => (
              <li key={r}>{REVIEW_REASON_VI[r] ?? r}</li>
            ))}
          </ul>
          <Link to={`/p/${p.id}/edit`}>Đặt CSS selector thủ công →</Link>
        </div>
      )}
      {p.lastError && (p.status === 'ERROR' || p.status === 'BLOCKED' || p.failure) && (
        <div className={`notice ${p.status === 'BLOCKED' ? 'notice-error' : 'notice-warn'}`}>
          <strong>{p.lastError.code}</strong>: {p.lastError.message}
          <div className="small muted">
            {formatDateTime(p.lastError.at, tz)}
            {p.failure && ` · liên tiếp ${p.failure.count} lần (${p.failure.kind})`}
          </div>
          {p.status === 'BLOCKED' && <div className="small">Website chặn truy cập tự động. Hệ thống không vượt CAPTCHA/bot protection; sẽ thử lại thưa hơn.</div>}
        </div>
      )}
      {p.matches.length > 0 && (
        <div className="notice notice-info">
          <strong>🔁 Possible same property</strong>
          <ul>
            {p.matches.map((m) => (
              <li key={m.propertyId}>
                <Link to={`/p/${m.propertyId}`}>{m.title ?? m.url}</Link> — độ tin cậy {Math.round(m.confidence * 100)}% · {m.status}
                {m.price !== null && ` · ${formatManYen(m.price)}`}
                <div className="muted small">{m.reasons.join(' · ')}</div>
              </li>
            ))}
          </ul>
          <span className="muted small">Không khẳng định 100% — chỉ là gợi ý dựa trên địa chỉ, diện tích, bố cục, số căn.</span>
        </div>
      )}
      <h2>Thông tin</h2>
      <dl className="kv">
        <dt>URL</dt>
        <dd className="break">
          <a href={p.url} target="_blank" rel="noopener noreferrer">
            {p.url}
          </a>
        </dd>
        <dt>Địa chỉ</dt>
        <dd>{p.address ?? '—'}</dd>
        <dt>Mã property</dt>
        <dd>{p.propertyCode ?? '—'}</dd>
        {(Object.entries(p.fields) as [FieldKey, string][])
          .filter(([k]) => k !== 'address' && k !== 'propertyCode')
          .map(([k, v]) => (
            <Row key={k} label={FIELD_DEF[k]?.ja ?? k} value={v} />
          ))}
      </dl>
      {p.confidence && (
        <div className="row wrap">
          <Confidence value={p.confidence.price} label="Giá" />
          <Confidence value={p.confidence.address} label="Địa chỉ" />
          <Confidence value={p.confidence.title} label="Tiêu đề" />
        </div>
      )}
      <h3>Giám sát</h3>
      <dl className="kv small">
        <dt>Chu kỳ</dt>
        <dd>
          {p.intervalMin} phút · {p.monitorMode === 'FULL' ? 'toàn trang' : 'vùng quan trọng'}
        </dd>
        <dt>Thông báo</dt>
        <dd>
          {[p.notify.telegram && 'Telegram', p.notify.email && 'Email'].filter(Boolean).join(', ') || 'tắt'} · theo dõi{' '}
          {[p.track.price && 'giá', p.track.content && 'nội dung', p.track.image && 'ảnh'].filter(Boolean).join(', ')}
        </dd>
        <dt>Cảnh báo</dt>
        <dd>
          {[
            p.alerts.priceAtOrBelow && `giá ≤ ${formatManYen(p.alerts.priceAtOrBelow)}`,
            p.alerts.dropAmountAtLeast && `giảm ≥ ${formatManYen(p.alerts.dropAmountAtLeast)}`,
            p.alerts.dropPercentAtLeast && `giảm ≥ ${p.alerts.dropPercentAtLeast}%`,
          ]
            .filter(Boolean)
            .join(' · ') || '—'}
          {p.alerts.only && ' (chỉ báo khi đạt ngưỡng)'}
        </dd>
        <dt>Parser</dt>
        <dd>
          {p.parser ?? '—'} · {p.method ?? '—'} · HTTP {p.httpStatus ?? '—'}
          {p.needsBrowser && ' · cần Playwright'}
        </dd>
        <dt>Lần OK gần nhất</dt>
        <dd>{p.lastSuccessAt ? `${formatDateTime(p.lastSuccessAt, tz)} (${formatRelativeVi(p.lastSuccessAt, now)})` : '—'}</dd>
        <dt>Thêm lúc</dt>
        <dd>{formatDateTime(p.createdAt, tz)}</dd>
        {p.note && (
          <>
            <dt>Ghi chú</dt>
            <dd>{p.note}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function ChangesSection({ p, tz }: { p: Property; tz: string }) {
  const { data: raw, loading } = useChanges(p.id);
  // Same check → same timestamp: show the most severe change first.
  const data = [...raw].sort((a, b) => b.at - a.at || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  const [snap, setSnap] = useState<{ title: string; s: SnapshotRecord } | null>(null);
  const toast = useToast();
  const openSnapshot = async (sid: string | null, title: string) => {
    if (!sid) return;
    const d = await getDoc(doc(db, 'properties', p.id, 'snapshots', sid));
    if (!d.exists()) {
      toast('Snapshot đã hết hạn lưu trữ', 'info');
      return;
    }
    setSnap({ title, s: fromFs<SnapshotRecord>(d.data()) });
  };
  const openArtifact = async (path: string) => {
    try {
      const r = await api<{ url: string }>(`/api/properties/${p.id}/artifact?path=${encodeURIComponent(path)}`);
      window.open(r.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  if (loading) return <p className="muted">Đang tải…</p>;
  if (data.length === 0) return <p className="muted">Chưa có thay đổi nào. Lần kiểm tra đầu tiên được dùng làm mốc so sánh.</p>;
  return (
    <div className="stack">
      {data.map((c) => (
        <ChangeItem
          key={c.id}
          c={c}
          tz={tz}
          onSnapshot={(sid, t) => void openSnapshot(sid, t)}
          onArtifact={(path) => void openArtifact(path)}
        />
      ))}
      {snap && <SnapshotModal title={snap.title} s={snap.s} tz={tz} onClose={() => setSnap(null)} />}
    </div>
  );
}

function ChangeItem({
  c,
  tz,
  onSnapshot,
  onArtifact,
}: {
  c: WithId<ChangeRecord>;
  tz: string;
  onSnapshot: (id: string | null, title: string) => void;
  onArtifact: (path: string) => void;
}) {
  const priceDown = c.type === 'PRICE_DECREASE';
  return (
    <article className={`card change change-${c.type.toLowerCase()}`}>
      <div className="row wrap between">
        <div className="row wrap">
          <SeverityBadge severity={c.severity} />
          <strong>{CHANGE_LABEL_VI[c.type]}</strong>
          <span className="muted small">{c.type}</span>
        </div>
        <span className="muted small">{formatDateTime(c.at, tz)}</span>
      </div>
      {c.oldPrice !== null && c.newPrice !== null && c.difference !== null && (
        <p className={priceDown ? 'down' : c.difference > 0 ? 'up' : ''}>
          {formatManYen(c.oldPrice)} → <strong>{formatManYen(c.newPrice)}</strong> ({formatDiffManYen(c.difference)}
          {c.percentage !== null && `, ${formatPercent(c.percentage)}`})
        </p>
      )}
      {c.message && c.fieldChanges.length === 0 && !c.textDiff && c.type !== 'PRICE_DECREASE' && c.type !== 'PRICE_INCREASE' && <p className="small">{c.message}</p>}
      {c.fieldChanges.length > 0 && (
        <div className="table-wrap">
          <table className="table diff-table">
            <thead>
              <tr>
                <th>Mục</th>
                <th>Trước</th>
                <th>Sau</th>
              </tr>
            </thead>
            <tbody>
              {c.fieldChanges.map((f) => (
                <tr key={f.key}>
                  <td>{f.label}</td>
                  <td className="del">{f.before ?? '—'}</td>
                  <td className="ins">{f.after ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {c.textDiff && (c.textDiff.added.length > 0 || c.textDiff.removed.length > 0) && (
        <pre className="textdiff">
          {c.textDiff.removed.map((l, i) => (
            <span key={`r${i}`} className="del">
              − {l}
              {'\n'}
            </span>
          ))}
          {c.textDiff.added.map((l, i) => (
            <span key={`a${i}`} className="ins">
              + {l}
              {'\n'}
            </span>
          ))}
        </pre>
      )}
      <div className="row wrap small">
        {c.beforeSnapshotId && (
          <button className="link" onClick={() => onSnapshot(c.beforeSnapshotId, 'Snapshot trước')}>
            Snapshot trước
          </button>
        )}
        {c.afterSnapshotId && (
          <button className="link" onClick={() => onSnapshot(c.afterSnapshotId, 'Snapshot sau')}>
            Snapshot sau
          </button>
        )}
        {c.screenshotPath && (
          <button className="link" onClick={() => onArtifact(c.screenshotPath!)}>
            Open snapshot (ảnh chụp)
          </button>
        )}
      </div>
    </article>
  );
}

function SnapshotModal({ title, s, tz, onClose }: { title: string; s: SnapshotRecord; tz: string; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>
            {title} · {formatDateTime(s.at, tz)}
          </h2>
          <button className="btn" onClick={onClose}>
            Đóng
          </button>
        </div>
        <dl className="kv small">
          <dt>Giá</dt>
          <dd>{s.priceDisplay ?? '—'}</dd>
          <dt>Tiêu đề</dt>
          <dd>{s.title ?? '—'}</dd>
          <dt>Địa chỉ</dt>
          <dd>{s.address ?? '—'}</dd>
          <dt>Phương thức</dt>
          <dd>
            {s.method} · HTTP {s.httpStatus ?? '—'} · {s.parser}
          </dd>
          <dt>Hash</dt>
          <dd className="mono">{s.hashes.snapshot}</dd>
        </dl>
        <h3>Nội dung đã chuẩn hóa</h3>
        <pre className="snapshot-text">{s.normalizedText}</pre>
      </div>
    </div>
  );
}

function SnapshotsSection({ p, tz }: { p: Property; tz: string }) {
  const [list, setList] = useState<WithId<SnapshotRecord>[] | null>(null);
  const [open, setOpen] = useState<WithId<SnapshotRecord> | null>(null);
  useEffect(() => {
    void loadSnapshots(p.id, 10).then(setList);
  }, [p.id, p.lastSnapshotId]);
  if (!list) return <p className="muted">Đang tải…</p>;
  if (list.length === 0) return <p className="muted">Chưa có snapshot.</p>;
  return (
    <div className="table-wrap">
      <p className="muted small">Snapshot chỉ được lưu ở lần kiểm tra đầu tiên và khi có thay đổi (tiết kiệm chi phí). Hiển thị 10 bản gần nhất.</p>
      <table className="table">
        <thead>
          <tr>
            <th>Thời gian</th>
            <th>Giá</th>
            <th>Phương thức</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.id}>
              <td>{formatDateTime(s.at, tz)}</td>
              <td>{s.priceDisplay ?? '—'}</td>
              <td className="small">
                {s.method} · {s.parser}
              </td>
              <td>
                <button className="link" onClick={() => setOpen(s)}>
                  Xem
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && <SnapshotModal title="Snapshot" s={open} tz={tz} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ChecksSection({ p, uid, tz }: { p: Property; uid: string; tz: string }) {
  const { data, loading, error } = useMonitorLogs(uid, p.id, 50);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const rows = errorsOnly ? data.filter((l) => l.error) : data;
  if (loading) return <p className="muted">Đang tải…</p>;
  return (
    <div className="stack">
      {error && <p className="notice notice-error">{error}</p>}
      <label className="check">
        <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> Chỉ lỗi (error log)
      </label>
      <div className="table-wrap">
        <table className="table small">
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Kết quả</th>
              <th>Method</th>
              <th>HTTP</th>
              <th>Giá đọc được</th>
              <th>Thay đổi</th>
              <th>Lỗi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td>{formatDateTime(l.startedAt, tz)}</td>
                <td>
                  {l.outcome} <span className="muted">{l.trigger}</span>
                </td>
                <td>{l.method ?? '—'}</td>
                <td>{l.httpStatus ?? '—'}</td>
                <td>{l.priceDetected !== null ? formatManYen(l.priceDetected) : '—'}</td>
                <td>{l.changed ? l.changeTypes.join(', ') : '—'}</td>
                <td className="break">{l.error ? `${l.error.code}: ${l.error.message}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="muted">Không có log.</p>}
    </div>
  );
}

function NotificationsSection({ p, uid, tz }: { p: Property; uid: string; tz: string }) {
  const { data, loading, error } = useNotificationLogs(uid, p.id);
  if (loading) return <p className="muted">Đang tải…</p>;
  if (error) return <p className="notice notice-error">{error}</p>;
  if (data.length === 0) return <p className="muted">Chưa gửi thông báo nào cho property này.</p>;
  return (
    <div className="table-wrap">
      <table className="table small">
        <thead>
          <tr>
            <th>Thời gian</th>
            <th>Kênh</th>
            <th>Loại</th>
            <th>Trạng thái</th>
            <th>Lỗi</th>
          </tr>
        </thead>
        <tbody>
          {data.map((n) => (
            <tr key={n.id}>
              <td>{formatDateTime(n.createdAt, tz)}</td>
              <td>{n.channel}</td>
              <td>
                <SeverityBadge severity={n.severity} /> {CHANGE_LABEL_VI[n.type]}
              </td>
              <td>
                <span className={`pill ${n.status === 'SENT' ? 'pill-ok' : n.status === 'FAILED' ? 'pill-danger' : 'pill-muted'}`}>{n.status}</span>
                {n.attempts > 1 && <span className="muted"> ×{n.attempts}</span>}
              </td>
              <td className="break">{n.error ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
