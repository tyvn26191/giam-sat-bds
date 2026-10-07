import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';
import { useEmulator } from '../firebase';
import { IconHome, IconList, IconPlus, IconSettings } from './icons';

const NAV = [
  { to: '/', label: 'Theo dõi', icon: IconHome, end: true },
  { to: '/add', label: 'Thêm URL', icon: IconPlus, end: false },
  { to: '/logs', label: 'Logs', icon: IconList, end: false },
  { to: '/settings', label: 'Cài đặt', icon: IconSettings, end: false },
];

export function Layout() {
  const { session } = useAuth();
  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="Property Watch">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span>PROPERTY WATCH</span>
        </NavLink>
        <nav className="topnav" aria-label="Điều hướng">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <n.icon />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="topbar-right">
          {useEmulator && <span className="pill pill-warn">EMULATOR</span>}
          {session.status === 'signedIn' && <span className="muted small hide-sm">{session.user.email}</span>}
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
      <nav className="bottomnav" aria-label="Điều hướng">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <n.icon />
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
