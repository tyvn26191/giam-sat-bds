import type { ReactNode } from 'react';
import { INTERVAL_OPTIONS, type IntervalMin, type MonitorMode, type PropertyDoc, type PropertySettings } from '@gsb/shared';
import { manToYen, yenToMan } from '../util';

export interface FormState {
  url: string;
  name: string;
  groups: string;
  intervalMin: IntervalMin;
  notifyTelegram: boolean;
  notifyEmail: boolean;
  trackPrice: boolean;
  trackContent: boolean;
  trackImage: boolean;
  monitorMode: MonitorMode;
  selPrice: string;
  selTitle: string;
  selAddress: string;
  selContent: string;
  alertBelowMan: string;
  alertDropMan: string;
  alertDropPct: string;
  alertsOnly: boolean;
  note: string;
}

export function emptyForm(intervalMin: IntervalMin): FormState {
  return {
    url: '',
    name: '',
    groups: '',
    intervalMin,
    notifyTelegram: true,
    notifyEmail: false,
    trackPrice: true,
    trackContent: true,
    trackImage: false,
    monitorMode: 'IMPORTANT',
    selPrice: '',
    selTitle: '',
    selAddress: '',
    selContent: '',
    alertBelowMan: '',
    alertDropMan: '',
    alertDropPct: '',
    alertsOnly: false,
    note: '',
  };
}

export function formFromProperty(p: PropertyDoc): FormState {
  return {
    url: p.url,
    name: p.name ?? '',
    groups: p.groups.join(', '),
    intervalMin: p.intervalMin,
    notifyTelegram: p.notify.telegram,
    notifyEmail: p.notify.email,
    trackPrice: p.track.price,
    trackContent: p.track.content,
    trackImage: p.track.image,
    monitorMode: p.monitorMode,
    selPrice: p.selectors?.price ?? '',
    selTitle: p.selectors?.title ?? '',
    selAddress: p.selectors?.address ?? '',
    selContent: p.selectors?.content ?? '',
    alertBelowMan: yenToMan(p.alerts.priceAtOrBelow),
    alertDropMan: yenToMan(p.alerts.dropAmountAtLeast),
    alertDropPct: p.alerts.dropPercentAtLeast ? String(p.alerts.dropPercentAtLeast) : '',
    alertsOnly: p.alerts.only,
    note: p.note ?? '',
  };
}

const orNull = (s: string, max: number) => (s.trim() ? s.trim().slice(0, max) : null);

export function selectorsOf(f: FormState): PropertySettings['selectors'] {
  const s = { price: orNull(f.selPrice, 300), title: orNull(f.selTitle, 300), address: orNull(f.selAddress, 300), content: orNull(f.selContent, 300) };
  return s.price || s.title || s.address || s.content ? s : null;
}

/** User-editable settings (everything except `enabled`). */
export function settingsFromForm(f: FormState): Omit<PropertySettings, 'enabled'> {
  const pct = Number(f.alertDropPct);
  return {
    name: orNull(f.name, 200),
    groups: [...new Set(f.groups.split(/[,、]/).map((g) => g.trim().slice(0, 40)).filter(Boolean))].slice(0, 10),
    intervalMin: f.intervalMin,
    monitorMode: f.monitorMode,
    selectors: selectorsOf(f),
    notify: { telegram: f.notifyTelegram, email: f.notifyEmail },
    track: { price: f.trackPrice, content: f.trackContent, image: f.trackImage },
    alerts: {
      priceAtOrBelow: manToYen(f.alertBelowMan),
      dropAmountAtLeast: manToYen(f.alertDropMan),
      dropPercentAtLeast: f.alertDropPct.trim() && pct > 0 && pct <= 100 ? pct : null,
      only: f.alertsOnly,
    },
    note: orNull(f.note, 1000),
  };
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-ui" aria-hidden />
      <span>{children}</span>
    </label>
  );
}

