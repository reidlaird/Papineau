import { useEffect, useState } from 'react';
import { getJSON } from '../api.js';
import { Loading, ErrorCard, VoteBar, fmtDate } from '../components/Bits.jsx';

export default function Votes() {
  const [votes, setVotes] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    getJSON('/api/votes').then(setVotes).catch((e) => setErr(e.message));
  }, []);

  if (err) return <ErrorCard msg={err} />;
  if (!votes) return <Loading label="Pouring the latest divisions…" />;

  return (
    <div className="page">
      <header className="page-header">
        <h1>House votes</h1>
        <p className="page-sub">Most recent recorded divisions in the House of Commons</p>
      </header>

      <div className="card">
        {votes.map((v) => (
          <div key={`${v.session}-${v.number}`} className="voterow">
            <span className={'ballot ' + (v.result === 'Passed' ? 'b-yes' : 'b-no')}>
              {v.result}
            </span>
            <div className="voterow-body">
              <div className="voterow-desc">
                {v.url ? (
                  <a href={v.url} target="_blank" rel="noreferrer">
                    {v.description}
                  </a>
                ) : (
                  v.description
                )}
              </div>
              <div className="voterow-meta">
                {fmtDate(v.date)} · Vote {v.session} #{v.number}
                {v.billNumber ? ` · Bill ${v.billNumber}` : ''} · {v.yea}–{v.nay}
                {v.paired ? ` (${v.paired} paired)` : ''}
              </div>
              <VoteBar yea={v.yea} nay={v.nay} paired={v.paired} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
