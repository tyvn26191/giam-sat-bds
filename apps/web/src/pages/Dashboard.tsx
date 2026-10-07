import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { SITE_IDS, SITE_LABELS, withUserDefaults, type RunNowResponse, type SiteId } from '@gsb/shared';
import { api, errorText } from '../api';
import { useMe } from '../auth';
import { IconDownload, IconPlus, IconRefresh, IconSearch } from '../components/icons';
import { PropertyCard } from '../components/PropertyCard';
import { useToast } from '../components/Toast';
import { useProperties, useUserDoc, type Property } from '../data';
import { displayName, displayStatus, exportCsv, manToYen } from '../util';

type Tab = 'all' | 'watching' | 'down' | 'up' | 'removed' | 'error';

const TABS: { id: Tab; label: string; test: (p: Property) => boolean }[] = [
  { id: 'all', label: 'Tất cả', test: () => true },
  { id: 'watching', label: 'Đang theo dõi', test: (p) => p.enabled && !['REMOVED', 'NOT_FOUND', 'ERROR', 'BLOCKED'].includes(p.status) },
  { id: 'down', label: 'Đã giảm giá', test: (p) => p.lastPriceChange?.type === 'PRICE_DECREASE' },
  { id: 'up', label: 'Đã tăng giá', test: (p) => p.lastPriceChange?.type === 'PRICE_INCREASE' },
  { id: 'removed', label: 'Đã xóa', test: (p) => p.status === 'REMOVED' || p.status === 'NOT_FOUND' },
  { id: 'error', label: 'Có lỗi', test: (p) => p.status === 'ERROR' || p.status === 'BLOCKED' || p.needsReview },
];

type Sort = 'changed' | 'checked' | 'priceAsc' | 'priceDesc' | 'drop' | 'name';

