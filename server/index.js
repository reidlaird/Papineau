// HonesTea API server.
// Proxies api.openparliament.ca and represent.opennorth.ca with a polite
// on-disk cache (both are volunteer/nonprofit services — every upstream
// response is cached for CACHE_TTL_MS), reshapes responses for the frontend,
// and serves the built client from /dist.

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, 'data', 'cache');
const DIST = path.join(ROOT, 'dist');

const OP_API = 'https://api.openparliament.ca';
const OP_WEB = 'https://openparliament.ca';
const REP_API = 'https://represent.opennorth.ca';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const USER_AGENT = `HonesTea/0.1 (personal local dashboard; ${process.env.HONESTEA_CONTACT || 'contact not configured'})`;

fs.mkdirSync(CACHE_DIR, { recursive: true });

const cachePath = (key) =>
  path.join(CACHE_DIR, crypto.createHash('sha1').update(key).digest('hex') + '.json');

// Disk-cached GET with 429/5xx retry — shared by both upstream APIs.
async function cachedGet(url) {
  const key = url.host + url.pathname + '?' + url.searchParams.toString();
  const file = cachePath(key);
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.data;
  } catch {
    // cache miss or unreadable entry — fall through to a live fetch
  }

  let res;
  for (let attempt = 1; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) break;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 4) {
      const err = new Error(`${url.host} returned ${res.status} for ${url.pathname}`);
      err.status = res.status;
      throw err;
    }
    const retryAfter = Number(res.headers.get('retry-after')) * 1000 || 1200 * attempt;
    await new Promise((r) => setTimeout(r, Math.min(retryAfter, 8000)));
  }
  const data = await res.json();
  fs.writeFileSync(file, JSON.stringify({ fetchedAt: Date.now(), key, data }));
  return data;
}

async function opFetch(pathname, params = {}) {
  const url = new URL(pathname, OP_API);
  url.searchParams.set('format', 'json');
  url.searchParams.set('version', 'v1');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return cachedGet(url);
}

// Follow next_url pagination until exhausted.
async function opFetchAll(pathname, params = {}, max = 1000) {
  const out = [];
  let next = { pathname, params: { limit: 100, ...params, offset: 0 } };
  while (next && out.length < max) {
    const page = await opFetch(next.pathname, next.params);
    out.push(...(page.objects || []));
    const nextUrl = page.pagination?.next_url;
    if (nextUrl) {
      const u = new URL(nextUrl, OP_API);
      next = { pathname: u.pathname, params: Object.fromEntries(u.searchParams) };
    } else {
      next = null;
    }
  }
  return out;
}

async function repFetch(pathname, params = {}) {
  const url = new URL(pathname, REP_API);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return cachedGet(url);
}

// Represent paginates with meta.next instead of pagination.next_url.
async function repFetchAll(pathname, params = {}, max = 1000) {
  const out = [];
  let next = { pathname, params: { limit: 100, ...params, offset: 0 } };
  while (next && out.length < max) {
    const page = await repFetch(next.pathname, next.params);
    out.push(...(page.objects || []));
    const nextUrl = page.meta?.next;
    if (nextUrl) {
      const u = new URL(nextUrl, REP_API);
      next = { pathname: u.pathname, params: Object.fromEntries(u.searchParams) };
    } else {
      next = null;
    }
  }
  return out;
}

// Memoize an async fn per key with the same TTL as the disk cache; stores the
// in-flight promise so concurrent callers share one upstream fetch chain.
function memoAsync(fn) {
  const store = new Map();
  return (key = '') => {
    const hit = store.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise;
    const entry = { at: Date.now(), promise: fn(key) };
    store.set(key, entry);
    entry.promise.catch(() => {
      if (store.get(key) === entry) store.delete(key);
    });
    return entry.promise;
  };
}

const slugFrom = (url) => (url || '').split('/').filter(Boolean).pop() || '';
const absImage = (p) => (p ? OP_WEB + p : null);
const first = (x) => (Array.isArray(x) ? x[0] : x) ?? null;

// Accent-fold + lowercase, for keyword matching.
const fold = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

// Stricter fold for matching riding/person names across data sources
// (em-dashes, apostrophes and punctuation vary between them).
const norm = (s) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();

