import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CHANGE_LABEL_VI, formatDateTime, formatManYen, withUserDefaults, type MonitorLog } from '@gsb/shared';
import { useMe } from '../auth';
import { SeverityBadge } from '../components/badges';
import { useAllMonitorLogs, useMonitorLogs, useMonitorRuns, useNotificationLogs, useProperties, useUserDoc, type WithId } from '../data';
import { displayName } from '../util';

type Tab = 'checks' | 'notifications' | 'runs' | 'all';

export function LogsPage() {
  const { uid, role } = useMe();
  const tz = withUserDefaults(useUserDoc(uid).data?.settings).timezone;
  const [tab, setTab] = useState<Tab>('checks');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const props = useProperties(uid);
  const names = new Map(props.data.map((p) => [p.id, displayName(p)]));
  const isAdmin = role === 'admin';

  return (
    <div className="page">
      <h1>System Logs</h1>
      <p className="muted small">Log kiểm tra được giữ có thời hạn (mặc định 14 ngày, TTL). Thời gian theo {tz}.</p>
      <div className="tabs" role="tablist">
        <button className={tab === 'checks' ? 'active' : ''} onClick={() => setTab('checks')}>
          Lần kiểm tra
        </button>
        <button className={tab === 'notifications' ? 'active' : ''} onClick={() => setTab('notifications')}>
          Thông báo
        </button>
        {isAdmin && (
          <button className={tab === 'runs' ? 'active' : ''} onClick={() => setTab('runs')}>
            Lượt chạy scheduler
          </button>
        )}
        {isAdmin && (
          <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>
            Tất cả người dùng
          </button>
        )}
      </div>
      {(tab === 'checks' || tab === 'all') && (
        <label className="check">
          <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> Chỉ hiện lỗi
        </label>
      )}
      {tab === 'checks' && <OwnChecks uid={uid} tz={tz} names={names} errorsOnly={errorsOnly} />}
      {tab === 'all' && isAdmin && <AllChecks tz={tz} names={names} errorsOnly={errorsOnly} />}
      {tab === 'notifications' && <Notifications uid={uid} tz={tz} names={names} />}
      {tab === 'runs' && isAdmin && <Runs tz={tz} />}
    </div>
  );
}

function OwnChecks(props: { uid: string; tz: string; names: Map<string, string>; errorsOnly: boolean }) {
  const { data, loading, error } = useMonitorLogs(props.uid, undefined, 200);
  return <CheckTable rows={data} loading={loading} error={error} {...props} />;
}

function AllChecks(props: { tz: string; names: Map<string, string>; errorsOnly: boolean }) {
  const { data, loading, error } = useAllMonitorLogs(true, 200);
  return <CheckTable rows={data} loading={loading} error={error} {...props} />;
}

function CheckTable({
  rows,
  loading,
  error,
  tz,
  names,
  errorsOnly,
}: {
  rows: WithId<MonitorLog>[];
  loading: boolean;
  error: string | null;
  tz: string;
  names: Map<string, string>;
  errorsOnly: boolean;
}) {
  if (loading) return <p className="muted">Đang tải…</p>;
  if (error) return <p className="notice notice-error">{error}</p>;
  const list = errorsOnly ? rows.filter((r) => r.error) : rows;
  if (list.length === 0) return <p className="muted">Không có log.</p>;
  return (
    <div className="table-wrap">
      <table className="table small">
        <thead>
          <tr>
            <th>Bắt đầu</th>
            <th>Property</th>
            <th>Trigger</th>
            <th>Method</th>
            <th>HTTP</th>
            <th>Parser</th>
            <th>Giá</th>
            <th>Trường</th>
            <th>Kết quả</th>
            <th>Thay đổi</th>
            <th>Gửi TB</th>
            <th>ms</th>
            <th>Lỗi</th>
          </tr>
        </thead>
        <tbody>
          {list.map((l) => (
            <tr key={l.id} className={l.error ? 'row-error' : ''}>
              <td className="nowrap">{formatDateTime(l.startedAt, tz)}</td>
              <td>
                <Link to={`/p/${l.propertyId}`}>{names.get(l.propertyId) ?? l.propertyId}</Link>
              </td>
              <td>{l.trigger}</td>
              <td>{l.method ?? '—'}</td>
              <td>{l.httpStatus ?? '—'}</td>
              <td>{l.parser ?? '—'}</td>
              <td className="nowrap">{l.priceDetected !== null ? formatManYen(l.priceDetected) : '—'}</td>
              <td>{l.fieldsDetected.length}</td>
              <td>{l.outcome}</td>
              <td>{l.changed ? l.changeTypes.join(', ') : 'no'}</td>
              <td>{l.notificationSent ? 'yes' : 'no'}</td>
              <td>{l.durationMs}</td>
              <td className="break">{l.error ? `${l.error.code}: ${l.error.message}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Notifications({ uid, tz, names }: { uid: string; tz: string; names: Map<string, string> }) {
  const { data, loading, error } = useNotificationLogs(uid, undefined, 100);
  if (loading) return <p className="muted">Đang tải…</p>;
  if (error) return <p className="notice notice-error">{error}</p>;
  if (data.length === 0) return <p className="muted">Chưa có thông báo.</p>;
  return (
    <div className="table-wrap">
      <table className="table small">
        <thead>
          <tr>
            <th>Thời gian</th>
            <th>Property</th>
            <th>Loại</th>
            <th>Kênh</th>
            <th>Trạng thái</th>
            <th>Message ID</th>
            <th>Lỗi</th>
          </tr>
        </thead>
        <tbody>
          {data.map((n) => (
            <tr key={n.id}>
              <td className="nowrap">{formatDateTime(n.createdAt, tz)}</td>
              <td>
                <Link to={`/p/${n.propertyId}`}>{names.get(n.propertyId) ?? n.title}</Link>
              </td>
              <td>
                <SeverityBadge severity={n.severity} /> {CHANGE_LABEL_VI[n.type]}
              </td>
              <td>{n.channel}</td>
              <td>
                <span className={`pill ${n.status === 'SENT' ? 'pill-ok' : n.status === 'FAILED' ? 'pill-danger' : 'pill-muted'}`}>{n.status}</span>
              </td>
              <td className="mono">{n.messageId ?? '—'}</td>
              <td className="break">{n.error ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Runs({ tz }: { tz: string }) {
  const { data, loading, error } = useMonitorRuns(true);
  if (loading) return <p className="muted">Đang tải…</p>;
  if (error) return <p className="notice notice-error">{error}</p>;
  if (data.length === 0) return <p className="muted">Chưa có lượt chạy (chỉ ghi khi có URL đến hạn).</p>;
  return (
    <div className="table-wrap">
      <table className="table small">
        <thead>
          <tr>
            <th>monitorRunId</th>
            <th>Bắt đầu</th>
            <th>Kết thúc</th>
            <th>Đến hạn</th>
            <th>Đã chạy</th>
            <th>Thay đổi</th>
            <th>Lỗi</th>
            <th>Bỏ qua</th>
            <th>Thông báo</th>
            <th>Thời lượng</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.id}>
              <td className="mono">{r.id}</td>
              <td className="nowrap">{formatDateTime(r.startedAt, tz)}</td>
              <td className="nowrap">{formatDateTime(r.finishedAt, tz)}</td>
              <td>{r.due}</td>
              <td>{r.processed}</td>
              <td>{r.changed}</td>
              <td>{r.errors}</td>
              <td>{r.skipped}</td>
              <td>{r.notifications}</td>
              <td>{(r.durationMs / 1000).toFixed(1)}s</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
