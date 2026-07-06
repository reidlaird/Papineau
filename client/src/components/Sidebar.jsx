import { NavLink, useLocation } from 'react-router-dom';

const memberAnchors = [
  { hash: '#top', label: 'Overview' },
  { hash: '#votes', label: 'Voting record' },
  { hash: '#bills', label: 'Sponsored bills' },
  { hash: '#career', label: 'Career' },
  { hash: '#sources', label: 'Public records' },
];

export default function Sidebar() {
  const location = useLocation();
  const onMemberPage = location.pathname.startsWith('/mp/');

  const link = (to, label, icon, end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => 'navlink' + (isActive ? ' active' : '')}>
      <span className="navlink-icon">{icon}</span>
      {label}
    </NavLink>
  );

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-icon">🍵</span>
        <span className="brand-name">HonesTea</span>
      </div>

      <nav className="nav">
        {link('/', 'Members', '👥', true)}
        {link('/my-rep', 'My rep', '📍')}

        {onMemberPage && (
          <>
            <div className="navgroup-label">This member</div>
            {memberAnchors.map((a) => (
              <a key={a.hash} className="navlink navlink-anchor" href={a.hash}>
                <span className="navlink-icon">·</span>
                {a.label}
              </a>
            ))}
          </>
        )}

        <div className="navgroup-label">The House</div>
        {link('/votes', 'House votes', '🗳️')}
        {link('/bills', 'Bills', '📜')}

        <div className="navgroup-label">Project</div>
        {link('/about', 'About & data', 'ℹ️')}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-footer-title">Local build</div>
        <div className="sidebar-footer-sub">Public records, plainly steeped</div>
      </div>
    </aside>
  );
}
