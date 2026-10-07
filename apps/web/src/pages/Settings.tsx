import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import {
  CHANGE_LABEL_VI,
  DEFAULT_SYSTEM_CONFIG,
  INTERVAL_OPTIONS,
  NOTIFY_TYPES,
  SEVERITIES,
  SEVERITY_LABEL_VI,
  TIMEZONES,
  withUserDefaults,
  type IntervalMin,
  type RunNowResponse,
  type Severity,
  type SystemConfig,
  type TestNotificationResponse,
  type UserSettings,
} from '@gsb/shared';
import { api, errorText } from '../api';
import { useAuth, useMe } from '../auth';
import { useToast } from '../components/Toast';
import { useSystemConfig, useUserDoc } from '../data';
import { db } from '../firebase';

const CHAT_ID_RE = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/;
const EMAIL_RE = /^[^ @<>(),;:"]+@[^ @<>(),;:"]+\.[A-Za-z]{2,}$/;

export function SettingsPage() {
  const { uid, email, role, me } = useMe();
  const { signOut } = useAuth();
  const toast = useToast();
  const userDoc = useUserDoc(uid);
  const [s, setS] = useState<UserSettings | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!userDoc.loading && !s) setS(withUserDefaults(userDoc.data?.settings));
  }, [userDoc.loading, userDoc.data, s]);

  if (!s) return <p className="page muted">Đang tải…</p>;

  const chatOk = !s.telegram.chatId || CHAT_ID_RE.test(s.telegram.chatId);
  const emailOk = !s.email.to || EMAIL_RE.test(s.email.to);

  const save = async () => {
    if (!chatOk || !emailOk) {
      toast('Kiểm tra lại Chat ID / email', 'error');
      return;
    }
    setBusy('save');
    try {
      if (userDoc.data) await updateDoc(doc(db, 'users', uid), { settings: s, updatedAt: serverTimestamp() });
      else await setDoc(doc(db, 'users', uid), { email: email ?? '', displayName: null, settings: s, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      toast('Đã lưu cài đặt', 'ok');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const action = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try {
      toast(await fn(), 'ok');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const testChannel = (channel: 'TELEGRAM' | 'EMAIL') =>
    action(`test-${channel}`, async () => {
      const r = await api<TestNotificationResponse>('/api/test-notification', { method: 'POST', body: { channel } });
      if (!r.success) throw new Error(r.error ?? 'Gửi thất bại');
      return `Đã gửi thử ${channel === 'TELEGRAM' ? 'Telegram' : 'Email'} (messageId ${r.messageId ?? '—'})`;
    });

  const set = (patch: Partial<UserSettings>) => setS({ ...s, ...patch });

  return (
    <div className="page narrow">
      <h1>Cài đặt</h1>

      <section className="card stack">
        <h2>Telegram</h2>
        {me && !me.features.telegram && <p className="notice notice-warn">Worker chưa có TELEGRAM_BOT_TOKEN — thông báo Telegram sẽ không gửi được.</p>}
        <label className="toggle">
          <input type="checkbox" checked={s.telegram.enabled} onChange={(e) => set({ telegram: { ...s.telegram, enabled: e.target.checked } })} />
          <span className="toggle-ui" aria-hidden />
          <span>Gửi thông báo qua Telegram</span>
        </label>
        <label className="field">
          <span>Chat ID</span>
          <input
            value={s.telegram.chatId ?? ''}
            placeholder="vd: 123456789 hoặc -1001234567890"
            aria-invalid={!chatOk}
            onChange={(e) => set({ telegram: { ...s.telegram, chatId: e.target.value.trim() || null } })}
          />
        </label>
        <details className="small">
          <summary>Cách lấy Chat ID</summary>
          <ol>
            <li>Mở bot của hệ thống trên Telegram và bấm <strong>Start</strong> (bot chỉ nhắn được cho người đã Start).</li>
            <li>
              Nhắn cho <code>@userinfobot</code> để biết ID của bạn, hoặc thêm bot vào group và dùng ID group (số âm, dạng -100…).
            </li>
            <li>Dán vào ô trên, bấm Lưu, rồi “Test Telegram”.</li>
          </ol>
        </details>
        <div className="row wrap">
          <button className="btn" disabled={!!busy || !s.telegram.chatId} onClick={() => void testChannel('TELEGRAM')}>
            {busy === 'test-TELEGRAM' ? 'Đang gửi…' : 'Test Telegram'}
          </button>
        </div>
      </section>

      <section className="card stack">
        <h2>Email (phụ)</h2>
        {me && !me.features.email && <p className="muted small">Worker chưa cấu hình EMAIL_PROVIDER — hệ thống vẫn chạy bằng Telegram.</p>}
        <label className="toggle">
          <input type="checkbox" checked={s.email.enabled} onChange={(e) => set({ email: { ...s.email, enabled: e.target.checked } })} />
          <span className="toggle-ui" aria-hidden />
          <span>Gửi thông báo qua email</span>
        </label>
        <label className="field">
          <span>Địa chỉ nhận</span>
          <input type="email" value={s.email.to ?? ''} aria-invalid={!emailOk} onChange={(e) => set({ email: { ...s.email, to: e.target.value.trim() || null } })} />
        </label>
        <div>
          <button className="btn" disabled={!!busy || !s.email.to} onClick={() => void testChannel('EMAIL')}>
            {busy === 'test-EMAIL' ? 'Đang gửi…' : 'Test Email'}
          </button>
        </div>
      </section>

      <section className="card stack">
        <h2>Loại thông báo</h2>
        <div className="checks">
          {NOTIFY_TYPES.map((t) => (
            <label key={t} className="check">
              <input type="checkbox" checked={s.notifyTypes[t]} onChange={(e) => set({ notifyTypes: { ...s.notifyTypes, [t]: e.target.checked } })} />
              {CHANGE_LABEL_VI[t]}
            </label>
          ))}
        </div>
        <label className="field">
          <span>Mức độ tối thiểu</span>
          <select value={s.minSeverity} onChange={(e) => set({ minSeverity: e.target.value as Severity })}>
            {SEVERITIES.map((v) => (
              <option key={v} value={v}>
                {v} — {SEVERITY_LABEL_VI[v]}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">Giảm giá = CRITICAL · Đã gỡ / thông tin quan trọng = HIGH · Tăng giá / thay đổi nhỏ = LOW.</p>
      </section>

      <section className="card stack">
        <h2>Mặc định</h2>
        <div className="form-grid">
          <label className="field">
            <span>Chu kỳ mặc định cho URL mới</span>
            <select value={s.defaultIntervalMin} onChange={(e) => set({ defaultIntervalMin: Number(e.target.value) as IntervalMin })}>
              {INTERVAL_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m} phút
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Múi giờ hiển thị</span>
            <select value={s.timezone} onChange={(e) => set({ timezone: e.target.value })}>
              {TIMEZONES.map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <div className="row sticky-actions">
        <button className="btn btn-primary" disabled={!!busy} onClick={() => void save()}>
          {busy === 'save' ? 'Đang lưu…' : 'Lưu cài đặt'}
        </button>
      </div>

      <section className="card stack">
        <h2>Giám sát</h2>
        <div className="row wrap">
          <button
            className="btn"
            disabled={!!busy}
            onClick={() =>
              void action('run', async () => {
                const r = await api<RunNowResponse>('/api/run-now', { method: 'POST' });
                return `Đã kiểm tra ${r.processed} · thay đổi ${r.changed} · lỗi ${r.errors}${r.remaining ? ` · còn ${r.remaining} chờ lượt tới` : ''}`;
              })
            }
          >
            {busy === 'run' ? 'Đang chạy…' : 'Run check now'}
          </button>
          <button
            className="btn"
            disabled={!!busy}
            onClick={() =>
              void action('pause', async () => {
                const r = await api<{ changed: number }>('/api/pause-all', { method: 'POST', body: { paused: true } });
                return `Đã tạm dừng ${r.changed} URL`;
              })
            }
          >
            Pause all monitoring
          </button>
          <button
            className="btn"
            disabled={!!busy}
            onClick={() =>
              void action('resume', async () => {
                const r = await api<{ changed: number }>('/api/pause-all', { method: 'POST', body: { paused: false } });
                return `Đã bật lại ${r.changed} URL`;
              })
            }
          >
            Resume all monitoring
          </button>
        </div>
        {me && (
          <p className="muted small">
            Worker: Playwright {me.features.browser ? 'bật' : 'tắt'} · ảnh chụp {me.features.screenshots ? 'bật' : 'tắt'} · Telegram{' '}
            {me.features.telegram ? 'đã cấu hình' : 'chưa'} · Email {me.features.email ? 'đã cấu hình' : 'chưa'}
          </p>
        )}
      </section>

      {role === 'admin' && <AdminConfig uid={uid} />}

      <section className="card stack">
        <h2>Tài khoản</h2>
        <p>
          {email} · <span className="pill pill-muted">{role}</span>
        </p>
        <div>
          <button className="btn" onClick={() => void signOut()}>
            Đăng xuất
          </button>
        </div>
      </section>
    </div>
  );
}

function AdminConfig({ uid }: { uid: string }) {
  const { data, loading } = useSystemConfig(true);
  const toast = useToast();
  const [c, setC] = useState<SystemConfig | null>(null);
  useEffect(() => {
    if (!loading && !c) setC({ ...DEFAULT_SYSTEM_CONFIG, ...(data ?? {}) });
  }, [loading, data, c]);
  if (!c) return null;
  const save = async () => {
    try {
      await setDoc(doc(db, 'system', 'config'), {
        paused: c.paused,
        maxConcurrentChecks: Math.round(c.maxConcurrentChecks),
        perDomainConcurrency: Math.round(c.perDomainConcurrency),
        retentionDays: Math.round(c.retentionDays),
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      });
      toast('Đã lưu cấu hình hệ thống', 'ok');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  return (
    <section className="card stack">
      <h2>Hệ thống (admin)</h2>
      <label className="toggle">
        <input type="checkbox" checked={c.paused} onChange={(e) => setC({ ...c, paused: e.target.checked })} />
        <span className="toggle-ui" aria-hidden />
        <span>Tạm dừng toàn bộ hệ thống (mọi người dùng)</span>
      </label>
      <div className="form-grid">
        <label className="field">
          <span>Maximum concurrent checks (1–16)</span>
          <input type="number" min={1} max={16} value={c.maxConcurrentChecks} onChange={(e) => setC({ ...c, maxConcurrentChecks: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>Đồng thời mỗi domain (1–2)</span>
          <input type="number" min={1} max={2} value={c.perDomainConcurrency} onChange={(e) => setC({ ...c, perDomainConcurrency: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>Retention days (snapshot)</span>
          <input type="number" min={7} max={3650} value={c.retentionDays} onChange={(e) => setC({ ...c, retentionDays: Number(e.target.value) })} />
        </label>
      </div>
      <div>
        <button className="btn btn-primary" onClick={() => void save()}>
          Lưu cấu hình hệ thống
        </button>
      </div>
    </section>
  );
}
