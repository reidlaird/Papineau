// Builds data/ethics/mp-declarations.json.gz from the Conflict of Interest
// and Ethics Commissioner's public registry (ciec-ccie.parl.gc.ca).
//
// ⚠ UNLIKE the finance/lobbying builders, there is NO bulk export for this
// registry — this script scrapes the public search results. It was written in
// a sandbox whose egress policy blocked *.parl.gc.ca entirely, so the row
// parser below is built from the URL research in the header and has NEVER run
// against the live site. First run: start with --probe, eyeball
// data/ethics/probe-page1.html, and adjust extractRows() if the sanity checks
// refuse to write. The checks are deliberately strict — a silent bad parse
// would ship an artifact full of garbage.
//
// What research established (2026-07):
// - The current registry front end is https://ciec-ccie.parl.gc.ca/en/public-registry
//   and takes plain query params (seen in indexed URLs):
//     page=<1-based>            searchTerm=<free text, e.g. "Mark+Carney">
//     declarationType=<guid>    declarationReportType=  affiliationRole=
//     declarationStatus=        disclosureFrom= / disclosureTo=
//     sortBy=declarationDisclosureDate  sortDir=desc
//   A search-engine snippet showed "8,398 results across 280 pages" → 30/page.
//   The GUID filter values are unknown (Dataverse-style ids, e.g. the
//   "9c59f81f-5a80-…" declarationType seen in one indexed URL) — so this
//   script fetches UNFILTERED and takes the type/role labels from the rows.
// - The legacy SharePoint front (prciec-rpccie.parl.gc.ca) still serves
//   declaration details at /EN/PublicRegistries/Pages/Declaration.aspx
//   ?DeclarationID=<guid> and PDF attachments under /Lists/Declarations/ —
//   result rows may link there rather than to a same-host detail route.
// - The registry only holds CURRENT members and office holders; departed
//   people are removed. So the artifact is a snapshot, not a history — the
//   card copy must say so, and re-runs will shrink as members leave.
// - Members file under the Conflict of Interest Code (disclosure summaries,
//   sponsored travel, gifts, material changes); ministers and parliamentary
//   secretaries ALSO file under the Act. Both matter for an MP page, so
//   nothing is filtered by role — the server matches by name.
// - lobbycanada.gc.ca (same GC infrastructure family) rejects curl's UA at
//   the WAF; Node fetch with a browser User-Agent works. Assume the same.
//
// Usage:
//   node scripts/build-ethics.mjs --probe        # fetch page 1, dump HTML + diagnostics
//   node scripts/build-ethics.mjs                # full build (≈280 pages, polite)
//   node scripts/build-ethics.mjs --max-pages 3  # partial run while iterating

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'data', 'ethics');
const OUT_PATH = path.join(OUT_DIR, 'mp-declarations.json.gz');
const BASE = 'https://ciec-ccie.parl.gc.ca';
const LIST_PATH = '/en/public-registry';

const argv = process.argv.slice(2);
const PROBE = argv.includes('--probe');
const maxPagesArg = argv.indexOf('--max-pages');
const MAX_PAGES = maxPagesArg >= 0 ? parseInt(argv[maxPagesArg + 1], 10) : Infinity;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const fold = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
const norm = (s) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();

// "Hon. Pablo Rodriguez, P.C., M.P." → "Pablo Rodriguez" — the registry
// decorates names; openparliament doesn't.
function cleanName(raw) {
  return String(raw || '')
    .replace(/\b(right\s+)?hon(ourable|\.)?\s*/gi, '')
    .replace(/\bdr\.?\s+/gi, '')
    .replace(/,\s*(p\.?c\.?|m\.?p\.?|q\.?c\.?|k\.?c\.?|c\.?m\.?)\b\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getPage(page) {
  const url = new URL(LIST_PATH, BASE);
  if (page > 1) url.searchParams.set('page', String(page));
  url.searchParams.set('sortBy', 'declarationDisclosureDate');
  url.searchParams.set('sortDir', 'desc');
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en', Accept: 'text/html' },
    });
    if (res.ok) return res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    throw new Error(`${url} returned ${res.status}`);
  }
}

const decodeEntities = (s) =>
  String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, '’')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

