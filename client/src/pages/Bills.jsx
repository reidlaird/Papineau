import { useEffect, useState } from 'react';
import { getJSON } from '../api.js';
import { Loading, ErrorCard, fmtDate } from '../components/Bits.jsx';

export default function Bills() {
  const [bills, setBills] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    getJSON('/api/bills').then(setBills).catch((e) => setErr(e.message));
  }, []);

  if (err) return <ErrorCard msg={err} />;
  if (!bills) return <Loading label="Unrolling the order paper…" />;

  return (
    <div className="page">
      <header className="page-header">
        <h1>Bills</h1>
        <p className="page-sub">Most recently introduced bills before Parliament</p>
      </header>

      <div className="card">
        {bills.map((b) => (
          <div key={`${b.session}-${b.number}`} className="list-row">
            <span className="bill-badge">{b.number}</span>
            <div className="list-row-body">
              <div className="list-row-title">{b.name || '(untitled)'}</div>
              <div className="list-row-meta">
                {b.introduced ? `introduced ${fmtDate(b.introduced)} · ` : ''}session {b.session}
                {b.url && (
                  <>
                    {' · '}
                    <a href={b.url} target="_blank" rel="noreferrer">
                      openparliament
                    </a>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
