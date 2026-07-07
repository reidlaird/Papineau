// HonesTea API server.
// Proxies api.openparliament.ca and represent.opennorth.ca with a polite
// on-disk cache (both are volunteer/nonprofit services — every upstream
// response is cached for CACHE_TTL_MS), reshapes responses for the frontend,
// and serves the built client from /dist.

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
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

// Disk-cached GET with 429/5xx retry — shared by all upstream sources.
// opts.text returns the raw body instead of parsed JSON; opts.ttl overrides
// the default TTL (election results are final — cache them for weeks).
async function cachedGet(url, opts = {}) {
  const ttl = opts.ttl ?? CACHE_TTL_MS;
  const key = url.host + url.pathname + '?' + url.searchParams.toString();
  const file = cachePath(key);
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - cached.fetchedAt < ttl) return cached.data;
  } catch {
    // cache miss or unreadable entry — fall through to a live fetch
  }

  let res;
  for (let attempt = 1; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      // Accept-Language must be explicit: undici's default "*" 500s StatCan's
      // SDMX service (its language-tag parser rejects the literal wildcard).
      res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
        signal: controller.signal,
      });
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
  const data = opts.text ? await res.text() : await res.json();
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

// ---------- elections (Elections Canada official voting results) ----------
// Table 12 of the official results: one row per candidate per riding, with
// votes, share, and the winner's majority. Format is identical for the last
// four general elections; results are final, so they cache for 30 days.

const ELECTIONS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EC = 'https://www.elections.ca/res/rep/off';
const ELECTIONS = [
  { ge: 45, date: '2025-04-28', csv: `${EC}/ovrGE45/62/data_donnees/table_tableau12.csv` },
  { ge: 44, date: '2021-09-20', csv: `${EC}/ovr2021app/53/data_donnees/table_tableau12.csv` },
  { ge: 43, date: '2019-10-21', csv: `${EC}/ovr2019app/51/data_donnees/table_tableau12.csv` },
  { ge: 42, date: '2015-10-19', csv: `${EC}/ovr2015app/41/data_donnees/table_tableau12.csv` },
];

// Affiliations seen in tables 2015–2025, folded, longest first. The Candidate
// column jams "First Last <PartyEN>/<PartyFR>" into one string, so the party
// is recovered by suffix match; anything unlisted lands in "Other".
const EC_AFFILIATIONS = [
  ['ndp-new democratic party', 'NDP'],
  ["people's party - ppc", 'PPC'],
  ["people's party", 'PPC'], // 2019 table writes it without the "- PPC" suffix
  ['bloc quebecois', 'Bloc Québécois'],
  ['green party', 'Green'],
  ['liberal', 'Liberal'],
  ['conservative', 'Conservative'],
  ['independent', 'Independent'],
  ['no affiliation', 'No affiliation'],
  ['christian heritage party', 'Christian Heritage'],
  ['free party canada', 'Free Party'],
  ['libertarian', 'Libertarian'],
  ['marxist-leninist', 'Marxist–Leninist'],
  ['communist', 'Communist'],
  ['animal protection party', 'Animal Protection'],
  ['parti rhinoceros party', 'Rhinoceros'],
  ['rhinoceros', 'Rhinoceros'],
  ['maverick party', 'Maverick'],
  ['veterans coalition party of canada', 'Veterans Coalition'],
  ['canadian nationalist party', 'Nationalist'],
  ['national citizens alliance', 'Citizens Alliance'],
  ["parti pour l'independance du quebec", 'Indép. du Québec'],
  ['united party of canada (up)', 'United'],
  ['united party of canada', 'United'],
  ['canadian future party', 'Canadian Future'],
  ['progressive canadian party', 'Progressive Canadian'],
  ['pc party', 'Progressive Canadian'],
  ['marijuana party', 'Marijuana'],
  ['radical marijuana', 'Radical Marijuana'],
  ['strength in democracy', 'Strength in Democracy'],
  ['forces et democratie', 'Strength in Democracy'],
].sort((a, b) => b[0].length - a[0].length);

// Minimal RFC-4180 parser — quoted fields, escaped quotes, CRLF.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