const stripTags = (s) => decodeEntities(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// "8,398 results" / "8 398 résultats" — used both for the page count and as a
// build-completeness check.
function extractTotal(html) {
  const m = /([\d][\d,  ]{2,})\s*(results?|résultats?)/i.exec(stripTags(html));
  return m ? parseInt(m[1].replace(/[^\d]/g, ''), 10) : null;
}

const DATE_RE = /\b(20\d{2}-\d{2}-\d{2})\b|\b((January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2})\b/;

function isoDate(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s + ' UTC');
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// The type labels used under the Code and the Act — matched loosely against
// each row's text so we can bucket without knowing the exact markup. Order
// matters: first hit wins.
const TYPE_LABELS = [
  'Disclosure Summary',
  'Summary Statement',
  'Sponsored Travel',
  'Material Change',
  'Gift or Other Advantage',
  'Gifts or Other Advantages',
  'Gift or Other Benefit',
  'Gifts or Other Benefits',
  'Recusal',
  'Conflict of Interest Screen',
  'Public Declaration',
  'Miscellaneous Statement',
  'Travel',
];

// ---- row extraction -------------------------------------------------------
// Three strategies, tried in order. Each returns
//   [{ name, role, type, title, date, url }]
// or null when the strategy doesn't apply to this HTML.

// 1) Embedded JSON state (Next/Nuxt or a JSON API response inlined into the
//    page). If present this is far more reliable than markup scraping.
function rowsFromEmbeddedState(html) {
  const m =
    /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html) ||
    /window\.__NUXT__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/.exec(html);
  if (!m) return null;
  let state;
  try {
    state = JSON.parse(m[1]);
  } catch {
    return null; // NUXT state is often a function expression, not JSON
  }
  // Hunt for the first array of objects that look like declarations.
  const found = [];
  (function walk(node) {
    if (found.length || !node || typeof node !== 'object') return;
    if (
      Array.isArray(node) &&
      node.length > 3 &&
      node.every((x) => x && typeof x === 'object') &&
      node.some((x) =>
        Object.keys(x).some((k) => /declaration|disclosure/i.test(k))
      )
    ) {
      found.push(...node);
      return;
    }
    for (const v of Object.values(node)) walk(v);
  })(state);
  if (!found.length) return null;
  const pick = (o, res) => {
    for (const [k, v] of Object.entries(o)) if (res.test(k) && typeof v === 'string' && v) return v;
    return '';
  };
  return found.map((o) => {
    const url = pick(o, /url|link|href|id$/i);
    return {
      name: cleanName(pick(o, /name|declarant|member|holder/i)),
      role: pick(o, /role|affiliation|title|position/i),
      type: pick(o, /type|category/i),
      title: pick(o, /title|subject|summary|description/i),
      date: isoDate(pick(o, /date/i).slice(0, 10)) || isoDate(pick(o, /date/i)),
      url: /^(\/|https?:)/.test(url) ? new URL(url, BASE).href : url,
    };
  });
}

// Words that disqualify a capitalized phrase from being a person's name —
// registry chrome, type labels, months.
const NOT_NAME =
  /\b(registry|register|declarations?|disclosures?|summary|summaries|statements?|sponsored|travel|gifts?|advantages?|benefits?|material|changes?|recusals?|screens?|conflict|interest|ethics|commissioner|commons|house|canada|members?|ministers?|secretary|public|office|holders?|view|details?|search|filter|page|january|february|march|april|may|june|july|august|september|october|november|december|results?)\b/i;

// Best-effort declarant name from a row's visible text: a 2–5 word
// capitalized run (honorifics tolerated) that isn't registry chrome. Adjacent
// capitalized chrome ("… Omar Habib Member of the House …") is trimmed off
// the edges word by word before judging the candidate.
function nameFromText(text) {
  const s = String(text);
  const re = /(?:Right\s+)?(?:Hon\.?\s+)?([A-ZÀ-Þ][\w'’.-]*(?:\s+[A-ZÀ-Þ][\w'’.-]*){1,4})/g;
  let m;
  while ((m = re.exec(s))) {
    const words = cleanName(m[1]).split(' ').filter(Boolean);
    if (words.length && NOT_NAME.test(words[0])) {
      // Chrome-led run ("Disclosure Summary Hon. Sue Ellen…") — greedy
      // matching may have swallowed the start of the real name. Rescan from
      // the first non-chrome word so the full name gets its own match.
      while (words.length && NOT_NAME.test(words[0])) words.shift();
      const idx = words.length ? s.indexOf(words[0], m.index) : -1;
      if (idx > m.index) re.lastIndex = idx;
      continue;
    }
    while (words.length && NOT_NAME.test(words[words.length - 1])) words.pop();
    const candidate = words.join(' ');
    if (words.length >= 2 && words.length <= 5 && !/\d/.test(candidate)) return candidate;
  }
  return '';
}