const mapMp = (o) => ({
  slug: slugFrom(o.url),
  name: o.name || '',
  party: o.current_party?.short_name?.en || 'Independent',
  riding: o.current_riding?.name?.en || '',
  province: o.current_riding?.province || '',
  image: absImage(o.image),
});

const mapVote = (v) => ({
  session: v.session,
  number: v.number,
  date: v.date,
  description: v.description?.en || '',
  result: v.result,
  yea: v.yea_total ?? 0,
  nay: v.nay_total ?? 0,
  paired: v.paired_total ?? 0,
  billNumber: v.bill_url ? slugFrom(v.bill_url) : null,
  url: v.url ? OP_WEB + v.url : null,
});

const mapBill = (b) => ({
  number: b.number,
  session: b.session,
  name: b.name?.en || '',
  introduced: b.introduced || null,
  legisinfoId: b.legisinfo_id || null,
  url: b.url ? OP_WEB + b.url : null,
});

// ---------- memoized datasets ----------

const getMps = memoAsync(async () => {
  const objects = await opFetchAll('/politicians/');
  return objects.map(mapMp).sort((a, b) => a.name.localeCompare(b.name));
});

// All sitting MPs from Represent (Open North), indexed by the riding boundary
// they're attached to — the postal-code lookup resolves through boundaries.
const getHocReps = memoAsync(async () => {
  const reps = await repFetchAll('/representatives/house-of-commons/');
  return new Map(reps.map((r) => [r.related?.boundary_url, r]).filter(([k]) => k));
});

const getCurrentSession = memoAsync(async () => {
  const page = await opFetch('/votes/', { limit: 1 });
  return page.objects?.[0]?.session || '45-1';
});

const getSessionVotes = memoAsync(async (session) => {
  const objects = await opFetchAll('/votes/', { session });
  return objects
    .map(mapVote)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.number - a.number);
});

const getSessionBills = memoAsync(async (session) => {
  const objects = await opFetchAll('/bills/', { session });
  return objects.map(mapBill);
});

// Link a Represent MP record back to our openparliament MP (for slug/profile
// links); riding name first, person name as fallback. If neither matches,
// serve the Represent data directly with no profile link.
function toClientMp(rep, mps) {
  const byRiding = mps.find((m) => norm(m.riding) === norm(rep.district_name));
  const byName = byRiding || mps.find((m) => norm(m.name) === norm(rep.name));
  return (
    byName || {
      slug: null,
      name: rep.name,
      party: rep.party_name || '',
      riding: rep.district_name || '',
      province: '',
      image: rep.photo_url || null,
    }
  );
}

// ---------- issue search ----------

const STOPWORDS = new Set(
  (
    'the a an and or of to in on for at by with about into over under from ' +
    'act bill bills law vote votes voted voting motion reading amendment stage report concurrence ' +
    'i my me mine we our us you your this that these those it its is are was were be been being ' +
    'how what which who whom when where why do does did done not no ' +
    'want wants wanted look lookup see find issue issues topic bugging bug rep local member members mp mps ' +
    'canada canadian federal government house commons parliament'
  ).split(' ')
);

// Split a free-text query into bill-number tokens (c-5, s-210) and topic words.
function parseQuery(q) {
  const billTokens = [];
  const rest = fold(q).replace(/\b([cs])-?(\d{1,4})\b/g, (_, letter, num) => {
    billTokens.push(`${letter}-${num}`);
    return ' ';
  });
  const words = [
    ...new Set(rest.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w))),
  ];
  return { billTokens, words };
}

// ---------- routes ----------

