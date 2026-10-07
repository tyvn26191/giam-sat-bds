import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { validatePublicUrl, type UrlPreview } from '@gsb/shared';
import { api, errorText } from '../api';
import { PreviewCard } from '../components/PreviewCard';
import { PropertyForm, formFromProperty, selectorsOf, settingsFromForm, type FormState } from '../components/PropertyForm';
import { useToast } from '../components/Toast';
import { useProperty } from '../data';
import { db } from '../firebase';
import { displayName } from '../util';

export function EditPropertyPage() {
  const { id = '' } = useParams();
  const { data: p, loading } = useProperty(id);
  const [form, setForm] = useState<FormState | null>(null);
  const [preview, setPreview] = useState<UrlPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (p && !form) setForm(formFromProperty(p));
  }, [p, form]);

  if (loading || !form) return <p className="page muted">Đang tải…</p>;
  if (!p) return <p className="page notice notice-error">Không tìm thấy property.</p>;

  const urlChanged = form.url.trim() !== p.url;
  const urlCheck = validatePublicUrl(form.url);

  const test = async () => {
    setError(null);
    setBusy(true);
    try {
      setPreview(await api<UrlPreview>('/api/test-url', { method: 'POST', body: { url: form.url.trim(), selectors: selectorsOf(form) } }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!urlCheck.ok) {
      setError(urlCheck.reason);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateDoc(doc(db, 'properties', p.id), { ...settingsFromForm(form), updatedAt: serverTimestamp() });
      if (urlChanged) await api(`/api/properties/${p.id}/url`, { method: 'PATCH', body: { url: form.url.trim() } });
      toast(urlChanged ? 'Đã lưu. URL mới được dùng làm mốc so sánh mới.' : 'Đã lưu', 'ok');
      navigate(`/p/${p.id}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <div className="page narrow">
      <Link to={`/p/${p.id}`} className="muted small">
        ← {displayName(p)}
      </Link>
      <h1>Sửa property</h1>
      <PropertyForm
        value={form}
        onChange={(f) => {
          setForm(f);
          if (f.url !== form.url) setPreview(null);
        }}
        urlSlot={
          <div className="url-row">
            <label className="field grow">
              <span>URL *</span>
              <input type="url" required value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} aria-invalid={!urlCheck.ok} />
            </label>
            <button className="btn" type="button" onClick={() => void test()} disabled={busy || !urlCheck.ok}>
              Test URL
            </button>
          </div>
        }
      />
      {urlChanged && <p className="notice notice-warn">Đổi URL sẽ đặt lại mốc so sánh (lịch sử cũ vẫn được giữ).</p>}
      {error && <p className="notice notice-error">{error}</p>}
      {preview && <PreviewCard p={preview} />}
      <div className="row sticky-actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Đang lưu…' : 'Lưu thay đổi'}
        </button>
        <Link className="btn" to={`/p/${p.id}`}>
          Hủy
        </Link>
      </div>
    </div>
  );
}