// 2) Detail-link anchored markup parse: split the HTML at links that point at
//    a declaration detail page (either host), and read the fields out of the
//    chunk around each link.
function rowsFromDetailLinks(html) {
  const linkRe =
    /<a[^>]+href="([^"]*(?:DeclarationID=[0-9a-f-]{36}|\/public-registry\/[^"]+|\/declaration[^"]*))"[^>]*>([\s\S]*?)<\/a>/gi;
  const hits = [...html.matchAll(linkRe)].filter(
    (m) =>
      !/page=|sortBy=|searchTerm=/.test(m[1]) && // pagination/sort links reuse the path
      !/\.pdf(?:[?#]|$)/i.test(m[1]) // "View attachment" PDF links live under /Declarations/…
  );
  if (hits.length < 5) return null;
  // A row's fields render either after its link or before it, depending on
  // the markup. Segment the page strictly at the links (so one row can never
  // bleed into its neighbour) and decide the direction once per page by
  // counting which side the dates fall on.
  const segAfter = (i) =>
    html.slice(
      hits[i].index,
      i + 1 < hits.length ? hits[i + 1].index : Math.min(html.length, hits[i].index + 4000)
    );
  const segBefore = (i) =>
    html.slice(
      i > 0 ? hits[i - 1].index + hits[i - 1][0].length : Math.max(0, hits[0].index - 4000),
      hits[i].index + hits[i][0].length
    );
  const dated = (seg) => hits.filter((_, i) => DATE_RE.test(stripTags(seg(i)))).length;
  const seg = dated(segAfter) >= dated(segBefore) ? segAfter : segBefore;

  const rows = [];
  for (let i = 0; i < hits.length; i++) {
    const m = hits[i];
    const rawSeg = seg(i);
    const chunk = stripTags(rawSeg);
    // Prefer the card footer's disclosure date — free-text fields (a gift's
    // "Nature") can contain earlier dates that DATE_RE would match first.
    const disclosedM = /Disclosed on\s+(20\d{2}-\d{2}-\d{2})/i.exec(chunk);
    const dateM = disclosedM || DATE_RE.exec(chunk);
    const type = TYPE_LABELS.find((t) => chunk.toLowerCase().includes(t.toLowerCase())) || '';
    const linkText = stripTags(m[2]);
    // The declarant has a dedicated profile anchor in each card
    // (/en/client?clientId=<guid>) — by far the most reliable name source.
    const clientM = /<a[^>]+href="[^"]*client\?clientId=[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(rawSeg);
    const clientName = clientM ? cleanName(stripTags(clientM[1])) : '';
    // Fallbacks: the link text itself when it reads like a person; otherwise
    // the first name-like phrase in the row's segment.
    const asName = cleanName(linkText);
    const looksLikeName =
      /^[A-ZÀ-Þ][^\d]{2,60}$/.test(asName) &&
      asName.split(' ').length >= 2 &&
      asName.split(' ').length <= 6 &&
      !NOT_NAME.test(asName);
    rows.push({
      name: clientName || (looksLikeName ? asName : nameFromText(chunk)),
      role: /member of the house of commons/i.test(chunk) ? 'Member of the House of Commons' : '',
      type,
      title: linkText,
      date: dateM ? isoDate(dateM[1] || dateM[2]) : null,
      url: new URL(decodeEntities(m[1]), BASE).href,
    });
  }
  return rows;
}

// 3) Table parse — oldest-school fallback.
function rowsFromTable(html) {
  const bodies = [...html.matchAll(/<tbody[^>]*>([\s\S]*?)<\/tbody>/gi)];
  for (const [, body] of bodies) {
    const trs = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    if (trs.length < 5) continue;
    const rows = trs.map(([, tr]) => {
      const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(([, c]) => stripTags(c));
      const href = /<a[^>]+href="([^"]+)"/i.exec(tr)?.[1];
      const dateCell = cells.find((c) => DATE_RE.test(c)) || '';
      const typeCell = cells.find((c) => TYPE_LABELS.some((t) => c.toLowerCase().includes(t.toLowerCase()))) || '';
      const nameCell = cells.map((c) => nameFromText(c)).find(Boolean) || '';
      return {
        name: nameCell,
        role: cells.find((c) => /member|minister|secretary/i.test(c)) || '',
        type: TYPE_LABELS.find((t) => typeCell.toLowerCase().includes(t.toLowerCase())) || typeCell,
        title: typeCell,
        date: isoDate(DATE_RE.exec(dateCell)?.[0] || null),
        url: href ? new URL(decodeEntities(href), BASE).href : '',
      };
    });
    return rows;
  }
  return null;
}