// "Ken McDonald ** Liberal/Libéral" → { name, party, incumbent }.
// ** marks the incumbent (member at dissolution), not the winner.
function parseCandidate(raw) {
  const enSide = String(raw).split('/')[0].trim();
  const incumbent = enSide.includes('**');
  const s = enSide.replace(/\*\*/g, ' ').replace(/\s+/g, ' ').trim();
  const folded = fold(s).replace(/[’‘]/g, "'");
  for (const [suffix, party] of EC_AFFILIATIONS) {
    if (folded.endsWith(suffix)) {
      const name = s.slice(0, s.length - suffix.length).trim();
      if (name) return { name, party, incumbent };
    }
  }
  return { name: s, party: 'Other', incumbent };
}

// The EN half of a bilingual "English/Français" cell (most riding names are
// identical in both languages and carry no slash).
const enHalf = (s) => String(s || '').split('/')[0].trim();

function buildElection(csvText) {
  const byNorm = new Map();
  const text = csvText.charCodeAt(0) === 0xfeff ? csvText.slice(1) : csvText; // strip BOM
  for (const r of parseCsv(text).slice(1)) {
    if (r.length < 8) continue;
    const [provinceRaw, nameRaw, numberRaw, candidateRaw, , , votesRaw, pctRaw, majorityRaw] = r;
    const number = parseInt(numberRaw, 10);
    if (!Number.isFinite(number)) continue;
    const name = enHalf(nameRaw);
    const key = norm(name);
    let riding = byNorm.get(key);
    if (!riding) {
      riding = { name, number, province: enHalf(provinceRaw), candidates: [], totalVotes: 0 };
      byNorm.set(key, riding);
    }
    const votes = parseInt(String(votesRaw).replace(/[^\d]/g, ''), 10) || 0;
    riding.candidates.push({
      ...parseCandidate(candidateRaw),
      votes,
      share: parseFloat(pctRaw) || 0,
      elected: String(majorityRaw || '').trim() !== '',
    });
    riding.totalVotes += votes;
  }
  for (const riding of byNorm.values()) {
    riding.candidates.sort((a, b) => b.votes - a.votes);
    // A tie or data gap can leave the majority column empty — top votes wins.
    if (!riding.candidates.some((c) => c.elected) && riding.candidates[0]) {
      riding.candidates[0].elected = true;
    }
    const [winner, runnerUp] = riding.candidates;
    riding.margin = winner && runnerUp ? +(winner.share - runnerUp.share).toFixed(1) : null;
  }
  return byNorm;
}

// All four elections, fetched sequentially (be polite) and indexed by
// normalized riding name. One in-memory copy serves every request.
const getElectionData = memoAsync(async () => {
  const out = [];
  for (const { ge, date, csv } of ELECTIONS) {
    const text = await cachedGet(new URL(csv), { text: true, ttl: ELECTIONS_TTL_MS });
    const byNorm = buildElection(text);
    // Table 11 (same directory) adds electors and turnout per district; the
    // column layout is identical 2015–2025. Enhancement only — an election
    // still renders if this table is missing.
    try {
      const t11 = await cachedGet(new URL(csv.replace('table_tableau12', 'table_tableau11')), {
        text: true,
        ttl: ELECTIONS_TTL_MS,
      });
      const clean = t11.charCodeAt(0) === 0xfeff ? t11.slice(1) : t11;
      for (const r of parseCsv(clean).slice(1)) {
        if (r.length < 12) continue;
        const hit = byNorm.get(norm(enHalf(r[1])));
        if (!hit) continue;
        hit.electors = parseInt(String(r[4]).replace(/[^\d]/g, ''), 10) || null;
        hit.turnout = parseFloat(r[11]) || null;
      }
    } catch (e) {
      console.warn(`turnout table unavailable for GE${ge}: ${e.message}`);
    }
    out.push({ ge, date, byNorm });
  }
  return out;
});

// ---------- campaign finance (Elections Canada audited contributions) ----------
// Per-campaign aggregates precomputed by scripts/build-finance.mjs from the
// 2.2 GB contributions open-data dump and committed at data/finance/ — this
// process only gunzips ~1 file at boot. Amounts are the itemized
// contributions campaigns reported (gifts over $200 must be itemized;
// smaller ones only appear when a campaign itemized them anyway).

