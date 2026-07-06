import { NavLink, useLocation } from 'react-router-dom';

const memberAnchors = [
  { hash: '#top', label: 'Overview' },
  { hash: '#votes', label: 'Voting record' },
  { hash: '#bills', label: 'Sponsored bills' },
  { hash: '#elections', label: 'Elections' },
  { hash: '#finance', label: 'Campaign finance' },
  { hash: '#expenditures', label: 'Spending' },
  { hash: '#career', label: 'Career' },
  { hash: '#sources', label: 'Public records' },
];

// Monochrome stroke icons — emoji render inconsistently across platforms and
// fight the analyst-view look. currentColor follows the navlink state.
const Icon = ({ children }) => (
  <svg
    viewBox="0 0 16 16"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const icons = {
  members: (
    <Icon>
      <circle cx="6" cy="5.3" r="2.4" />
      <path d="M1.9 13.2c.5-2.2 2.1-3.5 4.1-3.5s3.6 1.3 4.1 3.5" />
      <path d="M10.4 3.3a2.4 2.4 0 0 1 0 4" />
      <path d="M12 10c1.1.5 1.9 1.4 2.2 2.7" />
    </Icon>
  ),
  rep: (
    <Icon>
      <path d="M13 6.6c0 3.1-5 7.4-5 7.4S3 9.7 3 6.6a5 5 0 0 1 10 0z" />
      <circle cx="8" cy="6.5" r="1.8" />
    </Icon>
  ),
  votes: (
    <Icon>
      <rect x="2.3" y="2.3" width="11.4" height="11.4" rx="2.4" />
      <path d="M5.3 8.3l1.9 1.9 3.6-4.2" />
    </Icon>
  ),
  bills: (
    <Icon>
      <path d="M9.2 1.9H4.7a1 1 0 0 0-1 1v10.2a1 1 0 0 0 1 1h6.6a1 1 0 0 0 1-1V5z" />
      <path d="M9.2 1.9V5h3.1" />
      <path d="M5.7 8.2h4.6M5.7 10.6h3.2" />
    </Icon>
  ),
  about: (
    <Icon>
      <circle cx="8" cy="8" r="6.1" />
      <path d="M8 7.4v3.4" />
      <path d="M8 5h.01" strokeWidth="2" />
    </Icon>
  ),
};

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
        {link('/', 'Members', icons.members, true)}
        {link('/my-rep', 'My rep', icons.rep)}

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
        {link('/votes', 'House votes', icons.votes)}
        {link('/bills', 'Bills', icons.bills)}

        <div className="navgroup-label">Project</div>
        {link('/about', 'About & data', icons.about)}
      </nav>

      <a
        className="sidebar-footer"
        href="https://github.com/reidlaird/Papineau"
        target="_blank"
        rel="noreferrer"
      >
        <div className="sidebar-footer-title">Open source · GitHub ↗</div>
        <div className="sidebar-footer-sub">Public records, plainly steeped</div>
      </a>
    </aside>
  );
}