export function DashboardPage() {
  const { uid } = useMe();
  const toast = useToast();
  const { data, loading, error } = useProperties(uid);
  const settings = withUserDefaults(useUserDoc(uid).data?.settings);
  const tz = settings.timezone;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [site, setSite] = useState<SiteId | ''>('');
  const [group, setGroup] = useState('');
  const [city, setCity] = useState('');
  const [status, setStatus] = useState('');
  const [minMan, setMinMan] = useState('');
  const [maxMan, setMaxMan] = useState('');
  const [recent, setRecent] = useState(false);
  const [sort, setSort] = useState<Sort>('changed');
  const [running, setRunning] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const groups = useMemo(() => [...new Set(data.flatMap((p) => p.groups))].sort(), [data]);
  const cities = useMemo(() => [...new Set(data.map((p) => p.fingerprint?.cityKey).filter((c): c is string => !!c))].sort(), [data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const min = manToYen(minMan);
    const max = manToYen(maxMan);
    const t = TABS.find((x) => x.id === tab)!;
    const list = data.filter(
      (p) =>
        t.test(p) &&
        (!needle || [displayName(p), p.title, p.address, p.url, p.propertyCode, ...p.groups].some((s) => s?.toLowerCase().includes(needle))) &&
        (!site || p.site === site) &&
        (!group || p.groups.includes(group)) &&
        (!city || p.fingerprint?.cityKey === city) &&
        (!status || displayStatus(p) === status) &&
        (min === null || (p.price !== null && p.price >= min)) &&
        (max === null || (p.price !== null && p.price <= max)) &&
        (!recent || (p.lastChangedAt !== null && now - p.lastChangedAt < 7 * 86400_000)),
    );
    const by: Record<Sort, (a: Property, b: Property) => number> = {
      changed: (a, b) => (b.lastChangedAt ?? 0) - (a.lastChangedAt ?? 0) || (b.createdAt ?? 0) - (a.createdAt ?? 0),
      checked: (a, b) => (b.lastCheckedAt ?? 0) - (a.lastCheckedAt ?? 0),
      priceAsc: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
      priceDesc: (a, b) => (b.price ?? -1) - (a.price ?? -1),
      drop: (a, b) => (a.lastPriceChange?.difference ?? 0) - (b.lastPriceChange?.difference ?? 0),
      name: (a, b) => displayName(a).localeCompare(displayName(b), 'ja'),
    };
    return list.sort(by[sort]);
  }, [data, tab, q, site, group, city, status, minMan, maxMan, recent, sort, now]);

  const runNow = async () => {
    setRunning(true);
    try {
      const r = await api<RunNowResponse>('/api/run-now', { method: 'POST' });
      toast(
        `Đã kiểm tra ${r.processed} URL · ${r.changed} có thay đổi · ${r.errors} lỗi${r.remaining ? ` · ${r.remaining} URL sẽ được kiểm tra trong ≤5 phút` : ''}`,
        r.errors ? 'error' : 'ok',
      );
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setRunning(false);
    }
  };

  const filtersActive = !!(q || site || group || city || status || minMan || maxMan || recent);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Property Watch</h1>
          <p className="muted small">
            {data.length} URL · kiểm tra định kỳ 15/30/60 phút · giờ {tz === 'Asia/Tokyo' ? 'Nhật (JST)' : tz}
          </p>
        </div>
        <div className="row wrap">
          <button className="btn" onClick={() => void runNow()} disabled={running || data.length === 0}>
            <IconRefresh /> {running ? 'Đang kiểm tra…' : 'Kiểm tra tất cả'}
          </button>
          <button className="btn" onClick={() => exportCsv(filtered, tz)} disabled={filtered.length === 0}>
            <IconDownload /> CSV
          </button>
          <Link to="/add" className="btn btn-primary">
            <IconPlus /> Thêm URL
          </Link>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label} <span className="count">{data.filter(t.test).length}</span>
          </button>
        ))}
      </div>

      <div className={showFilters ? 'filters open' : 'filters'}>
        <div className="search-row">
          <label className="search">
            <IconSearch />
            <input placeholder="Tìm tên, địa chỉ, URL, mã…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm kiếm" />
          </label>
          <button className="btn filter-toggle" aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>
            Lọc{filtersActive ? ' •' : ''}
          </button>
        </div>
        <select value={site} onChange={(e) => setSite(e.target.value as SiteId | '')} aria-label="Site">
          <option value="">Mọi site</option>
          {SITE_IDS.map((s) => (
            <option key={s} value={s}>
              {SITE_LABELS[s]}
            </option>
          ))}
        </select>
        <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Nhóm">
          <option value="">Mọi nhóm</option>
          {groups.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
        <select value={city} onChange={(e) => setCity(e.target.value)} aria-label="Khu vực">
          <option value="">Mọi khu vực</option>
          {cities.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Trạng thái">
          <option value="">Mọi trạng thái</option>
          {['ACTIVE', 'PRICE_CHANGED', 'UPDATED', 'REMOVED', 'NOT_FOUND', 'BLOCKED', 'ERROR', 'PAUSED', 'PENDING'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <div className="price-range">
          <input inputMode="decimal" placeholder="Giá từ (万円)" value={minMan} onChange={(e) => setMinMan(e.target.value)} aria-label="Giá tối thiểu (万円)" />
          <span>–</span>
          <input inputMode="decimal" placeholder="đến (万円)" value={maxMan} onChange={(e) => setMaxMan(e.target.value)} aria-label="Giá tối đa (万円)" />
        </div>
        <label className="check">
          <input type="checkbox" checked={recent} onChange={(e) => setRecent(e.target.checked)} /> Thay đổi 7 ngày
        </label>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sắp xếp">
          <option value="changed">Mới thay đổi</option>
          <option value="checked">Mới kiểm tra</option>
          <option value="drop">Giảm nhiều nhất</option>
          <option value="priceAsc">Giá thấp → cao</option>
          <option value="priceDesc">Giá cao → thấp</option>
          <option value="name">Tên</option>
        </select>
        {filtersActive && (
          <button
            className="link"
            onClick={() => {
              setQ('');
              setSite('');
              setGroup('');
              setCity('');
              setStatus('');
              setMinMan('');
              setMaxMan('');
              setRecent(false);
            }}
          >
            Xóa lọc
          </button>
        )}
      </div>

      {!loading && data.length > 0 && !(settings.telegram.enabled && settings.telegram.chatId) && !(settings.email.enabled && settings.email.to) && (
        <p className="notice notice-warn">
          Chưa có kênh nhận thông báo — hệ thống vẫn theo dõi và lưu lịch sử nhưng sẽ không gửi tin. <Link to="/settings">Nhập Telegram Chat ID →</Link>
        </p>
      )}
      {error && <p className="notice notice-error">Không tải được dữ liệu: {error}</p>}
      {loading ? (
        <p className="muted">Đang tải…</p>
      ) : data.length === 0 ? (
        <div className="empty card">
          <h2>Chưa có URL nào</h2>
          <p className="muted">Dán URL căn nhà trên SUUMO, LIFULL HOME'S, at home hoặc trang bất động sản khác để bắt đầu theo dõi giá.</p>
          <Link to="/add" className="btn btn-primary">
            <IconPlus /> Thêm URL đầu tiên
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <p className="muted">Không có property nào khớp bộ lọc.</p>
      ) : (
        <div className="grid">
          {filtered.map((p) => (
            <PropertyCard key={p.id} p={p} now={now} tz={tz} />
          ))}
        </div>
      )}
    </div>
  );
}
