import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, UserCog, Armchair, BarChart3, LogOut, PanelLeftClose, PanelLeftOpen, X,
  History, KeyRound
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Sidebar({ collapsed = false, onToggle, onClose }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const links = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, active: pathname === '/' },
    { to: '/members', label: 'Members', icon: Users, active: pathname.startsWith('/members') || pathname.startsWith('/receipts') },
    { to: '/officers', label: 'Officers', icon: UserCog, active: pathname.startsWith('/officers') },
    { to: '/equipment', label: 'Equipment', icon: Armchair, active: pathname.startsWith('/equipment') },
    { to: '/reports', label: 'Reports', icon: BarChart3, active: pathname.startsWith('/reports') },
    { to: '/activity', label: 'Activity', icon: History, active: pathname.startsWith('/activity') },
    { to: '/account', label: 'Account', icon: KeyRound, active: pathname.startsWith('/account') }
  ];

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="sidebar-brand">
        <span className="brand-dot" />
        <span className="nav-label">Union Members</span>
        <button className="icon-btn sidebar-toggle" onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
        <button className="icon-btn sidebar-close" onClick={onClose} aria-label="Close menu">
          <X size={18} />
        </button>
      </div>
      <nav className="sidebar-nav">
        {links.map(({ to, label, icon: Icon, active }) => (
          <Link key={to} to={to} title={label} aria-current={active ? 'page' : undefined}
            className={`sidebar-link ${active ? 'active' : ''}`}>
            <Icon size={18} />
            <span className="nav-label">{label}</span>
          </Link>
        ))}
      </nav>
      <button className="secondary sidebar-logout" onClick={handleLogout} title="Log out">
        <LogOut size={16} />
        <span className="nav-label">Log Out</span>
      </button>
    </aside>
  );
}
