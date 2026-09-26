import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Users, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Sidebar() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isMembersActive = location.pathname === '/' || location.pathname.startsWith('/members');

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-dot" />
        Union Members
      </div>
      <nav className="sidebar-nav">
        <Link to="/" className={`sidebar-link ${isMembersActive ? 'active' : ''}`}>
          <Users size={18} />
          Members
        </Link>
      </nav>
      <button className="secondary sidebar-logout" onClick={handleLogout}>
        <LogOut size={16} />
        Log Out
      </button>
    </aside>
  );
}
