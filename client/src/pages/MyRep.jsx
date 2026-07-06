import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getJSON } from '../api.js';
import { partyMeta } from '../partyMeta.js';
import Avatar from '../components/Avatar.jsx';
import { VoteBar, fmtDate } from '../components/Bits.jsx';

const COMPARE_MAX = 8;
// Curated to topics with recorded divisions in the current session — revisit
// when a new session starts (the empty state handles misses either way).
const SUGGESTIONS = [
  'housing',
  'budget',
  'defence',
  'trade',
  'immigration',
  'carbon tax',
  'child care',
  'pipeline',
  'affordability',
];

const BALLOT = {
  Yes: { label: '✓ Yea', cls: 'b-yes' },
  No: { label: '✗ Nay', cls: 'b-no' },
  Paired: { label: 'Paired', cls: 'b-other' },
  "Didn't vote": { label: '—', cls: 'b-other', title: 'Didn’t vote' },
};

const lastName = (name) => (name || '').split(' ').filter(Boolean).slice(-1)[0] || name;
const titleCase = (s) =>
  (s || '').toLowerCase().replace(/(^|[\s-])([a-z])/g, (m) => m.toUpperCase());

function BallotChip({ value, loading }) {
  if (loading) return <span className="muted">…</span>;
  if (!value) return <span className="muted" title="No ballot on record — not a sitting member for this vote">·</span>;
  const b = BALLOT[value] || { label: value, cls: 'b-other' };
  return (
    <span className={`ballot ballot-sm ${b.cls}`} title={b.title || value}>
      {b.label}
    </span>
  );
}

function VoteRow({ v }) {
  return (
    <div className="voterow">
      <span className={'ballot ' + (v.result === 'Passed' ? 'b-yes' : 'b-no')}>{v.result}</span>
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
        </div>
        <VoteBar yea={v.yea} nay={v.nay} paired={v.paired} />
      </div>
    </div>
  );
}

