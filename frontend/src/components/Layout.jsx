import { useEffect, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import Sidebar from './Sidebar';

const KEY = 'sidebar-collapsed';

function readCollapsed() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export default function Layout({ children }) {
  const location = useLocation();
  // collapsed: icon-only sidebar on desktop. open: slide-out drawer on phones/tablets.
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [open, setOpen] = useState(false);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      try { localStorage.setItem(KEY, c ? '0' : '1'); } catch { /* storage unavailable */ }
      return !c;
    });
  }, []);

  // Close the drawer after navigating, and on Escape.
  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className={`app-shell ${collapsed ? 'is-collapsed' : ''} ${open ? 'is-open' : ''}`}>
      <header className="topbar no-print">
        <button className="icon-btn" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
          <Menu size={20} />
        </button>
        <span className="topbar-brand"><span className="brand-dot" /> Union Members</span>
      </header>
      <div className="sidebar-backdrop no-print" onClick={() => setOpen(false)} aria-hidden="true" />
      <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} onClose={() => setOpen(false)} />
      <main className="app-content">{children}</main>
    </div>
  );
}
