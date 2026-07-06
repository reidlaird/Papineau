export function Loading({ label = 'Steeping…' }) {
  return (
    <div className="page">
      <div className="loading">
        <span className="spinner" />
        {label}
      </div>
    </div>
  );
}

export function ErrorCard({ msg }) {
  return (
    <div className="page">
      <div className="card error-card">
        <div className="card-title">Couldn't fetch that</div>
        <p>{msg}</p>
        <p className="muted">
          Data comes live from openparliament.ca — check your connection, or the upstream API may be
          briefly unavailable.
        </p>
      </div>
    </div>
  );
}

export function VoteBar({ yea, nay, paired }) {
  const total = (yea || 0) + (nay || 0);
  if (!total) return null;
  const title = `Yea ${yea} · Nay ${nay}` + (paired ? ` · Paired ${paired}` : '');
  return (
    <div className="votebar" title={title}>
      <span className="votebar-yea" style={{ flexGrow: yea || 0.001 }} />
      <span className="votebar-nay" style={{ flexGrow: nay || 0.001 }} />
    </div>
  );
}

export const fmtDate = (d) =>
  d
    ? new Date(d + 'T00:00:00').toLocaleDateString('en-CA', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : '';
