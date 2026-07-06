// Tiny fetch wrapper with in-memory promise cache, so route changes
// don't re-hit the server for data we already have this session.
const cache = new Map();

export function getJSON(url) {
  if (cache.has(url)) return cache.get(url);
  const p = fetch(url).then(async (r) => {
    if (!r.ok) {
      let msg = `Request failed (${r.status})`;
      try {
        msg = (await r.json()).error || msg;
      } catch {
        // non-JSON error body — keep the status message
      }
      throw new Error(msg);
    }
    return r.json();
  });
  cache.set(url, p);
  p.catch(() => cache.delete(url));
  return p;
}
