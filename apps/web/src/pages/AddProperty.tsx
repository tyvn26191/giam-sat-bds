import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { formatManYen, validatePublicUrl, withUserDefaults, type CreatePropertyResponse, type UrlPreview } from '@gsb/shared';
import { ApiFailure, api, errorText } from '../api';
import { useMe } from '../auth';
import { PreviewCard } from '../components/PreviewCard';
import { PropertyForm, emptyForm, selectorsOf, settingsFromForm, type FormState } from '../components/PropertyForm';
import { useToast } from '../components/Toast';
import { useUserDoc } from '../data';

export function AddPropertyPage() {
  const { uid } = useMe();
  const settings = withUserDefaults(useUserDoc(uid).data?.settings);
  const [params] = useSearchParams();
  const [form, setForm] = useState<FormState>(() => ({ ...emptyForm(settings.defaultIntervalMin), url: params.get('url') ?? '' }));
  const [preview, setPreview] = useState<UrlPreview | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dupId, setDupId] = useState<string | null>(null);
  const toast = useToast();
  const navigate = useNavigate();

  const urlCheck = form.url.trim() ? validatePublicUrl(form.url) : null;
  // Editing the URL clears the preview, so a preview always belongs to the current URL.
  const tested = preview !== null;

  const test = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    setDupId(null);
    if (!urlCheck?.ok) {
      setError(urlCheck ? urlCheck.reason : 'Nhập URL');
      return;
    }
    setTesting(true);
    setPreview(null);
    try {
      const p = await api<UrlPreview>('/api/test-url', { method: 'POST', body: { url: form.url.trim(), selectors: selectorsOf(form) } });
      setPreview(p);
      if (p.url !== form.url.trim()) setForm((f) => ({ ...f, url: p.url }));
      if (p.duplicateOf) setDupId(p.duplicateOf.propertyId);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!preview) return;
    if (preview.outcome !== 'OK' && !window.confirm(`Trang đang báo ${preview.outcome} (${preview.errorCode}). Vẫn lưu để hệ thống thử lại định kỳ?`)) return;
    setSaving(true);
    setError(null);
    try {
      const r = await api<CreatePropertyResponse>('/api/properties', { method: 'POST', body: { url: form.url.trim(), settings: { ...settingsFromForm(form), enabled: true } } });
      const c = r.check;
      toast(
        c && c.outcome === 'OK'
          ? `Đã thêm. Giá hiện tại ${c.price !== null ? formatManYen(c.price) : '—'} · kiểm tra lại sau ${form.intervalMin} phút`
          : `Đã thêm. Lần kiểm tra đầu: ${c?.outcome ?? 'chờ'}${c?.error ? ` (${c.error.code})` : ''}`,
        c?.outcome === 'OK' ? 'ok' : 'info',
      );
      navigate(`/p/${r.id}`);
    } catch (err) {
      if (err instanceof ApiFailure && err.code === 'DUPLICATE') setDupId(String(err.data.propertyId));
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page narrow">
      <h1>Thêm URL theo dõi</h1>
      <p className="muted">
        Hỗ trợ SUUMO, LIFULL HOME'S, at home và URL bất động sản khác (GenericAdapter). Bấm <strong>Test URL</strong> để xem hệ thống đọc được gì
        trước khi lưu.
      </p>
      <PropertyForm
        value={form}
        onChange={setForm}
        urlSlot={
          <form onSubmit={test} className="url-row">
            <label className="field grow">
              <span>URL *</span>
              <input
                type="url"
                inputMode="url"
                required
                placeholder="https://suumo.jp/ikkodate/…/nc_12345678/"
                value={form.url}
                onChange={(e) => {
                  setForm({ ...form, url: e.target.value });
                  setPreview(null);
                }}
                aria-invalid={urlCheck ? !urlCheck.ok : undefined}
              />
            </label>
            <button className="btn" disabled={testing || !form.url.trim()}>
              {testing ? 'Đang kiểm tra…' : 'Test URL'}
            </button>
          </form>
        }
      />
      {urlCheck && !urlCheck.ok && <p className="notice notice-error">{urlCheck.reason}</p>}
      {error && <p className="notice notice-error">{error}</p>}
      {dupId && (
        <p className="notice notice-warn">
          URL đã có trong danh sách. <Link to={`/p/${dupId}`}>Mở property</Link>
        </p>
      )}
      {preview && <PreviewCard p={preview} />}
      <div className="row sticky-actions">
        <button className="btn btn-primary" disabled={!tested || saving || !!dupId} onClick={() => void save()}>
          {saving ? 'Đang lưu & kiểm tra lần đầu…' : 'Add Monitor — bắt đầu theo dõi'}
        </button>
        {!tested && <span className="muted small">Bấm Test URL trước khi lưu.</span>}
      </div>
    </div>
  );
}
