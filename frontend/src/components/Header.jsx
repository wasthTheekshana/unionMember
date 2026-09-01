import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Header() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <span className="app-header-title">
          <span className="dot" />
          Union Members
        </span>
        <button className="secondary" onClick={handleLogout}>Log Out</button>
      </div>
    </header>
  );
}