function extractRows(html) {
  for (const strat of [rowsFromEmbeddedState, rowsFromDetailLinks, rowsFromTable]) {
    const rows = strat(html);
    if (rows && rows.length) return { rows, strategy: strat.name };
  }
  return { rows: [], strategy: 'none' };
}

// ---- probe ----------------------------------------------------------------

if (PROBE) {
  const html = await getPage(1);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const dump = path.join(OUT_DIR, 'probe-page1.html');
  fs.writeFileSync(dump, html);
  console.log(`saved ${dump} (${(html.length / 1024).toFixed(0)} KB)`);
  console.log(`total results advertised: ${extractTotal(html) ?? 'NOT FOUND'}`);
  const { rows, strategy } = extractRows(html);
  console.log(`extraction strategy: ${strategy}, rows on page 1: ${rows.length}`);
  for (const r of rows.slice(0, 5)) console.log(' ', JSON.stringify(r));
  // Clues for a JSON API the front end might call — if one exists, rewrite
  // this script to use it instead of scraping markup.
  const apiHints = [...new Set([...html.matchAll(/["'](\/[a-z0-9/_-]*api[a-z0-9/_-]*)["']/gi)].map((m) => m[1]))];
  if (apiHints.length) console.log('possible API paths seen in page source:', apiHints.slice(0, 10));
  process.exit(0);
}

// ---- full build -----------------------------------------------------------

const PAGE_SIZE = 30;
const first = await getPage(1);
const total = extractTotal(first);
if (!total) {
  throw new Error(
    'could not find the "N results" figure on page 1 — the markup has drifted from ' +
      'what this parser expects. Run with --probe and adapt extractRows()/extractTotal().'
  );
}
const pages = Math.min(Math.ceil(total / PAGE_SIZE), MAX_PAGES);
console.log(`${total} declarations advertised, fetching ${pages} pages…`);

const all = [];
let strategyUsed = '';
for (let p = 1; p <= pages; p++) {
  const html = p === 1 ? first : await getPage(p);
  const { rows, strategy } = extractRows(html);
  if (!rows.length) throw new Error(`page ${p}: no rows extracted (strategy ${strategy}) — see --probe`);
  strategyUsed = strategy;
  all.push(...rows);
  if (p % 20 === 0 || p === pages) console.log(`  page ${p}/${pages} — ${all.length} rows`);
  await new Promise((r) => setTimeout(r, 400)); // be polite — this is a small office's site
}

// Sanity gates: refuse to write garbage.
const withName = all.filter((r) => r.name && r.name.split(' ').length >= 2);
const withDate = all.filter((r) => r.date);
const withType = all.filter((r) => r.type);
console.log(
  `extracted ${all.length} rows (${withName.length} with names, ${withDate.length} dated, ${withType.length} typed) via ${strategyUsed}`
);
if (Number.isFinite(MAX_PAGES) === false && all.length < total * 0.9) {
  throw new Error(`only ${all.length}/${total} rows extracted — parser is dropping rows, not writing artifact`);
}
if (withName.length < all.length * 0.8 || withDate.length < all.length * 0.8) {
  throw new Error('too many rows missing a name or date — parser mis-mapped fields, not writing artifact');
}

// Aggregate per declarant, newest first.
const members = new Map();
for (const r of withName) {
  const key = norm(r.name);
  if (!key) continue;
  let m = members.get(key);
  if (!m) members.set(key, (m = { name: r.name, role: r.role || '', total: 0, byType: {}, byYear: {}, all: [] }));
  m.total++;
  if (r.role && !m.role) m.role = r.role;
  const type = r.type || 'Other';
  m.byType[type] = (m.byType[type] || 0) + 1;
  if (r.date) m.byYear[r.date.slice(0, 4)] = (m.byYear[r.date.slice(0, 4)] || 0) + 1;
  m.all.push({ type, title: r.title || '', date: r.date, url: r.url || '' });
}

const out = {
  built: new Date().toISOString().slice(0, 10),
  source: BASE + LIST_PATH,
  totalAdvertised: total,
  members: {},
};
for (const [key, m] of members) {
  m.all.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  out.members[key] = {
    name: m.name,
    role: m.role,
    total: m.total,
    byType: m.byType,
    byYear: m.byYear,
    recent: m.all.slice(0, 10),
  };
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const gz = zlib.gzipSync(Buffer.from(JSON.stringify(out)), { level: 9 });
fs.writeFileSync(OUT_PATH, gz);
console.log(
  `wrote ${OUT_PATH} (${(gz.length / 1024).toFixed(0)} KB gz, ${members.size} declarants, ${withName.length} declarations)`
);