const FINANCE_PATH = path.join(ROOT, 'data', 'finance', 'candidate-contributions.json.gz');
const EDA_PATH = path.join(ROOT, 'data', 'finance', 'eda-contributions.json.gz');

const getFinanceData = memoAsync(async () =>
  JSON.parse(zlib.gunzipSync(await fs.promises.readFile(FINANCE_PATH)).toString('utf8'))
);

const getEdaData = memoAsync(async () =>
  JSON.parse(zlib.gunzipSync(await fs.promises.readFile(EDA_PATH)).toString('utf8'))
);

// Registry of Lobbyists communications naming House-of-Commons DPOHs, keyed
// by normalized member name (see scripts/build-lobbying.mjs for the filter
// and amendment-dedupe rules).
const LOBBY_PATH = path.join(ROOT, 'data', 'lobbying', 'mp-communications.json.gz');

const getLobbyData = memoAsync(async () =>
  JSON.parse(zlib.gunzipSync(await fs.promises.readFile(LOBBY_PATH)).toString('utf8'))
);

// Ethics declarations from the Conflict of Interest and Ethics Commissioner's
// public registry, keyed by normalized declarant name. The registry has no
// bulk export, so scripts/build-ethics.mjs scrapes the public search pages;
// until its first successful run the artifact simply doesn't exist and the
// route answers pending: true (the card shows a registry deep link instead).
const ETHICS_PATH = path.join(ROOT, 'data', 'ethics', 'mp-declarations.json.gz');

const getEthicsData = memoAsync(async () =>
  JSON.parse(zlib.gunzipSync(await fs.promises.readFile(ETHICS_PATH)).toString('utf8'))
);

// Find the profile MP among a riding's campaigns. Exact normalized match
// first; middle names/initials differ between EC and openparliament, so fall
// back to same last name + compatible first token.
function matchCampaign(campaigns, mpName) {
  const target = norm(mpName);
  const exact = campaigns.find((c) => norm(c.name) === target);
  if (exact) return exact;
  const t = target.split(' ');
  if (t.length < 2) return null;
  const [tFirst, tLast] = [t[0], t[t.length - 1]];
  return (
    campaigns.find((c) => {
      const p = norm(c.name).split(' ');
      const [pFirst, pLast] = [p[0], p[p.length - 1]];
      return pLast === tLast && (pFirst.startsWith(tFirst) || tFirst.startsWith(pFirst));
    }) || null
  );
}

// ---------- members' expenditures (House of Commons proactive disclosure) ----------
// Quarterly Members' Expenditures Reports: per-member Salaries / Travel /
// Hospitality / Contracts. The landing page links every quarter as
// members/<fyEnd>/<q>?summaryId=<id>, but the CSV route wants a *different*
// per-report GUID that only appears on the quarter's own page (feeding it the
// summaryId returns 500) — so: landing → quarter page → csv, all disk-cached.
// Published quarters are final; new ones land ~3 months after quarter end.

const OC_WEB = 'https://www.ourcommons.ca';
const EXP_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EXP_LIST_TTL_MS = 24 * 60 * 60 * 1000; // new quarters appear ~4×/year

const getExpQuarters = memoAsync(async () => {
  const html = await cachedGet(new URL('/proactivedisclosure/en/members', OC_WEB), {
    text: true,
    ttl: EXP_LIST_TTL_MS,
  });
  const seen = new Map();
  for (const m of html.matchAll(
    /href="\/proactivedisclosure\/en\/members\/(\d{4})\/(\d)\?summaryId=([0-9a-f-]{36})"/g
  )) {
    seen.set(`${m[1]}-${m[2]}`, { fy: +m[1], q: +m[2], summaryId: m[3] });
  }
  return [...seen.values()].sort((a, b) => b.fy - a.fy || b.q - a.q);
});