const app = express();

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/mps', async (_req, res) => {
  try {
    res.json(await getMps());
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

app.get('/api/mps/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'bad slug' });

    const [detail, ballotsPage, billsPage] = await Promise.all([
      opFetch(`/politicians/${slug}/`),
      opFetch('/votes/ballots/', { politician: slug, limit: 8 }),
      opFetch('/bills/', { sponsor_politician: slug, limit: 10 }),
    ]);

    // Each ballot only carries a vote_url; pull the vote itself for context.
    // Sequential on purpose — a parallel burst trips upstream rate limits, and
    // vote details land in the disk cache so this is only slow once per vote.
    const ballots = [];
    for (const b of ballotsPage.objects || []) {
      try {
        const v = await opFetch(b.vote_url);
        ballots.push({ ballot: b.ballot, ...mapVote(v) });
      } catch (e) {
        console.warn(`vote enrichment failed: ${e.message}`);
        ballots.push({ ballot: b.ballot, description: 'Vote details unavailable', result: '' });
      }
    }

    const memberships = (detail.memberships || [])
      .map((m) => ({
        start: m.start_date,
        end: m.end_date,
        label: m.label?.en || '',
        party: m.party?.short_name?.en || '',
        riding: m.riding?.name?.en || '',
        province: m.riding?.province || '',
      }))
      .sort((a, b) => (b.start || '').localeCompare(a.start || ''));

    const current = memberships.find((m) => !m.end) || memberships[0] || {};
    const oi = detail.other_info || {};

    res.json({
      profile: {
        slug,
        name: detail.name || '',
        gender: detail.gender || null,
        email: detail.email || null,
        voice: detail.voice || null,
        image: absImage(detail.image),
        party: current.party || 'Independent',
        riding: current.riding || '',
        province: current.province || '',
        mpSince: memberships.length ? memberships[memberships.length - 1].start : null,
        isCurrent: memberships.some((m) => !m.end),
        twitter: first(oi.twitter),
        favouriteWord: first(oi.favourite_word),
        constituencyOffices: oi.constituency_offices || [],
        parlMpId: first(oi.parl_mp_id),
        wikipediaId: first(oi.wikipedia_id),
        memberships,
      },
      ballots,
      bills: (billsPage.objects || []).map(mapBill),
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

app.get('/api/votes', async (_req, res) => {
  try {
    const page = await opFetch('/votes/', { limit: 20 });
    res.json((page.objects || []).map(mapVote));
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

app.get('/api/bills', async (_req, res) => {
  try {
    const page = await opFetch('/bills/', { limit: 20 });
    res.json((page.objects || []).map(mapBill));
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// Postal code → your riding + MP, plus the members in adjacent ridings.
// Resolution runs through Represent (Open North): postcode → federal boundary
// (concordance beats centroid when both exist), boundary → MP, and the
// `touches` filter gives geographically neighbouring ridings.
app.get('/api/rep/:postcode', async (req, res) => {
  try {
    const code = String(req.params.postcode).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(code)) {
      return res
        .status(400)
        .json({ error: 'That doesn’t look like a Canadian postal code (format A1A 1A1).' });
    }

    let pc;
    try {
      pc = await repFetch(`/postcodes/${code}/`);
    } catch (e) {
      if (e.status === 404) {
        return res
          .status(404)
          .json({ error: `Postal code ${code} isn’t in the riding lookup database.` });
      }
      throw e;
    }

    const [repsByBoundary, mps] = await Promise.all([getHocReps(), getMps()]);

    // A postal code can span several federal ridings — the concordance file
    // lists them all; centroid is the geometric fallback. Several historical
    // representation orders share the "Federal electoral district" set name,
    // so keep only boundaries that a sitting MP is actually attached to.
    const candidates = [
      ...(pc.boundaries_concordance || []),
      ...(pc.boundaries_centroid || []),
    ].filter((b) => b.boundary_set_name === 'Federal electoral district' && repsByBoundary.has(b.url));
    if (!candidates.length) {
      return res
        .status(404)
        .json({ error: 'Couldn’t place that postal code in a current federal riding.' });
    }

    const primary = candidates[0];
    const [, setSlug, extId] = primary.url.split('/').filter(Boolean); // boundaries/<set>/<id>
    let touching = [];
    try {
      touching = await repFetchAll(`/boundaries/${setSlug}/`, { touches: `${setSlug}/${extId}` });
    } catch (e) {
      console.warn(`neighbour lookup failed: ${e.message}`); // still return the primary rep
    }

    const seen = new Set([primary.url]);
    const neighbours = [];
    for (const b of [...candidates.slice(1), ...touching]) {
      if (seen.has(b.url)) continue;
      seen.add(b.url);
      const rep = repsByBoundary.get(b.url);
      neighbours.push({
        riding: b.name,
        alsoYours: candidates.some((c) => c.url === b.url),
        mp: rep ? toClientMp(rep, mps) : null, // null = vacant seat
      });
    }

    res.json({
      postcode: code.slice(0, 3) + ' ' + code.slice(3),
      city: pc.city || '',
      province: pc.province || '',
      riding: primary.name,
      mp: toClientMp(repsByBoundary.get(primary.url), mps),
      neighbours,
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// Keyword search over the current session's divisions and bills.
// Vote descriptions are searched together with the name of the bill they
// concern, so "housing" finds readings of a housing bill even when the
// division description alone wouldn't say so.
app.get('/api/issues/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').slice(0, 200).trim();
    if (!q) return res.status(400).json({ error: 'Give me an issue to look for.' });
    const { billTokens, words } = parseQuery(q);
    if (!billTokens.length && !words.length) {
      return res.status(400).json({
        error: 'Try a more specific keyword — e.g. “housing”, “carbon tax”, or a bill number like C-5.',
      });
    }

    const session = await getCurrentSession();
    const [votes, bills] = await Promise.all([getSessionVotes(session), getSessionBills(session)]);
    const billNameByNumber = new Map(bills.map((b) => [String(b.number).toLowerCase(), b.name]));

    // Bill tokens match the linked bill number OR the description text (many
    // divisions are procedural motions that only name the bill in prose);
    // word-boundary regex so "c-2" can't substring-match "c-26".
    const billRes = billTokens.map((t) => new RegExp(`\\b${t}\\b`));
    const matches = (hay, billNumber, requireAll) =>
      (billNumber && billTokens.includes(billNumber)) ||
      billRes.some((re) => re.test(hay)) ||
      (words.length > 0 &&
        (requireAll ? words.every((w) => hay.includes(w)) : words.some((w) => hay.includes(w))));

    const voteHay = (v) =>
      fold(
        `${v.description} ${v.billNumber || ''} ${
          (v.billNumber && billNameByNumber.get(v.billNumber.toLowerCase())) || ''
        }`
      );
    const voteBillNo = (v) => (v.billNumber ? v.billNumber.toLowerCase() : null);

    // All topic words must hit; if that finds nothing, relax to any-word.
    let relaxed = false;
    let hitVotes = votes.filter((v) => matches(voteHay(v), voteBillNo(v), true));
    if (!hitVotes.length && words.length > 1) {
      relaxed = true;
      hitVotes = votes.filter((v) => matches(voteHay(v), voteBillNo(v), false));
    }
    const hitBills = bills.filter((b) =>
      matches(fold(`${b.number} ${b.name}`), String(b.number).toLowerCase(), !relaxed)
    );

    res.json({
      session,
      query: q,
      words,
      billTokens,
      relaxed,
      totalVotes: hitVotes.length,
      votes: hitVotes.slice(0, 60).map((v) => ({
        ...v,
        billName: (v.billNumber && billNameByNumber.get(v.billNumber.toLowerCase())) || null,
      })),
      totalBills: hitBills.length,
      bills: hitBills.slice(0, 20),
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// Every MP's ballot on one division, keyed by politician slug. One upstream
// request per division (limit 500 covers the whole House), so the client can
// safely request these one at a time while filling a comparison table.
app.get('/api/vote-ballots', async (req, res) => {
  try {
    const vote = String(req.query.vote || '');
    if (!/^\d{2}-\d\/\d{1,4}$/.test(vote)) {
      return res.status(400).json({ error: 'bad vote id (expected e.g. 45-1/173)' });
    }
    const objects = await opFetchAll('/votes/ballots/', { vote: `/votes/${vote}/`, limit: 500 }, 2000);
    const ballots = {};
    for (const b of objects) ballots[slugFrom(b.politician_url)] = b.ballot;
    res.json({ vote, count: objects.length, ballots });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// Built frontend + SPA fallback.
app.use(express.static(DIST));
app.use((req, res, next) => {
  const index = path.join(DIST, 'index.html');
  if (req.method === 'GET' && !req.path.startsWith('/api') && fs.existsSync(index)) {
    return res.sendFile(index);
  }
  next();
});

const PORT = process.env.PORT || 3020;
app.listen(PORT, () => console.log(`HonesTea serving on http://localhost:${PORT}`));
