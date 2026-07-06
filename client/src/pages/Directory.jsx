import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getJSON } from '../api.js';
import { partyMeta } from '../partyMeta.js';
import Avatar from '../components/Avatar.jsx';
import { Loading, ErrorCard } from '../components/Bits.jsx';

export default function Directory() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [mps, setMps] = useState(null);
  const [err, setErr] = useState(null);
  const [party, setParty] = useState('All');
  const q = searchParams.get('q') || '';

  useEffect(() => {
    getJSON('/api/mps').then(setMps).catch((e) => setErr(e.message));
  }, []);

  const parties = useMemo(() => {
    if (!mps) return [];
    const counts = {};
    for (const m of mps) counts[m.party] = (counts[m.party] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [mps]);

  const shown = useMemo(() => {
    if (!mps) return [];
    const needle = q.trim().toLowerCase();
    return mps.filter(
      (m) =>
        (party === 'All' || m.party === party) &&
        (!needle ||
          m.name.toLowerCase().includes(needle) ||
          m.riding.toLowerCase().includes(needle))
    );
  }, [mps, q, party]);

  if (err) return <ErrorCard msg={err} />;
  if (!mps) return <Loading label="Steeping the member list…" />;

  return (
    <div className="page">
      <header className="page-header" id="top">
        <h1>Members of Parliament</h1>
        <p className="page-sub">
          {mps.length} sitting MPs · House of Commons · data via openparliament.ca
        </p>
      </header>

      <input
        className="search search-big"
        placeholder="Search by name or riding…"
        aria-label="Search members by name or riding"
        value={q}
        onChange={(e) => {
          const v = e.target.value;
          setSearchParams(v ? { q: v } : {}, { replace: true });
        }}
      />

      <div className="chips">
        <button
          className={'chip' + (party === 'All' ? ' active' : '')}
          onClick={() => setParty('All')}
        >
          All · {mps.length}
        </button>
        {parties.map(([p, n]) => {
          const pm = partyMeta(p);
          return (
            <button
              key={p}
              className={'chip' + (party === p ? ' active' : '')}
              style={party === p ? { background: pm.color, borderColor: pm.color } : {}}
              onClick={() => setParty(p)}
            >
              {p} · {n}
            </button>
          );
        })}
      </div>

      <div className="mp-grid">
        {shown.map((m) => {
          const pm = partyMeta(m.party);
          return (
            <Link key={m.slug} to={`/mp/${m.slug}`} className="card mp-card">
              <Avatar name={m.name} src={m.image} size={44} />
              <div className="mp-card-info">
                <div className="mp-card-name">{m.name}</div>
                <div className="mp-card-riding">
                  {m.riding}
                  {m.province ? ` · ${m.province}` : ''}
                </div>
              </div>
              <span className="pill" style={{ color: pm.color, background: pm.bg }}>
                {m.party}
              </span>
            </Link>
          );
        })}
        {shown.length === 0 && <p className="muted">No MPs match that filter.</p>}
      </div>
    </div>
  );
}
