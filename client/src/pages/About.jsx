export default function About() {
  const rows = [
    ['MP directory & profiles', 'OpenParliament.ca API', 'live'],
    ['Voting record', 'OpenParliament.ca (House roll-calls)', 'live'],
    ['Bills', 'OpenParliament.ca · LEGISinfo links', 'live'],
    ['My rep — riding lookup & vote comparison', 'Represent API (Open North) + OpenParliament', 'live'],
    ['Campaign finance', 'Elections Canada political financing database', 'live'],
    ['Ethics & disclosures', 'Conflict of Interest and Ethics Commissioner registry', 'planned'],
    ['Lobbying activity', 'Registry of Lobbyists (open data)', 'planned'],
    ['Members’ expenditures', 'House of Commons proactive disclosure', 'live'],
    ['Riding demographics', 'Statistics Canada census profiles', 'live'],
    ['Election results & margins', 'Elections Canada official results (2015–2025)', 'live'],
  ];

  return (
    <div className="page">
      <header className="page-header">
        <h1>About HonesTea</h1>
        <p className="page-sub">Spilling the tea on Canadian politics — from public records only.</p>
      </header>

      <div className="card">
        <div className="card-title">What this is</div>
        <p>
          One place to see what a Member of Parliament actually does: how they vote, what they
          sponsor, how their campaigns are financed, and what they disclose. Inspired by{' '}
          <em>Article One</em>, a US congressional-records app — HonesTea is the Canadian steep.
        </p>
      </div>

      <div className="card">
        <div className="card-title">Where the data comes from</div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Section</th>
              <th>Source</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([section, source, status]) => (
              <tr key={section}>
                <td>{section}</td>
                <td>{source}</td>
                <td>
                  <span className={status === 'live' ? 'tag-live' : 'tag-soon'}>{status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">
          Live data is served through a caching proxy (6-hour TTL) to keep traffic to the
          volunteer-run openparliament.ca API minimal. Parliamentary data © House of Commons,
          made usable by openparliament.ca. Postal-code riding lookup and riding adjacency come
          from the Represent API by Open North. Election results are Elections Canada official
          voting results (Table 12), cached for 30 days.
        </p>
      </div>
    </div>
  );
}