export function PropertyForm({
  value,
  onChange,
  urlSlot,
}: {
  value: FormState;
  onChange: (f: FormState) => void;
  urlSlot?: ReactNode;
}) {
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="stack">
      {urlSlot}
      <div className="form-grid">
        <label className="field">
          <span>Tên property (tùy chọn)</span>
          <input value={value.name} maxLength={200} placeholder="vd: 西尾市寺津町 1号棟 — 本命" onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="field">
          <span>Nhóm (cách nhau bởi dấu phẩy)</span>
          <input value={value.groups} placeholder="西尾市, 本命, 値下げ待ち" onChange={(e) => set('groups', e.target.value)} />
        </label>
        <label className="field">
          <span>Chu kỳ kiểm tra</span>
          <select value={value.intervalMin} onChange={(e) => set('intervalMin', Number(e.target.value) as IntervalMin)}>
            {INTERVAL_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m} phút{m === 15 ? ' (mặc định)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Vùng theo dõi</span>
          <select value={value.monitorMode} onChange={(e) => set('monitorMode', e.target.value as MonitorMode)}>
            <option value="IMPORTANT">Chỉ vùng quan trọng (giá, địa chỉ, diện tích…)</option>
            <option value="FULL">Toàn bộ trang (đã lọc quảng cáo/bộ đếm)</option>
          </select>
        </label>
      </div>

      <fieldset className="fieldset">
        <legend>Thông báo & theo dõi</legend>
        <div className="toggles">
          <Toggle checked={value.notifyTelegram} onChange={(v) => set('notifyTelegram', v)}>
            Telegram
          </Toggle>
          <Toggle checked={value.notifyEmail} onChange={(v) => set('notifyEmail', v)}>
            Email
          </Toggle>
          <Toggle checked={value.trackPrice} onChange={(v) => set('trackPrice', v)}>
            Theo dõi giá
          </Toggle>
          <Toggle checked={value.trackContent} onChange={(v) => set('trackContent', v)}>
            Theo dõi nội dung
          </Toggle>
          <Toggle checked={value.trackImage} onChange={(v) => set('trackImage', v)}>
            Theo dõi ảnh chính
          </Toggle>
        </div>
      </fieldset>

      <fieldset className="fieldset">
        <legend>Cảnh báo giá (tùy chọn)</legend>
        <div className="form-grid">
          <label className="field">
            <span>Báo khi giá ≤ (万円)</span>
            <input inputMode="decimal" placeholder="vd: 3000" value={value.alertBelowMan} onChange={(e) => set('alertBelowMan', e.target.value)} />
          </label>
          <label className="field">
            <span>Báo khi một lần giảm ≥ (万円)</span>
            <input inputMode="decimal" placeholder="vd: 50" value={value.alertDropMan} onChange={(e) => set('alertDropMan', e.target.value)} />
          </label>
          <label className="field">
            <span>Báo khi một lần giảm ≥ (%)</span>
            <input inputMode="decimal" placeholder="vd: 3" value={value.alertDropPct} onChange={(e) => set('alertDropPct', e.target.value)} />
          </label>
        </div>
        <Toggle checked={value.alertsOnly} onChange={(v) => set('alertsOnly', v)}>
          Chỉ báo thay đổi giá khi đạt một ngưỡng ở trên
        </Toggle>
      </fieldset>

      <details className="fieldset">
        <summary>Nâng cao: CSS selector thủ công (khi tự nhận diện sai)</summary>
        <p className="muted small">Ví dụ <code>#price .num</code>, <code>table.spec td.address</code>. Để trống = tự động. (XPath chưa hỗ trợ.)</p>
        <div className="form-grid">
          <label className="field">
            <span>Giá</span>
            <input value={value.selPrice} maxLength={300} onChange={(e) => set('selPrice', e.target.value)} />
          </label>
          <label className="field">
            <span>Tiêu đề</span>
            <input value={value.selTitle} maxLength={300} onChange={(e) => set('selTitle', e.target.value)} />
          </label>
          <label className="field">
            <span>Địa chỉ</span>
            <input value={value.selAddress} maxLength={300} onChange={(e) => set('selAddress', e.target.value)} />
          </label>
          <label className="field">
            <span>Vùng nội dung theo dõi</span>
            <input value={value.selContent} maxLength={300} onChange={(e) => set('selContent', e.target.value)} />
          </label>
        </div>
      </details>

      <label className="field">
        <span>Ghi chú</span>
        <textarea rows={2} maxLength={1000} value={value.note} onChange={(e) => set('note', e.target.value)} />
      </label>
    </div>
  );
}
