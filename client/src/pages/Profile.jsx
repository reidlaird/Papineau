import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getJSON } from '../api.js';
import { partyMeta } from '../partyMeta.js';
import Avatar from '../components/Avatar.jsx';
import { Loading, ErrorCard, VoteBar, fmtDate, legisinfoUrl } from '../components/Bits.jsx';

const ballotClass = (b) => (b === 'Yes' ? 'b-yes' : b === 'No' ? 'b-no' : 'b-other');

const MAX_RESULT_ROWS = 6;

function ElectionBlock({ e }) {
  const shown = e.candidates.slice(0, MAX_RESULT_ROWS);
  const rest = e.candidates.slice(MAX_RESULT_ROWS);
  const restShare = rest.reduce((s, c) => s + c.share, 0);
  return (
    <div className="ge-block">
      <div className="microlabel">
        {fmtDate(e.date)} · General election {e.ge}
      </div>
      {shown.map((c, i) => (
        <div className="result-row" key={i}>
          <div
            className="result-name"
            title={c.incumbent ? `${c.name} — sitting member at dissolution` : c.name}
          >
            {c.elected ? <b>✓ {c.name}</b> : c.name}
            <span className="result-party"> · {c.party}</span>
          </div>
          <div className="result-track">
            <span
              className="result-fill"
              style={{ width: `${c.share}%`, background: partyMeta(c.party).color, display: 'block' }}
            />
          </div>
          <div className="result-nums">
            <b>{c.share.toFixed(1)}%</b> · {c.votes.toLocaleString('en-CA')}
          </div>
        </div>
      ))}
      <div className="ge-meta">
        {rest.length > 0 ? `+ ${rest.length} more · ${restShare.toFixed(1)}% combined · ` : ''}
        {e.totalVotes.toLocaleString('en-CA')} valid votes
        {e.turnout != null
          ? ` · ${e.turnout.toFixed(1)}% turnout${e.electors ? ` of ${e.electors.toLocaleString('en-CA')} electors` : ''}`
          : ''}
        {e.margin != null ? ` · won by ${e.margin.toFixed(1)} points` : ''}
      </div>
    </div>
  );
}

