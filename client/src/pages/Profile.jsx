import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getJSON } from '../api.js';
import { partyMeta } from '../partyMeta.js';
import Avatar from '../components/Avatar.jsx';
import { Loading, ErrorCard, VoteBar, fmtDate } from '../components/Bits.jsx';

const ballotClass = (b) => (b === 'Yes' ? 'b-yes' : b === 'No' ? 'b-no' : 'b-other');

export default function Profile() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    setData(null);
    setErr(null);
    getJSON(`/api/mps/${slug}`).then(setData).catch((e) => setErr(e.message));
    window.scrollTo(0, 0);
  }, [slug]);

  if (err) return <ErrorCard msg={err} />;
  if (!data) return <Loading label="Brewing this member's record…" />;

  const { profile: p, ballots, bills } = data;
  const pm = partyMeta(p.party);
  const sinceYear = p.mpSince ? p.mpSince.slice(0, 4) : '—';

  const legisinfoUrl = (b) =>
    b.session && b.number
      ? `https://www.parl.ca/legisinfo/en/bill/${b.session}/${b.number.toLowerCase()}`
      : null;

  const sources = [
    {
      name: 'Official MP page',
      desc: 'Roles, committee work and contact on ourcommons.ca',
      href: p.parlMpId
        ? `https://www.ourcommons.ca/members/en/${p.parlMpId}`
        : 'https://www.ourcommons.ca/members/en/search',
    },
    {
      name: 'Members’ expenditures',
      desc: 'Quarterly office, travel and hospitality spending',
      href: 'https://www.ourcommons.ca/proactivedisclosure/en/members',
      tag: 'integration planned',
    },
    {
      name: 'Campaign finance',
      desc: 'Candidate and riding-association returns, Elections Canada',
      href: 'https://www.elections.ca/WPAPPS/WPF/EN/Home/Index',
      tag: 'integration planned',
    },
    {
      name: 'Ethics disclosures',
      desc: 'Conflict of Interest and Ethics Commissioner public registry',
      href: 'https://ciec-ccie.parl.gc.ca/',
      tag: 'integration planned',
    },
    {
      name: 'Lobbying registry',
      desc: 'Registered lobbying of this office, with communication reports',
      href: 'https://lobbycanada.gc.ca/',
      tag: 'integration planned',
    },
    ...(p.wikipediaId
      ? [
          {
            name: 'Wikipedia',
            desc: 'Biography',
            href: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.wikipediaId)}`,
          },
        ]
      : []),
  ];

  return (
    <div className="page" id="top">
      <div className="card profile-header">
        <Avatar name={p.name} src={p.image} size={72} />
        <div className="profile-header-info">
          <h1>
            {p.name}
            <span className="pill pill-lg" style={{ color: pm.color, background: pm.bg }}>
              {p.party}
            </span>
          </h1>
          <p className="page-sub">
            {p.riding}
            {p.province ? ` · ${p.province}` : ''} · House of Commons
            {p.isCurrent ? ` · MP since ${sinceYear}` : ' · former MP'}
          </p>
        </div>
      </div>

      <div className="tiles">
        <div className="card tile">
          <div className="microlabel">MP since</div>
          <div className="tile-value">{sinceYear}</div>
        </div>
        <div className="card tile">
          <div className="microlabel">Province</div>
          <div className="tile-value">{p.province || '—'}</div>
        </div>
        <div className="card tile">
          <div className="microlabel">Bills sponsored</div>
          <div className="tile-value">{bills.length}</div>
        </div>
        {p.favouriteWord ? (
          <div className="card tile">
            <div className="microlabel">Most-said word</div>
            <div className="tile-value tile-word">“{p.favouriteWord}”</div>
          </div>
        ) : (
          <div className="card tile">
            <div className="microlabel">Career stints</div>
            <div className="tile-value">{p.memberships.length}</div>
          </div>
        )}
      </div>

      <div className="card" id="votes">
        <div className="card-title">Recent votes</div>
        {ballots.length === 0 && <p className="muted">No recorded votes yet.</p>}
        {ballots.map((v, i) => (
          <div key={i} className="voterow">
            <span className={'ballot ' + ballotClass(v.ballot)}>{v.ballot}</span>
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
                {v.date ? `${fmtDate(v.date)} · ` : ''}
                {v.session ? `Vote ${v.session} #${v.number} · ` : ''}
                {v.result}
                {v.yea || v.nay ? ` · ${v.yea}–${v.nay}` : ''}
              </div>
              <VoteBar yea={v.yea} nay={v.nay} paired={v.paired} />
            </div>
          </div>
        ))}
      </div>

      <div className="card" id="bills">
        <div className="card-title">Sponsored bills</div>
        {bills.length === 0 && <p className="muted">No sponsored bills on record.</p>}
        {bills.map((b) => (
          <div key={`${b.session}-${b.number}`} className="list-row">
            <span className="bill-badge">{b.number}</span>
            <div className="list-row-body">
              <div className="list-row-title">{b.name || '(untitled)'}</div>
              <div className="list-row-meta">
                {b.introduced ? `introduced ${fmtDate(b.introduced)} · ` : ''}session {b.session}
                {' · '}
                {b.url && (
                  <a href={b.url} target="_blank" rel="noreferrer">
                    openparliament
                  </a>
                )}
                {legisinfoUrl(b) && (
                  <>
                    {' · '}
                    <a href={legisinfoUrl(b)} target="_blank" rel="noreferrer">
                      LEGISinfo
                    </a>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card" id="career">
        <div className="card-title">Career in the House</div>
        <div className="timeline">
          {p.memberships.map((m, i) => (
            <div key={i} className="timeline-row">
              <div className="timeline-dates">
                {(m.start || '').slice(0, 4)}–{m.end ? m.end.slice(0, 4) : 'now'}
              </div>
              <div className="timeline-label">{m.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" id="contact">
        <div className="card-title">Contact</div>
        <div className="kv-grid">
          {p.email && (
            <div className="kv">
              <div className="microlabel">Email</div>
              <a href={`mailto:${p.email}`}>{p.email}</a>
            </div>
          )}
          {p.voice && (
            <div className="kv">
              <div className="microlabel">Hill office</div>
              <div>{p.voice}</div>
            </div>
          )}
          {p.twitter && (
            <div className="kv">
              <div className="microlabel">X / Twitter</div>
              <a href={`https://x.com/${p.twitter}`} target="_blank" rel="noreferrer">
                @{p.twitter}
              </a>
            </div>
          )}
        </div>
        {p.constituencyOffices.length > 0 && (
          <>
            <div className="microlabel offices-label">Constituency offices</div>
            <div className="offices">
              {p.constituencyOffices.map((o, i) => (
                <pre key={i} className="office">
                  {o}
                </pre>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="card" id="sources">
        <div className="card-title">More public records</div>
        <p className="muted">
          The paper trail continues in these official sources — future sections of this app.
        </p>
        {sources.map((s) => (
          <a key={s.name} className="list-row extlink" href={s.href} target="_blank" rel="noreferrer">
            <div className="list-row-body">
              <div className="list-row-title">
                {s.name} ↗{s.tag && <span className="tag-soon">{s.tag}</span>}
              </div>
              <div className="list-row-meta">{s.desc}</div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