// "Angus,  Charlie" / "Alghabra, Hon. Omar" → "Charlie Angus" / "Omar
// Alghabra"; comma-less rows ("Vacant") pass through unchanged.
function flipMemberName(raw) {
  const i = raw.indexOf(',');
  if (i < 0) return raw.trim();
  const first = raw
    .slice(i + 1)
    .replace(/\b(right\s+)?hon\.?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${first} ${raw.slice(0, i).trim()}`.trim();
}

const getExpQuarter = memoAsync(async (key) => {
  const [fy, q, summaryId] = key.split('|');
  const page = await cachedGet(
    new URL(`/proactivedisclosure/en/members/${fy}/${q}?summaryId=${summaryId}`, OC_WEB),
    { text: true, ttl: EXP_TTL_MS }
  );
  const csvLink = /href="\/proactivedisclosure\/en\/members\/([0-9a-f-]{36})\/csv"/.exec(page);
  if (!csvLink) throw new Error(`no csv link on expenditures page FY${fy} Q${q}`);
  const csv = await cachedGet(
    new URL(`/proactivedisclosure/en/members/${csvLink[1]}/csv`, OC_WEB),
    { text: true, ttl: EXP_TTL_MS }
  );
  const num = (s) => {
    const v = parseFloat(String(s).replace(/[$,]/g, ''));
    return Number.isFinite(v) ? v : 0;
  };
  const text = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
  return parseCsv(text)
    .slice(1)
    .filter((r) => r.length >= 7)
    .map((r) => {
      const [salaries, travel, hospitality, contracts] = [num(r[3]), num(r[4]), num(r[5]), num(r[6])];
      return {
        name: flipMemberName(r[0]),
        vacant: fold(r[0]).startsWith('vacant'),
        riding: r[1].trim(),
        caucus: r[2].trim(),
        salaries,
        travel,
        hospitality,
        contracts,
        total: salaries + travel + hospitality + contracts,
      };
    });
});

// ---------- riding demographics (StatCan 2021 Census Profile) ----------
// SDMX web data service: one small CSV per geography per request. FED
// profiles use the 2023 representation order (dguid 2023A0004 + FED code);
// the Population-and-dwellings block (chars 1–7) was never re-released for
// those districts, so population comes from the age-table total (char 8).
// Canada and the provinces ride the DF_PR flow for comparators.

const CENSUS_API = 'https://api.statcan.gc.ca/census-recensement/profile/sdmx/rest/data';
const CENSUS_TTL_MS = 90 * 24 * 60 * 60 * 1000; // census data never moves
const CENSUS_CHARS = [
  { key: 'population', id: 8, stat: 1 },
  { key: 'avgAge', id: 39, stat: 1 },
  { key: 'medianHouseholdIncome', id: 229, stat: 1 },
  { key: 'immigrantsShare', id: 1515, stat: 4 },
  { key: 'renterShare', id: 1402, stat: 4 },
  { key: 'medianRent', id: 1480, stat: 1 },
  { key: 'bachelorsShare', id: 2024, stat: 4 }, // 25–64 cohort
  { key: 'unemploymentRate', id: 2230, stat: 4 }, // census reference week, May 2021
];

// Riding name → 5-digit FED code via the boundary set sitting MPs attach to.
// The unsuffixed federal-electoral-districts set is the OLD 2013 order (338
// districts) — don't use it.
const getFedCodes = memoAsync(async () => {
  const rows = await repFetchAll(
    '/boundaries/federal-electoral-districts-2023-representation-order/'
  );
  return new Map(rows.map((b) => [norm(b.name), b.external_id]));
});

async function censusProfile(flow, dguid) {
  const ids = CENSUS_CHARS.map((c) => c.id).join('+');
  const url = new URL(`${CENSUS_API}/STC_CP,${flow}/A5.${dguid}.1.${ids}.`);
  url.searchParams.set('format', 'csv');
  const csv = await cachedGet(url, { text: true, ttl: CENSUS_TTL_MS });
  const byChar = new Map();
  for (const row of parseCsv(csv).slice(1)) {
    if (row.length < 8 || row[7] === '') continue;
    const id = parseInt(row[4], 10);
    if (!byChar.has(id)) byChar.set(id, {});
    byChar.get(id)[row[5]] = parseFloat(row[7]);
  }
  const out = {};
  for (const { key, id, stat } of CENSUS_CHARS) {
    const v = byChar.get(id)?.[stat];
    out[key] = Number.isFinite(v) ? v : null;
  }
  return out;
}

const getCensusCanada = memoAsync(() => censusProfile('DF_PR', '2021A000011124'));
const getCensusProvince = memoAsync((code) => censusProfile('DF_PR', `2021A0002${code}`));

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

// Current session only — the unfiltered upstream list leads with every
// session's ceremonial Bill C-1, which reads as one bill repeated 20 times.
app.get('/api/bills', async (_req, res) => {
  try {
    const session = await getCurrentSession();
    const bills = await getSessionBills(session);
    const sorted = [...bills].sort((a, b) =>
      (b.introduced || '').localeCompare(a.introduced || '')
    );
    res.json(sorted.slice(0, 25));
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// Riding history across the last four general elections, matched by
// normalized riding name (boundaries and names shift between representation
// orders — a riding that didn't exist under a given order simply has no
// entry for that election).
app.get('/api/elections', async (req, res) => {
  try {
    const riding = String(req.query.riding || '').slice(0, 200).trim();
    if (!riding) return res.status(400).json({ error: 'riding required' });
    const key = norm(riding);
    const data = await getElectionData();
    const elections = [];
    for (const { ge, date, byNorm } of data) {
      const hit = byNorm.get(key);
      if (hit) elections.push({ ge, date, ...hit });
    }
    res.json({ riding, elections });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// Campaign finance for a riding: per electoral event, every candidate
// campaign's reported contributions, with the profile MP's own campaign
// singled out when a name match lands. Riding-scoped like /api/elections —
// an MP who ran elsewhere earlier simply won't match in those events.
app.get('/api/finance', async (req, res) => {
  try {
    const riding = String(req.query.riding || '').slice(0, 200).trim();
    const mp = String(req.query.mp || '').slice(0, 200).trim();
    if (!riding) return res.status(400).json({ error: 'riding required' });
    const data = await getFinanceData();
    const hit = data.ridings[norm(riding)];
    if (!hit) return res.json({ riding, bucketEdges: data.bucketEdges, events: [] });

    const byEvent = new Map();
    for (const c of hit.campaigns) {
      if (!byEvent.has(c.event)) byEvent.set(c.event, []);
      byEvent.get(c.event).push(c);
    }
    const events = [...byEvent.entries()]
      .map(([ei, campaigns]) => {
        const total = (c) => c.monetary + c.nonMonetary;
        const mine = mp ? matchCampaign(campaigns, mp) : null;
        return {
          ...data.events[ei],
          candidates: campaigns.length,
          fieldMonetary: campaigns.reduce((s, c) => s + c.monetary, 0),
          fieldNonMonetary: campaigns.reduce((s, c) => s + c.nonMonetary, 0),
          fieldCount: campaigns.reduce((s, c) => s + c.count, 0),
          top: [...campaigns]
            .sort((a, b) => total(b) - total(a))
            .slice(0, 3)
            .map((c) => ({ name: c.name, party: c.party, total: total(c), mine: c === mine })),
          mine,
        };
      })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    res.json({ riding: hit.name, bucketEdges: data.bucketEdges, built: data.built, events });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// Riding-association (EDA) fundraising by fiscal year — the war chest built
// between elections. Same offline-artifact pattern as /api/finance; the
// artifact is per riding per year, one row per association.
app.get('/api/eda', async (req, res) => {
  try {
    const riding = String(req.query.riding || '').slice(0, 200).trim();
    if (!riding) return res.status(400).json({ error: 'riding required' });
    const data = await getEdaData();
    const hit = data.ridings[norm(riding)];
    if (!hit) return res.json({ riding, built: data.built, years: [] });
    const years = Object.entries(hit.years)
      .map(([year, assocs]) => ({
        year: +year,
        total: assocs.reduce((s, a) => s + a.monetary + a.nonMonetary, 0),
        assocs,
      }))
      .sort((a, b) => b.year - a.year);
    res.json({ riding: hit.name, built: data.built, years });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// Registered lobbying of this member: oral & arranged communications from
// the Registry of Lobbyists where the member appears as the office holder
// contacted. Exact normalized-name hit first, then the same first/last
// fallback the finance match uses ("Rob" vs "Robert" etc.).
app.get('/api/lobbying', async (req, res) => {
  try {
    const mp = String(req.query.mp || '').slice(0, 200).trim();
    if (!mp) return res.status(400).json({ error: 'mp required' });
    const data = await getLobbyData();
    const lobbying =
      data.dpoh[norm(mp)] || matchCampaign(Object.values(data.dpoh), mp) || null;
    res.json({ mp, built: data.built, lobbying });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// Ethics declarations naming this member as the declarant — disclosure
// summaries, sponsored travel, gifts and material changes from the public
// registry snapshot. Same name matching as lobbying; a missing artifact is a
// pending integration, not an error (the registry has no bulk export and the
// scrape may not have landed yet).
app.get('/api/ethics', async (req, res) => {
  try {
    const mp = String(req.query.mp || '').slice(0, 200).trim();
    if (!mp) return res.status(400).json({ error: 'mp required' });
    let data;
    try {
      data = await getEthicsData();
    } catch (e) {
      if (e.code === 'ENOENT') return res.json({ mp, pending: true, ethics: null });
      throw e;
    }
    const ethics =
      data.members[norm(mp)] || matchCampaign(Object.values(data.members), mp) || null;
    res.json({ mp, built: data.built, ethics });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// Quarterly expenditure reports available upstream, newest first — the
// client walks this list one quarter at a time.
app.get('/api/expenditures/quarters', async (_req, res) => {
  try {
    res.json(await getExpQuarters());
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// One quarter for one riding: the profile MP's own line when their name
// matches (EC/ourcommons spellings differ — same fallback as finance), any
// other lines under the riding (predecessors, Vacant) counted separately,
// plus the House-wide median for scale.
app.get('/api/expenditures', async (req, res) => {
  try {
    const fy = parseInt(req.query.fy, 10);
    const q = parseInt(req.query.q, 10);
    const riding = String(req.query.riding || '').slice(0, 200).trim();
    const mp = String(req.query.mp || '').slice(0, 200).trim();
    if (!Number.isFinite(fy) || !Number.isFinite(q) || q < 1 || q > 4 || !riding) {
      return res.status(400).json({ error: 'fy, q (1–4) and riding required' });
    }
    const meta = (await getExpQuarters()).find((x) => x.fy === fy && x.q === q);
    if (!meta) return res.status(404).json({ error: `no report for FY${fy} Q${q}` });
    const rows = await getExpQuarter(`${fy}|${q}|${meta.summaryId}`);
    const inRiding = rows.filter((r) => norm(r.riding) === norm(riding));
    const mine = mp ? matchCampaign(inRiding.filter((r) => !r.vacant), mp) : null;
    const totals = rows
      .filter((r) => !r.vacant && r.total > 0)
      .map((r) => r.total)
      .sort((a, b) => a - b);
    res.json({
      fy,
      q,
      summaryId: meta.summaryId,
      mine,
      others: inRiding
        .filter((r) => r !== mine)
        .map((r) => ({ name: r.name, vacant: r.vacant, total: Math.round(r.total) })),
      house: {
        median: totals.length ? Math.round(totals[Math.floor(totals.length / 2)]) : 0,
        reporting: totals.length,
      },
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// Census snapshot for the member's riding, with Canada and the home province
// for scale. 2021 Census, 2023 representation-order districts.
app.get('/api/demographics', async (req, res) => {
  try {
    const riding = String(req.query.riding || '').slice(0, 200).trim();
    if (!riding) return res.status(400).json({ error: 'riding required' });
    const fedCode = (await getFedCodes()).get(norm(riding));
    if (!fedCode) return res.json({ riding, values: null });
    const provCode = String(fedCode).slice(0, 2);
    const [values, canada, province] = await Promise.all([
      censusProfile('DF_FED', `2023A0004${fedCode}`),
      getCensusCanada(),
      getCensusProvince(provCode),
    ]);
    res.json({ riding, fedCode, values, canada, province });
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