export default function MyRep() {
  const [params, setParams] = useSearchParams();
  const postcode = params.get('postcode') || '';
  const q = params.get('q') || '';

  const [pcInput, setPcInput] = useState(postcode);
  const [qInput, setQInput] = useState(q);
  useEffect(() => setPcInput(postcode), [postcode]);
  useEffect(() => setQInput(q), [q]);

  const [rep, setRep] = useState(null);
  const [repErr, setRepErr] = useState(null);
  const [search, setSearch] = useState(null);
  const [searchErr, setSearchErr] = useState(null);
  const [excluded, setExcluded] = useState(() => new Set());
  const [ballots, setBallots] = useState({});

  useEffect(() => {
    setRep(null);
    setRepErr(null);
    setExcluded(new Set());
    if (!postcode) return;
    let stale = false;
    getJSON(`/api/rep/${encodeURIComponent(postcode)}`)
      .then((d) => !stale && setRep(d))
      .catch((e) => !stale && setRepErr(e.message));
    return () => {
      stale = true;
    };
  }, [postcode]);

  useEffect(() => {
    setSearch(null);
    setSearchErr(null);
    if (!q) return;
    let stale = false;
    getJSON(`/api/issues/search?q=${encodeURIComponent(q)}`)
      .then((d) => !stale && setSearch(d))
      .catch((e) => !stale && setSearchErr(e.message));
    return () => {
      stale = true;
    };
  }, [q]);

  // Who's in the comparison: your MP + every non-excluded neighbour we could
  // match to an openparliament profile.
  const compareMps = rep?.mp?.slug
    ? [
        { ...rep.mp, you: true },
        ...(rep.neighbours || [])
          .map((n) => n.mp)
          .filter((m) => m?.slug && !excluded.has(m.slug)),
      ]
    : [];
  const compareVotes = (search?.votes || []).slice(0, COMPARE_MAX);
  const comparing = compareMps.length > 0 && compareVotes.length > 0;

  // Ballots load one division at a time — the server makes one upstream
  // request per division, and parallel bursts trip openparliament's limits.
  useEffect(() => {
    if (!comparing) return;
    let cancelled = false;
    (async () => {
      for (const v of compareVotes) {
        const key = `${v.session}/${v.number}`;
        try {
          const d = await getJSON(`/api/vote-ballots?vote=${encodeURIComponent(key)}`);
          if (cancelled) return;
          setBallots((prev) => (prev[key] ? prev : { ...prev, [key]: d.ballots }));
        } catch {
          if (cancelled) return;
          setBallots((prev) => ({ ...prev, [key]: prev[key] || {} }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparing, search]);

  const submit = (e) => {
    e.preventDefault();
    const next = {};
    if (pcInput.trim()) next.postcode = pcInput.trim().toUpperCase();
    if (qInput.trim()) next.q = qInput.trim();
    setParams(next);
  };

  const pickSuggestion = (s) => setParams(postcode ? { postcode, q: s } : { q: s });

  const toggleNeighbour = (slug) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  // Per-column agreement with your MP, over rows where both cast Yes/No.
  const agreement = (slug) => {
    if (!rep?.mp?.slug) return null;
    let same = 0;
    let both = 0;
    for (const v of compareVotes) {
      const row = ballots[`${v.session}/${v.number}`];
      const a = row?.[rep.mp.slug];
      const b = row?.[slug];
      if ((a === 'Yes' || a === 'No') && (b === 'Yes' || b === 'No')) {
        both++;
        if (a === b) same++;
      }
    }
    return both ? `${same}/${both}` : '—';
  };

  const extraVotes = (search?.votes || []).slice(COMPARE_MAX);

  return (
    <div className="page">
      <header className="page-header">
        <h1>My rep</h1>
        <p className="page-sub">
          Something bugging you? Find who represents you, see how they voted on it, and compare
          with the members next door.
        </p>
      </header>

      <div className="card">
        <form onSubmit={submit} className="hero-grid">
          <label>
            <div className="microlabel">Your postal code</div>
            <input
              className="search hero-input"
              placeholder="e.g. V6B 1A1"
              value={pcInput}
              onChange={(e) => setPcInput(e.target.value)}
              autoComplete="postal-code"
            />
          </label>
          <label>
            <div className="microlabel">The issue bugging you</div>
            <input
              className="search hero-input"
              placeholder="e.g. housing, carbon tax, or a bill number like C-5"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
            />
          </label>
          <button className="btn" type="submit">
            Look it up
          </button>
        </form>
        <div className="chips chips-tight">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className={'chip' + (q === s ? ' active' : '')}
              onClick={() => pickSuggestion(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {repErr && (
        <div className="card error-card">
          <div className="card-title">Couldn’t find your rep</div>
          <p>{repErr}</p>
        </div>
      )}
      {postcode && !rep && !repErr && (
        <div className="card">
          <div className="loading loading-inline">
            <span className="spinner" />
            Locating your riding…
          </div>
        </div>
      )}

      {rep && (
        <div className="card">
          <div className="microlabel">
            Your MP · {rep.riding}
            {rep.city ? ` · ${titleCase(rep.city)}, ${rep.province}` : ''}
          </div>
          {rep.mp ? (
            rep.mp.slug ? (
              <Link to={`/mp/${rep.mp.slug}`} className="repcard">
                <Avatar name={rep.mp.name} src={rep.mp.image} size={56} />
                <div>
                  <div className="repcard-name">{rep.mp.name}</div>
                  <div className="muted">
                    <span
                      className="pill"
                      style={{
                        color: partyMeta(rep.mp.party).color,
                        background: partyMeta(rep.mp.party).bg,
                      }}
                    >
                      {rep.mp.party}
                    </span>{' '}
                    {rep.riding}
                  </div>
                </div>
              </Link>
            ) : (
              <div className="repcard">
                <Avatar name={rep.mp.name} src={rep.mp.image} size={56} />
                <div>
                  <div className="repcard-name">{rep.mp.name}</div>
                  <div className="muted">{rep.mp.party}</div>
                </div>
              </div>
            )
          ) : (
            <p className="muted">This seat appears to be vacant right now.</p>
          )}

          {rep.neighbours?.length > 0 && (
            <>
              <div className="microlabel offices-label">
                Members in the area — click to include or drop from the comparison
              </div>
              <div className="chips chips-tight" style={{ marginTop: 6 }}>
                {rep.neighbours.map((n) =>
                  n.mp?.slug ? (
                    <button
                      key={n.riding}
                      type="button"
                      className={'chip' + (excluded.has(n.mp.slug) ? ' chip-off' : ' chip-on')}
                      onClick={() => toggleNeighbour(n.mp.slug)}
                      title={`${n.riding}${n.alsoYours ? ' (your postal code spans this riding too)' : ''}`}
                    >
                      <span
                        className="chip-dot"
                        style={{ background: partyMeta(n.mp.party).color }}
                      />
                      {n.mp.name} · {n.riding}
                      {n.alsoYours ? ' *' : ''}
                    </button>
                  ) : (
                    <span
                      key={n.riding}
                      className="chip chip-off"
                      title="No openparliament profile for this member — can't include in the vote comparison"
                    >
                      {n.mp ? n.mp.name : 'vacant seat'} · {n.riding}
                    </span>
                  )
                )}
              </div>
            </>
          )}
        </div>
      )}

      {searchErr && (
        <div className="card error-card">
          <div className="card-title">Search didn’t work</div>
          <p>{searchErr}</p>
        </div>
      )}
      {q && !search && !searchErr && (
        <div className="card">
          <div className="loading loading-inline">
            <span className="spinner" />
            Searching this session’s divisions for “{q}”…
          </div>
        </div>
      )}

      {search && search.votes.length === 0 && (
        <div className="card">
          <div className="card-title">No matching divisions</div>
          <p className="muted">
            Nothing in the {search.session} session matched “{search.query}”. Recorded divisions
            only cover what actually came to a vote — try a broader word, or one of the
            suggestions above.
          </p>
        </div>
      )}

      {search && search.votes.length > 0 && (
        <div className="card">
          <div className="card-title">
            How they voted on “{search.query}”
            {search.relaxed && <span className="tag-soon">loose match</span>}
          </div>
          <p className="muted">
            {search.totalVotes} matching division{search.totalVotes === 1 ? '' : 's'} in the{' '}
            {search.session} session
            {comparing && search.totalVotes > COMPARE_MAX
              ? ` — comparing the ${COMPARE_MAX} most recent`
              : ''}
            .
            {!rep && ' Add your postal code above to see how your own MP voted.'}
          </p>

          {comparing ? (
            <>
              <div className="table-scroll">
                <table className="data-table compare-table">
                  <thead>
                    <tr>
                      <th>Division</th>
                      {compareMps.map((m) => (
                        <th key={m.slug} className={'mp-col' + (m.you ? ' you-col' : '')}>
                          <Link to={`/mp/${m.slug}`} className="mp-colhead" title={`${m.name} · ${m.riding}`}>
                            <Avatar name={m.name} src={m.image} size={30} />
                            <span className="mp-colname">
                              {lastName(m.name)}
                              {m.you && <span className="you-tag">you</span>}
                            </span>
                            <span
                              className="party-dot"
                              style={{ background: partyMeta(m.party).color }}
                            />
                          </Link>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {compareVotes.map((v) => {
                      const key = `${v.session}/${v.number}`;
                      const row = ballots[key];
                      return (
                        <tr key={key}>
                          <td className="compare-desc">
                            {v.url ? (
                              <a href={v.url} target="_blank" rel="noreferrer">
                                {v.description}
                              </a>
                            ) : (
                              v.description
                            )}
                            <div className="list-row-meta">
                              {fmtDate(v.date)} · #{v.number} · {v.result} {v.yea}–{v.nay}
                            </div>
                          </td>
                          {compareMps.map((m) => (
                            <td key={m.slug} className={'mp-cell' + (m.you ? ' you-col' : '')}>
                              <BallotChip value={row?.[m.slug]} loading={!row} />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                  {compareMps.length > 1 && (
                    <tfoot>
                      <tr>
                        <td className="muted">Voted the same as your MP</td>
                        {compareMps.map((m) => (
                          <td key={m.slug} className={'mp-cell muted' + (m.you ? ' you-col' : '')}>
                            {m.you ? '—' : agreement(m.slug)}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              {extraVotes.length > 0 && (
                <>
                  <div className="microlabel offices-label">
                    Older matching divisions (not in the comparison)
                  </div>
                  {extraVotes.map((v) => (
                    <VoteRow key={`${v.session}-${v.number}`} v={v} />
                  ))}
                </>
              )}
            </>
          ) : (
            search.votes.map((v) => <VoteRow key={`${v.session}-${v.number}`} v={v} />)
          )}
        </div>
      )}

      {search && search.bills.length > 0 && (
        <div className="card">
          <div className="card-title">Matching bills</div>
          {search.bills.map((b) => (
            <div key={`${b.session}-${b.number}`} className="list-row">
              <span className="bill-badge">{b.number}</span>
              <div className="list-row-body">
                <div className="list-row-title">{b.name || '(untitled)'}</div>
                <div className="list-row-meta">
                  {b.introduced ? `introduced ${fmtDate(b.introduced)} · ` : ''}
                  {b.url && (
                    <a href={b.url} target="_blank" rel="noreferrer">
                      openparliament
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="muted attribution">
        Riding lookup by the{' '}
        <a href="https://represent.opennorth.ca/" target="_blank" rel="noreferrer">
          Represent API
        </a>{' '}
        (Open North) · votes from openparliament.ca. The postal code is sent only to Represent,
        via the local caching proxy, to resolve your riding.
      </p>
    </div>
  );
}