function ElectionsCard({ riding, elections }) {
  const maxMargin = elections?.length
    ? Math.max(...elections.map((e) => e.margin ?? 0), 1)
    : 1;
  return (
    <div className="card" id="elections">
      <div className="card-title">Elections in {riding}</div>
      {elections === null && (
        <div className="loading loading-inline">
          <span className="spinner" />
          Counting past ballots…
        </div>
      )}
      {elections?.length === 0 && (
        <p className="muted">
          No official results under this riding’s current name — riding names and boundaries
          change between representation orders. Full records live at elections.ca.
        </p>
      )}
      {elections?.length > 0 && (
        <>
          {elections.length > 1 && (
            <>
              <div className="microlabel">Margin of victory · percentage points</div>
              <div className="margin-trend">
                {[...elections].reverse().map((e) => {
                  const winner = e.candidates.find((c) => c.elected) || e.candidates[0];
                  return (
                    <div
                      className="margin-col"
                      key={e.ge}
                      title={`${e.date.slice(0, 4)} — ${winner?.name} (${winner?.party}) by ${e.margin ?? '?'} points`}
                    >
                      <span className="margin-val">{e.margin != null ? e.margin.toFixed(1) : '—'}</span>
                      <div className="margin-bar">
                        <span
                          className="margin-fill"
                          style={{
                            height: `${Math.max(((e.margin ?? 0) / maxMargin) * 100, 5)}%`,
                            background: partyMeta(winner?.party).color,
                            display: 'block',
                          }}
                        />
                      </div>
                      <span className="margin-year">{e.date.slice(0, 4)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {elections.map((e) => (
            <ElectionBlock key={e.ge} e={e} />
          ))}
          <p className="muted attribution">
            Official voting results, Elections Canada. Earlier elections shown where a riding
            with the same name existed — boundaries may differ across representation orders.
          </p>
        </>
      )}
    </div>
  );
}

const fmtMoney = (n) => '$' + Math.round(n).toLocaleString('en-CA');
const fmtMoneyShort = (n) =>
  n >= 995000
    ? `$${(n / 1e6).toFixed(1)}M`
    : n >= 1000
      ? `$${Math.round(n / 1000)}k`
      : `$${Math.round(n)}`;

const evLabel = (e) => (e.kind === 'ge' ? `General election ${e.ge}` : 'By-election');

// [250, 500, 1000] → "Up to $250", "$250–$500", "$500–$1,000", "Over $1,000"
const bucketLabels = (edges) => [
  `Up to $${edges[0]}`,
  ...edges.slice(1).map((e, i) => `$${edges[i]}–$${e.toLocaleString('en-CA')}`),
  `Over $${edges[edges.length - 1].toLocaleString('en-CA')}`,
];

function FinanceBlock({ e, edges, homeProvince }) {
  const m = e.mine;
  const total = m.monetary + m.nonMonetary;
  const fieldTotal = e.fieldMonetary + e.fieldNonMonetary;
  const color = partyMeta(m.party).color;
  const homeAmt = (homeProvince && m.provinces[homeProvince]) || 0;
  const share = fieldTotal > 0 ? Math.round((total / fieldTotal) * 100) : null;
  return (
    <div className="ge-block">
      <div className="microlabel">
        {fmtDate(e.date)} · {evLabel(e)}
      </div>
      <div className="fin-headline">
        <span className="fin-total">{fmtMoney(total)}</span>
        <span className="fin-headline-meta">
          {m.count} itemized contribution{m.count === 1 ? '' : 's'}
          {m.count > 0 ? ` · average ${fmtMoney(total / m.count)}` : ''}
        </span>
      </div>
      {bucketLabels(edges).map((label, i) => (
        <div className="result-row" key={label}>
          <div className="result-name">{label}</div>
          <div className="result-track">
            <span
              className="result-fill"
              style={{
                width: `${total > 0 ? (m.bucketAmounts[i] / total) * 100 : 0}%`,
                background: color,
                display: 'block',
              }}
            />
          </div>
          <div className="result-nums">
            <b>{fmtMoney(m.bucketAmounts[i])}</b> · {m.bucketCounts[i]}
          </div>
        </div>
      ))}
      <div className="ge-meta">
        {share != null
          ? `${share}% of the ${fmtMoneyShort(fieldTotal)} reported by ${e.candidates} campaign${e.candidates === 1 ? '' : 's'} in the riding`
          : ''}
        {homeAmt > 0 && total > 0 ? ` · ${Math.round((homeAmt / total) * 100)}% from ${homeProvince}` : ''}
        {m.nonMonetary > 0 ? ` · includes ${fmtMoney(m.nonMonetary)} in goods & services` : ''}
      </div>
    </div>
  );
}

function FinanceCard({ riding, mpName, province, finance }) {
  const events = finance?.events;
  const matched = (events || []).filter((e) => e.mine);
  const maxTotal = Math.max(...matched.map((e) => e.mine.monetary + e.mine.nonMonetary), 1);
  const newest = events?.[0];
  return (
    <div className="card" id="finance">
      <div className="card-title">Campaign finance in {riding}</div>
      {finance === null && (
        <div className="loading loading-inline">
          <span className="spinner" />
          Following the money…
        </div>
      )}
      {events?.length === 0 && (
        <p className="muted">
          No candidate returns under this riding’s current name yet — full records live in
          Elections Canada’s financial-returns database.
        </p>
      )}
      {events?.length > 0 && (
        <>
          {matched.length > 1 && (
            <>
              <div className="microlabel">Reported contributions · this member’s campaigns</div>
              <div className="margin-trend">
                {[...matched].reverse().map((e) => {
                  const total = e.mine.monetary + e.mine.nonMonetary;
                  return (
                    <div
                      className="margin-col"
                      key={e.date}
                      title={`${e.date.slice(0, 4)} — ${fmtMoney(total)} reported (${e.mine.count} contributions)`}
                    >
                      <span className="margin-val">{fmtMoneyShort(total)}</span>
                      <div className="margin-bar">
                        <span
                          className="margin-fill"
                          style={{
                            height: `${Math.max((total / maxTotal) * 100, 5)}%`,
                            background: partyMeta(e.mine.party).color,
                            display: 'block',
                          }}
                        />
                      </div>
                      <span className="margin-year">{e.date.slice(0, 4)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {matched.map((e) => (
            <FinanceBlock key={e.date} e={e} edges={finance.bucketEdges} homeProvince={province} />
          ))}
          {matched.length > 0 && matched.length < events.length && (
            <p className="muted fin-missing">
              No itemized contributions under this member’s name for{' '}
              {events
                .filter((e) => !e.mine)
                .map((e) => `${evLabel(e)} (${e.date.slice(0, 4)})`)
                .join(' · ')}
              .
            </p>
          )}
          {matched.length === 0 && newest && (
            <>
              <p className="muted">
                No return under {mpName}’s name in this riding’s records — they may have run
                elsewhere, or their return may still be in audit. Top reported campaigns:
              </p>
              <div className="microlabel">
                {fmtDate(newest.date)} · {evLabel(newest)}
              </div>
              {newest.top.map((t) => (
                <div className="result-row" key={t.name}>
                  <div className="result-name">
                    {t.name}
                    <span className="result-party"> · {t.party}</span>
                  </div>
                  <div className="result-track">
                    <span
                      className="result-fill"
                      style={{
                        width: `${(t.total / Math.max(newest.top[0].total, 1)) * 100}%`,
                        background: partyMeta(t.party).color,
                        display: 'block',
                      }}
                    />
                  </div>
                  <div className="result-nums">
                    <b>{fmtMoney(t.total)}</b>
                  </div>
                </div>
              ))}
            </>
          )}
          <p className="muted attribution">
            Itemized contributions from candidates’ campaign returns, Elections Canada open data
            (as reviewed{finance.built ? `, ${finance.built}` : ''}). Donations over $200 must be
            itemized — smaller gifts appear only in return totals. Party and riding-association
            fundraising are separate returns, and recent elections fill in as audits complete.
          </p>
        </>
      )}
    </div>
  );
}

const WARCHEST_RECENT_YEARS = 5;

function WarChestCard({ riding, eda }) {
  const [showAll, setShowAll] = useState(false);
  const years = eda?.years;
  const maxTotal = Math.max(...(years || []).map((y) => y.total), 1);
  const shown = showAll ? years || [] : (years || []).slice(0, WARCHEST_RECENT_YEARS);
  return (
    <div className="card" id="warchest">
      <div className="card-title">Riding war chests in {riding}</div>
      {eda === null && (
        <div className="loading loading-inline">
          <span className="spinner" />
          Counting the war chests…
        </div>
      )}
      {years?.length === 0 && (
        <p className="muted">
          No association returns under this riding’s name — riding associations file
          annually, and riding names shift between representation orders.
        </p>
      )}
      {years?.length > 0 && (
        <>
          {years.length > 1 && (
            <>
              <div className="microlabel">Reported contributions · all associations, by fiscal year</div>
              <div className="margin-trend">
                {[...years]
                  .slice(0, 12)
                  .reverse()
                  .map((y) => (
                    <div
                      className="margin-col"
                      key={y.year}
                      title={`${y.year} — ${fmtMoney(y.total)} across ${y.assocs.length} association${y.assocs.length === 1 ? '' : 's'}`}
                    >
                      <span className="margin-val">{fmtMoneyShort(y.total)}</span>
                      <div className="margin-bar">
                        <span
                          className="margin-fill"
                          style={{
                            height: `${Math.max((y.total / maxTotal) * 100, 5)}%`,
                            background: 'var(--indigo-500)',
                            display: 'block',
                          }}
                        />
                      </div>
                      <span className="margin-year">{y.year}</span>
                    </div>
                  ))}
              </div>
            </>
          )}
          {shown.map((y) => (
            <div className="ge-block" key={y.year}>
              <div className="microlabel">Fiscal {y.year} · {fmtMoney(y.total)} reported</div>
              {y.assocs.map((a) => {
                const total = a.monetary + a.nonMonetary;
                return (
                  <div className="result-row" key={a.name}>
                    <div className="result-name" title={a.name}>
                      {a.name}
                      <span className="result-party"> · {a.party}</span>
                    </div>
                    <div className="result-track">
                      <span
                        className="result-fill"
                        style={{
                          width: `${(total / Math.max(y.assocs[0].monetary + y.assocs[0].nonMonetary, 1)) * 100}%`,
                          background: partyMeta(a.party).color,
                          display: 'block',
                        }}
                      />
                    </div>
                    <div className="result-nums">
                      <b>{fmtMoney(total)}</b> · {a.count}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          {years.length > WARCHEST_RECENT_YEARS && (
            <button className="chip exp-toggle" onClick={() => setShowAll((s) => !s)}>
              {showAll ? 'Show recent years only' : `Show all ${years.length} years`}
            </button>
          )}
          <p className="muted attribution">
            Itemized contributions from riding associations’ annual returns, Elections Canada
            open data{eda.built ? ` (as reviewed, ${eda.built})` : ''}. Gifts over $200 must be
            itemized; the dump currently has no fiscal-2019 rows, and recent years fill in as
            returns land. Candidate campaigns and central parties file separately.
          </p>
        </>
      )}
    </div>
  );
}

// Fiscal quarters: FY ends March 31, so Q1 FY2026 = Apr–Jun 2025, Q4 = Jan–Mar 2026.
const QUARTER_MONTHS = ['', 'Apr–Jun', 'Jul–Sep', 'Oct–Dec', 'Jan–Mar'];
const expCalYear = (r) => (r.q === 4 ? r.fy : r.fy - 1);
const expLabel = (r) => `${QUARTER_MONTHS[r.q]} ${expCalYear(r)}`;
const expTick = (r) => `${QUARTER_MONTHS[r.q].slice(0, 3)} ’${String(expCalYear(r)).slice(2)}`;

const EXP_CATS = [
  ['salaries', 'Salaries'],
  ['travel', 'Travel'],
  ['hospitality', 'Hospitality'],
  ['contracts', 'Contracts'],
];

const EXP_TREND_MAX = 12; // columns get unreadably thin past three years

function ExpendituresCard({ mpName, exp }) {
  const [showAll, setShowAll] = useState(false);
  const matched = (exp?.rows || []).filter((r) => r.mine);
  const maxTotal = Math.max(...matched.map((r) => r.mine.total), 1);
  const shown = showAll ? matched : matched.slice(0, 4);
  return (
    <div className="card" id="expenditures">
      <div className="card-title">Office & travel spending</div>
      {exp === null && (
        <div className="loading loading-inline">
          <span className="spinner" />
          Tallying office ledgers…
        </div>
      )}
      {exp && matched.length === 0 && exp.done && (
        <p className="muted">
          No expenditure report under {mpName}’s name — quarterly reports begin in July 2020,
          appear about three months after each quarter ends, and follow the riding names of
          their day.
        </p>
      )}
      {matched.length > 0 && (
        <>
          {matched.length > 1 && (
            <>
              <div className="microlabel">Total spending by quarter</div>
              <div className="margin-trend">
                {matched
                  .slice(0, EXP_TREND_MAX)
                  .reverse()
                  .map((r) => (
                    <div
                      className="margin-col"
                      key={`${r.fy}-${r.q}`}
                      title={`${expLabel(r)} — ${fmtMoney(r.mine.total)} (house median ${fmtMoney(r.house.median)})`}
                    >
                      <span className="margin-val">{fmtMoneyShort(r.mine.total)}</span>
                      <div className="margin-bar">
                        <span
                          className="margin-fill"
                          style={{
                            height: `${Math.max((r.mine.total / maxTotal) * 100, 5)}%`,
                            background: 'var(--indigo-500)',
                            display: 'block',
                          }}
                        />
                      </div>
                      <span className="margin-year">{expTick(r)}</span>
                    </div>
                  ))}
              </div>
            </>
          )}
          {shown.map((r) => (
            <div className="ge-block" key={`${r.fy}-${r.q}`}>
              <div className="microlabel">{expLabel(r)} · quarterly report</div>
              <div className="fin-headline">
                <span className="fin-total">{fmtMoney(r.mine.total)}</span>
                <span className="fin-headline-meta">
                  house median {fmtMoney(r.house.median)} · {r.house.reporting} members reporting
                </span>
              </div>
              {EXP_CATS.map(([k, label]) => (
                <div className="result-row" key={k}>
                  <div className="result-name">{label}</div>
                  <div className="result-track">
                    <span
                      className="result-fill"
                      style={{
                        width: `${
                          r.mine.total > 0 ? (Math.max(r.mine[k], 0) / r.mine.total) * 100 : 0
                        }%`,
                        background: 'var(--indigo-500)',
                        display: 'block',
                      }}
                    />
                  </div>
                  <div className="result-nums">
                    <b>{fmtMoney(r.mine[k])}</b>
                  </div>
                </div>
              ))}
            </div>
          ))}
          {matched.length > 4 && (
            <button className="chip exp-toggle" onClick={() => setShowAll((s) => !s)}>
              {showAll ? 'Show recent quarters only' : `Show all ${matched.length} quarters`}
            </button>
          )}
          {!exp.done && (
            <div className="loading loading-inline">
              <span className="spinner" />
              Fetching older quarters…
            </div>
          )}
          <p className="muted attribution">
            Members’ Expenditures Reports, House of Commons proactive disclosure. Salaries are
            the member’s office staff; Contracts include constituency office leases,
            advertising, office operations and training. Negative amounts are adjustments or
            refunds, and quarters publish about three months in arrears.
          </p>
        </>
      )}
    </div>
  );
}

function LobbyingCard({ mpName, lobby }) {
  const l = lobby?.lobbying;
  const years = l ? Object.keys(l.byYear).sort() : [];
  const trendYears = years.slice(-12);
  const maxYear = Math.max(...trendYears.map((y) => l?.byYear[y] || 0), 1);
  const maxClient = Math.max(...(l?.topClients || []).map((c) => c.n), 1);
  return (
    <div className="card" id="lobbying">
      <div className="card-title">Registered lobbying of this office</div>
      {lobby === null && (
        <div className="loading loading-inline">
          <span className="spinner" />
          Checking the visitor log…
        </div>
      )}
      {lobby && !l && (
        <p className="muted">
          No registered communications name {mpName} as the office holder contacted — or
          they’re filed under a different spelling in the Registry of Lobbyists.
        </p>
      )}
      {l && (
        <>
          <div className="fin-headline">
            <span className="fin-total">{l.total.toLocaleString('en-CA')}</span>
            <span className="fin-headline-meta">
              reported communication{l.total === 1 ? '' : 's'}
              {years.length ? ` since ${years[0]}` : ''}
            </span>
          </div>
          {trendYears.length > 1 && (
            <div className="margin-trend">
              {trendYears.map((y) => (
                <div
                  className="margin-col"
                  key={y}
                  title={`${y} — ${l.byYear[y]} communication${l.byYear[y] === 1 ? '' : 's'}`}
                >
                  <span className="margin-val">{l.byYear[y]}</span>
                  <div className="margin-bar">
                    <span
                      className="margin-fill"
                      style={{
                        height: `${Math.max((l.byYear[y] / maxYear) * 100, 5)}%`,
                        background: 'var(--indigo-500)',
                        display: 'block',
                      }}
                    />
                  </div>
                  <span className="margin-year">{y}</span>
                </div>
              ))}
            </div>
          )}
          {l.topClients.length > 0 && (
            <>
              <div className="microlabel">Most frequent clients</div>
              {l.topClients.map((c) => (
                <div className="result-row" key={c.client}>
                  <div className="result-name" title={c.client}>
                    {c.client}
                  </div>
                  <div className="result-track">
                    <span
                      className="result-fill"
                      style={{
                        width: `${(c.n / maxClient) * 100}%`,
                        background: 'var(--indigo-500)',
                        display: 'block',
                      }}
                    />
                  </div>
                  <div className="result-nums">
                    <b>{c.n}</b>
                  </div>
                </div>
              ))}
            </>
          )}
          {l.recent.length > 0 && (
            <>
              <div className="microlabel">Latest reports</div>
              {l.recent.map((c, i) => (
                <div className="list-row" key={i}>
                  <div className="list-row-body">
                    <div className="list-row-title">{c.client || '(client not stated)'}</div>
                    <div className="list-row-meta">
                      {fmtDate(c.date)}
                      {c.subjects.length ? ` · ${c.subjects.join(' · ')}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
          <p className="muted attribution">
            Oral and arranged communications from the{' '}
            <a href="https://lobbycanada.gc.ca/" target="_blank" rel="noreferrer">
              Registry of Lobbyists
            </a>{' '}
            naming this member as the office holder contacted (amended reports deduplicated;
            as published {lobby.built}). Registrants file by the 15th of the following month.
          </p>
        </>
      )}
    </div>
  );
}

const DEMO_ROWS = [
  ['population', 'Population, 2021', (v) => v.toLocaleString('en-CA')],
  ['avgAge', 'Average age', (v) => `${v.toFixed(1)} yrs`],
  ['medianHouseholdIncome', 'Median household income (2020)', fmtMoney],
  ['medianRent', 'Median rent', (v) => `${fmtMoney(v)}/mo`],
  ['immigrantsShare', 'Immigrants', (v) => `${v.toFixed(1)}%`],
  ['renterShare', 'Renter households', (v) => `${v.toFixed(1)}%`],
  ['bachelorsShare', 'Bachelor’s or higher, 25–64', (v) => `${v.toFixed(1)}%`],
  ['unemploymentRate', 'Unemployment (May 2021)', (v) => `${v.toFixed(1)}%`],
];

function DistrictCard({ riding, province, demo }) {
  return (
    <div className="card" id="district">
      <div className="card-title">District profile: {riding}</div>
      {demo === null && (
        <div className="loading loading-inline">
          <span className="spinner" />
          Pulling the census file…
        </div>
      )}
      {demo && !demo.values && (
        <p className="muted">
          No census profile under this riding’s name — StatCan profiles follow the 2023
          representation-order districts, so very new or renamed ridings may not match.
        </p>
      )}
      {demo?.values && (
        <>
          <div className="kv-grid demo-grid">
            {DEMO_ROWS.map(([key, label, fmt]) => {
              const v = demo.values[key];
              if (v == null) return null;
              return (
                <div className="kv" key={key}>
                  <div className="microlabel">{label}</div>
                  <div className="demo-value">{fmt(v)}</div>
                  {/* a riding's population vs a whole province's is noise, not scale */}
                  {key !== 'population' && (
                    <div className="demo-compare">
                      {demo.province?.[key] != null ? `${province || 'Province'} ${fmt(demo.province[key])}` : ''}
                      {demo.canada?.[key] != null
                        ? `${demo.province?.[key] != null ? ' · ' : ''}Canada ${fmt(demo.canada[key])}`
                        : ''}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="muted attribution">
            2021 Census Profile, Statistics Canada — districts under the 2023 representation
            order. Incomes are for 2020; the unemployment rate reflects the census reference
            week in May 2021.
          </p>
        </>
      )}
    </div>
  );
}

export default function Profile() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [elections, setElections] = useState(null);
  const [finance, setFinance] = useState(null);
  const [exp, setExp] = useState(null);
  const [demo, setDemo] = useState(null);
  const [eda, setEda] = useState(null);
  const [lobby, setLobby] = useState(null);

  useEffect(() => {
    setData(null);
    setErr(null);
    getJSON(`/api/mps/${slug}`).then(setData).catch((e) => setErr(e.message));
    window.scrollTo(0, 0);
  }, [slug]);

  useEffect(() => {
    setElections(null);
    const riding = data?.profile?.riding;
    if (!riding) return;
    let stale = false;
    getJSON(`/api/elections?riding=${encodeURIComponent(riding)}`)
      .then((d) => !stale && setElections(d.elections))
      .catch(() => !stale && setElections([]));
    return () => {
      stale = true;
    };
  }, [data]);

  useEffect(() => {
    setFinance(null);
    const p = data?.profile;
    if (!p?.riding) return;
    let stale = false;
    getJSON(`/api/finance?riding=${encodeURIComponent(p.riding)}&mp=${encodeURIComponent(p.name)}`)
      .then((d) => !stale && setFinance(d))
      .catch(() => !stale && setFinance({ events: [] }));
    return () => {
      stale = true;
    };
  }, [data]);

  useEffect(() => {
    setDemo(null);
    const riding = data?.profile?.riding;
    if (!riding) return;
    let stale = false;
    getJSON(`/api/demographics?riding=${encodeURIComponent(riding)}`)
      .then((d) => !stale && setDemo(d))
      .catch(() => !stale && setDemo({ values: null }));
    return () => {
      stale = true;
    };
  }, [data]);

  useEffect(() => {
    setEda(null);
    const riding = data?.profile?.riding;
    if (!riding) return;
    let stale = false;
    getJSON(`/api/eda?riding=${encodeURIComponent(riding)}`)
      .then((d) => !stale && setEda(d))
      .catch(() => !stale && setEda({ years: [] }));
    return () => {
      stale = true;
    };
  }, [data]);

  useEffect(() => {
    setLobby(null);
    const name = data?.profile?.name;
    if (!name) return;
    let stale = false;
    getJSON(`/api/lobbying?mp=${encodeURIComponent(name)}`)
      .then((d) => !stale && setLobby(d))
      .catch(() => !stale && setLobby({ lobbying: null }));
    return () => {
      stale = true;
    };
  }, [data]);

  // Expenditure quarters are fetched one at a time, newest first (each is its
  // own upstream CSV; sequential keeps the proxy polite and the card fills
  // progressively). Stop early once quarters stop matching the member — older
  // reports belong to their predecessor.
  useEffect(() => {
    setExp(null);
    const p = data?.profile;
    if (!p?.riding) return;
    let stale = false;
    (async () => {
      try {
        const list = await getJSON('/api/expenditures/quarters');
        const rows = [];
        let matched = false;
        let misses = 0;
        for (const qtr of list) {
          if (stale) return;
          const r = await getJSON(
            `/api/expenditures?fy=${qtr.fy}&q=${qtr.q}&riding=${encodeURIComponent(
              p.riding
            )}&mp=${encodeURIComponent(p.name)}`
          );
          rows.push(r);
          if (r.mine) {
            matched = true;
            misses = 0;
          } else if (matched && ++misses >= 2) break;
          else if (!matched && rows.length >= 6) break;
          if (!stale) setExp({ rows: [...rows], done: false });
        }
        if (!stale) setExp({ rows, done: true });
      } catch {
        if (!stale) setExp({ rows: [], done: true });
      }
    })();
    return () => {
      stale = true;
    };
  }, [data]);

  if (err) return <ErrorCard msg={err} />;
  if (!data) return <Loading label="Brewing this member's record…" />;

  const { profile: p, ballots, bills } = data;
  const pm = partyMeta(p.party);
  const sinceYear = p.mpSince ? p.mpSince.slice(0, 4) : '—';

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
    },
    {
      name: 'Campaign finance',
      desc: 'Full candidate and riding-association returns, Elections Canada',
      href: 'https://www.elections.ca/WPAPPS/WPF/EN/Home/Index',
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

      {p.riding && <ElectionsCard riding={p.riding} elections={elections} />}

      {p.riding && (
        <FinanceCard riding={p.riding} mpName={p.name} province={p.province} finance={finance} />
      )}

      {p.riding && <WarChestCard riding={p.riding} eda={eda} />}

      {p.riding && <ExpendituresCard mpName={p.name} exp={exp} />}

      {p.riding && <DistrictCard riding={p.riding} province={p.province} demo={demo} />}

      <LobbyingCard mpName={p.name} lobby={lobby} />

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
