import { useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import Directory from './pages/Directory.jsx';
import MyRep from './pages/MyRep.jsx';
import Profile from './pages/Profile.jsx';
import Votes from './pages/Votes.jsx';
import Bills from './pages/Bills.jsx';
import About from './pages/About.jsx';
import { NotFound } from './components/Bits.jsx';

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState('');
  const onDirectory = location.pathname === '/';

  return (
    <div className="layout">
      <Sidebar />
      <div className="main">
        {!onDirectory && (
          <div className="topbar">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                navigate(`/?q=${encodeURIComponent(q)}`);
                setQ('');
              }}
            >
              <input
                className="search"
                placeholder="Search members…"
                aria-label="Search members"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </form>
          </div>
        )}
        <Routes>
          <Route path="/" element={<Directory />} />
          <Route path="/my-rep" element={<MyRep />} />
          <Route path="/mp/:slug" element={<Profile />} />
          <Route path="/votes" element={<Votes />} />
          <Route path="/bills" element={<Bills />} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
    </div>
  );
}
