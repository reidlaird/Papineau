// HonesTea API server.
// Proxies api.openparliament.ca with a polite on-disk cache (their API is a
// volunteer-run service — every upstream response is cached for CACHE_TTL_MS),
// reshapes responses for the frontend, and serves the built client from /dist.

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
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const USER_AGENT = `HonesTea/0.1 (personal local dashboard; ${process.env.HONESTEA_CONTACT || 'contact not configured'})`;

fs.mkdirSync(CACHE_DIR, { recursive: true });

const cachePath = (key) =>
  path.join(CACHE_DIR, crypto.createHash('sha1').update(key).digest('hex') + '.json');

async function opFetch(pathname, params = {}) {
  const url = new URL(pathname, OP_API);
  url.searchParams.set('format', 'json');
  url.searchParams.set('version', 'v1');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const key = url.pathname + '?' + url.searchParams.toString();

  const file = cachePath(key);
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.data;
  } catch {
    // cache miss or unreadable entry — fall through to a live fetch
  }

  // The upstream API rate-limits bursts, so retry 429/5xx with backoff.
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
      throw new Error(`openparliament.ca returned ${res.status} for ${key}`);
    }
    const retryAfter = Number(res.headers.get('retry-after')) * 1000 || 1200 * attempt;
    await new Promise((r) => setTimeout(r, Math.min(retryAfter, 8000)));
  }
  const data = await res.json();
  fs.writeFileSync(file, JSON.stringify({ fetchedAt: Date.now(), key, data }));
  return data;
}

// Follow next_url pagination until exhausted.
async function opFetchAll(pathname, params = {}, max = 1000) {
  const out = [];
  let next = { pathname, params: { ...params, limit: 100, offset: 0 } };
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

const slugFrom = (url) => (url || '').split('/').filter(Boolean).pop() || '';
const absImage = (p) => (p ? OP_WEB + p : null);
const first = (x) => (Array.isArray(x) ? x[0] : x) ?? null;

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

const app = express();

let mpsMemo = { at: 0, data: null };

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/mps', async (_req, res) => {
  try {
    if (!mpsMemo.data || Date.now() - mpsMemo.at > CACHE_TTL_MS) {
      const objects = await opFetchAll('/politicians/');
      mpsMemo = {
        at: Date.now(),
        data: objects.map(mapMp).sort((a, b) => a.name.localeCompare(b.name)),
      };
    }
    res.json(mpsMemo.data);
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
