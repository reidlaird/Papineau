// Builds data/finance/candidate-contributions.json.gz from Elections Canada's
// audited "Contributions" open data (od_cntrbtn_audt_e.zip).
//
// Why offline: the source is a 115 MB zip holding one 2.2 GB CSV — every
// contribution to every political entity since 2004. The production API runs
// on a free Render instance (0.1 CPU, disk wiped on every spin-down), so it
// can't chew through that per boot. Returns are audited and final, so we
// pre-aggregate per candidate campaign here and commit the small artifact;
// re-run this script and commit when Elections Canada refreshes the dump
// (they update it as returns finish audit — GE45 returns keep landing
// through 2026).
//
// Usage:
//   node scripts/build-finance.mjs             # build the artifact
//   node scripts/build-finance.mjs --inspect   # print vocabulary/stats only
//   --zip <path> to point at an already-downloaded dump (default
//   data/finance/od_cntrbtn_audt_e.zip, downloaded if missing).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { StringDecoder } from 'node:string_decoder';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_URL = 'https://www.elections.ca/fin/oda/od_cntrbtn_audt_e.zip';
const OUT_PATH = path.join(ROOT, 'data', 'finance', 'candidate-contributions.json.gz');
const SINCE_YEAR = 2015; // matches the Elections card's window (GE42 →)

const argv = process.argv.slice(2);
const INSPECT = argv.includes('--inspect');
const zipArg = argv.indexOf('--zip');
const ZIP_PATH =
  zipArg >= 0 ? path.resolve(argv[zipArg + 1]) : path.join(ROOT, 'data', 'finance', 'od_cntrbtn_audt_e.zip');

// --entity associations switches to the riding-association (EDA) slice of the
// same dump. Their returns are ANNUAL (fiscal years, not electoral events) and
// may carry amendments — run --inspect and read the Form-ID/report tallies
// before trusting any aggregation.
const entityArg = argv.indexOf('--entity');
const ENTITY =
  entityArg >= 0
    ? { candidates: 'Candidates', associations: 'Registered associations' }[argv[entityArg + 1]]
    : 'Candidates';
if (!ENTITY) throw new Error('--entity must be "candidates" or "associations"');

const EDA_OUT_PATH = path.join(ROOT, 'data', 'finance', 'eda-contributions.json.gz');

// Column indexes in od_cntrbtn_audt_e.csv (header row 0).
const COL = {
  entity: 0, // "Candidates", "Registered associations", ...
  recipientLast: 3,
  recipientFirst: 4,
  party: 6, // full registered name, e.g. "Liberal Party of Canada"
  riding: 7, // "Electoral District"
  event: 8, // "45th general election", by-elections, or fiscal years
  date: 9, // election day / fiscal year end
  formId: 10,
  report: 11, // "Financial Report" (return title)
  part: 13, // "Financial Report part" (statement within the return)
  contributorType: 14,
  contributorName: 15,
  contributorProvince: 20,
  received: 22,
  monetary: 23,
  nonMonetary: 24,
};

// Registered party name → the short names client/src/partyMeta.js knows.
// Keyword match, checked in order; anything unmatched keeps its full name
// (renders in the Independent grey — fine for minor parties).
const PARTY_SHORT = [
  ['liberal party of canada', 'Liberal'],
  ['conservative party of canada', 'Conservative'],
  ['new democratic party', 'NDP'],
  ['bloc quebecois', 'Bloc Québécois'],
  ['green party of canada', 'Green'],
  ["people's party of canada", 'PPC'],
];

const fold = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
const norm = (s) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();

function shortParty(full) {
  const f = fold(full).replace(/[’‘]/g, "'");
  for (const [needle, short] of PARTY_SHORT) if (f.includes(needle)) return short;
  return (full || 'Independent').trim() || 'Independent';
}

async function ensureZip() {
  if (fs.existsSync(ZIP_PATH)) return;
  fs.mkdirSync(path.dirname(ZIP_PATH), { recursive: true });
  console.log(`downloading ${SOURCE_URL} → ${ZIP_PATH} (≈115 MB)…`);
  const res = await fetch(SOURCE_URL, {
    headers: { 'User-Agent': 'HonesTea/0.1 build-finance (personal dashboard)' },
  });
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(ZIP_PATH);
    Readable.fromWeb(res.body).pipe(out).on('finish', resolve).on('error', reject);
  });
}

// The zip holds exactly one deflate entry; skip its local file header and
// inflate the rest as a raw stream (no zip library needed).
function openCsvStream() {
  const head = Buffer.alloc(64);
  const fd = fs.openSync(ZIP_PATH, 'r');
  fs.readSync(fd, head, 0, 64, 0);
  fs.closeSync(fd);
  if (head.readUInt32LE(0) !== 0x04034b50) throw new Error('not a zip (no local file header)');
  if (head.readUInt16LE(8) !== 8) throw new Error('zip entry is not deflate-compressed');
  const dataStart = 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  const inflate = zlib.createInflateRaw();
  // InflateRaw ends itself at the deflate terminator; the zip's trailing
  // central directory never reaches it because we destroy the file stream.
  const file = fs.createReadStream(ZIP_PATH, { start: dataStart });
  file.pipe(inflate);
  inflate.on('end', () => file.destroy());
  return inflate;
}

// Stream the CSV, calling onRow(fields[]) per record. RFC-4180: quoted
// fields, escaped quotes, CRLF; multi-byte UTF-8 handled by StringDecoder.
function forEachRow(stream, onRow) {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf8');
    let row = [];
    let field = '';
    let inQuotes = false;
    let isHeader = true;
    const flushRow = () => {
      row.push(field);
      field = '';
      if (row.length > 1 || row[0].trim() !== '') {
        if (isHeader) isHeader = false;
        else onRow(row);
      }
      row = [];
    };
    stream.on('data', (chunk) => {
      const text = decoder.write(chunk);
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
          if (c === '"') {
            if (text[i + 1] === '"') {
              field += '"';
              i++;
            } else inQuotes = false;
            // A quote can also straddle a chunk boundary: text[i+1] is
            // undefined at chunk end. That would mis-close on an escaped
            // quote split across chunks — vanishingly rare in this data,
            // and a mis-parse surfaces as a column-count skip we report.
          } else field += c;
        } else if (c === '"') inQuotes = true;
        else if (c === ',') {
          row.push(field);
          field = '';
        } else if (c === '\n') flushRow();
        else if (c !== '\r') field += c;
      }
    });
    stream.on('end', () => {
      if (field !== '' || row.length) flushRow();
      resolve();
    });
    stream.on('error', reject);
  });
}

const money = (s) => {
  const v = parseFloat(String(s).replace(/[$,\s]/g, ''));
  return Number.isFinite(v) ? v : 0;
};

// "45th general election" → 45; by-elections and fiscal years → null.
const geNumber = (event) => {
  const m = /^(\d+)(st|nd|rd|th) general election$/i.exec(event.trim());
  return m ? parseInt(m[1], 10) : null;
};

// Candidates filter on election year; the association inspect pass looks at
// every year first (their date column format is one of the open questions).
const isTarget = (r) =>
  r[COL.entity] === ENTITY &&
  (ENTITY !== 'Candidates' || parseInt(r[COL.date], 10) >= SINCE_YEAR);

// ---------- inspect mode ----------

async function inspect() {
  const tally = () => new Map();
  const bump = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);
  const events = tally();
  const reports = tally();
  const parts = tally();
  const ctypes = tally();
  const parties = tally();
  const blankSamples = [];
  let blankName = 0;
  let rows = 0;
  let kept = 0;
  const formsPerReturn = new Map(); // recipient|event → Set(formId)

  await forEachRow(openCsvStream(), (r) => {
    rows++;
    if (rows % 2_000_000 === 0) console.error(`…${(rows / 1e6).toFixed(0)}M rows`);
    if (!isTarget(r)) return;
    kept++;
    bump(events, `${r[COL.event]} | ${r[COL.date]}`);
    bump(reports, r[COL.report]);
    bump(parts, r[COL.part]);
    bump(ctypes, r[COL.contributorType]);
    bump(parties, r[COL.party]);
    if (!r[COL.contributorName].trim()) {
      blankName++;
      if (blankSamples.length < 8)
        blankSamples.push({
          part: r[COL.part],
          type: r[COL.contributorType],
          monetary: r[COL.monetary].trim(),
          nonMonetary: r[COL.nonMonetary].trim(),
          received: r[COL.received],
        });
    }
    const key = `${r[COL.recipientLast]}|${r[COL.recipientFirst]}|${r[COL.event]}`;
    let set = formsPerReturn.get(key);
    if (!set) formsPerReturn.set(key, (set = new Set()));
    set.add(r[COL.formId]);
  });

  const dump = (label, m, max = 40) => {
    console.log(`\n== ${label} (${m.size}) ==`);
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, max)
      .forEach(([k, n]) => console.log(String(n).padStart(9), k));
  };
  console.log(`rows total: ${rows}, kept (Candidates ≥${SINCE_YEAR}): ${kept}`);
  dump('electoral events', events, 80);
  dump('financial reports', reports);
  dump('report parts', parts);
  dump('contributor types', ctypes);
  dump('parties', parties, 60);
  console.log(`\nblank contributor name rows: ${blankName}`);
  console.log(blankSamples);
  const multi = [...formsPerReturn.entries()].filter(([, s]) => s.size > 1);
  console.log(`\nreturns with >1 Form ID: ${multi.length} of ${formsPerReturn.size}`);
  console.log(multi.slice(0, 10).map(([k, s]) => `${k} → ${[...s].join(', ')}`));
}

// ---------- build mode ----------
//
// What --inspect established about Candidates rows ≥ 2015 (2026-07 dump):
// one report part only ("Statement of Contributions Received"), contributor
// type always Individuals, no return has more than one Form ID (so no
// amendment double-counting — sum everything), and blank-contributor rows
// are all $0.00 placeholders. Rows are the ITEMIZED contributions (the Act
// requires itemizing gifts over $200; smaller ones appear only when a
// campaign chose to itemize) — the UI must present totals as "reported
// contributions", not all money raised.

const BUCKET_EDGES = [250, 500, 1000]; // ≤250, ≤500, ≤1000, over

async function build() {
  const events = []; // {kind:'ge'|'by', ge, date}
  const eventIdx = new Map(); // raw event string → index into events
  const ridings = new Map(); // norm(riding) → {name, nameDate, campaigns: Map}
  let rows = 0;
  let kept = 0;
  let refunds = 0;
  let shortRows = 0;

  await forEachRow(openCsvStream(), (r) => {
    rows++;
    if (rows % 2_000_000 === 0) console.error(`…${(rows / 1e6).toFixed(0)}M rows`);
    if (r.length < 25) {
      shortRows++;
      return;
    }
    if (!isTarget(r)) return;
    const monetary = money(r[COL.monetary]);
    const nonMonetary = money(r[COL.nonMonetary]);
    const total = monetary + nonMonetary;
    if (total === 0) return; // blank placeholder rows

    const evKey = r[COL.event].trim();
    let ei = eventIdx.get(evKey);
    if (ei === undefined) {
      const ge = geNumber(evKey);
      events.push({ kind: ge ? 'ge' : 'by', ge, date: r[COL.date].trim() });
      ei = events.length - 1;
      eventIdx.set(evKey, ei);
    }

    const ridingName = r[COL.riding].trim();
    const rKey = norm(ridingName);
    let riding = ridings.get(rKey);
    if (!riding) ridings.set(rKey, (riding = { name: ridingName, nameDate: '', campaigns: new Map() }));
    // Same norm key can carry punctuation/name variants across events — show
    // the most recent official spelling.
    if (events[ei].date > riding.nameDate) {
      riding.nameDate = events[ei].date;
      riding.name = ridingName;
    }

    const name = `${r[COL.recipientFirst].trim()} ${r[COL.recipientLast].trim()}`.trim();
    const cKey = ei + '|' + norm(name);
    let c = riding.campaigns.get(cKey);
    if (!c) {
      riding.campaigns.set(cKey, (c = {
        event: ei,
        name,
        party: shortParty(r[COL.party]),
        monetary: 0,
        nonMonetary: 0,
        count: 0,
        bucketCounts: [0, 0, 0, 0],
        bucketAmounts: [0, 0, 0, 0],
        provinces: {},
      }));
    }
    c.monetary += monetary;
    c.nonMonetary += nonMonetary;
    if (total < 0) {
      refunds++; // negative correction rows adjust totals but aren't gifts
      return;
    }
    kept++;
    c.count++;
    let b = BUCKET_EDGES.findIndex((e) => total <= e);
    if (b < 0) b = BUCKET_EDGES.length;
    c.bucketCounts[b]++;
    c.bucketAmounts[b] += total;
    const prov = r[COL.contributorProvince].trim().toUpperCase();
    if (prov) c.provinces[prov] = (c.provinces[prov] || 0) + total;
  });

  const round = (n) => Math.round(n);
  const out = {
    built: new Date().toISOString().slice(0, 10),
    source: SOURCE_URL,
    sinceYear: SINCE_YEAR,
    bucketEdges: BUCKET_EDGES,
    events,
    ridings: {},
  };
  let campaigns = 0;
  for (const [key, r] of ridings) {
    out.ridings[key] = {
      name: r.name,
      campaigns: [...r.campaigns.values()].map((c) => {
        campaigns++;
        return {
          ...c,
          monetary: round(c.monetary),
          nonMonetary: round(c.nonMonetary),
          bucketAmounts: c.bucketAmounts.map(round),
          provinces: Object.fromEntries(
            Object.entries(c.provinces).map(([k, v]) => [k, round(v)])
          ),
        };
      }),
    };
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(out)), { level: 9 });
  fs.writeFileSync(OUT_PATH, gz);
  console.log(
    `rows ${rows} → contributions ${kept} (refund rows ${refunds}, short rows ${shortRows})\n` +
      `events ${events.length}, ridings ${ridings.size}, campaigns ${campaigns}\n` +
      `wrote ${OUT_PATH} (${(gz.length / 1024).toFixed(0)} KB gz, ` +
      `${(JSON.stringify(out).length / 1e6).toFixed(1)} MB raw)`
  );
}

// ---------- association (EDA) build mode ----------
//
// What probing established (scripts/probe-eda.mjs, 2026-07 dump): the Form-ID
// "versions" (20081, 20081v2…) are FORM-ERA revisions, not amendments — each
// (association, fiscal year) has exactly one version, and the report parts
// never overlap within a return (2004–06 splits by contributor type, 2007–14
// is individuals-only, 2015+ is a single Statement part). So summing all rows
// per association-year is safe. The association name arrives in the
// recipient's last-name column; fiscal 2019 is absent from the dump entirely
// and recent years fill in as returns land.

async function buildAssociations() {
  const ridings = new Map(); // norm(riding) → {name, nameYear, years: Map(year → Map(assoc → agg))}
  let rows = 0;
  let kept = 0;
  let shortRows = 0;

  await forEachRow(openCsvStream(), (r) => {
    rows++;
    if (rows % 2_000_000 === 0) console.error(`…${(rows / 1e6).toFixed(0)}M rows`);
    if (r.length < 25) {
      shortRows++;
      return;
    }
    if (r[COL.entity] !== 'Registered associations') return;
    const year = parseInt(r[COL.date], 10);
    if (!(year >= SINCE_YEAR)) return;
    const monetary = money(r[COL.monetary]);
    const nonMonetary = money(r[COL.nonMonetary]);
    const total = monetary + nonMonetary;
    if (total === 0) return;

    const ridingName = r[COL.riding].trim();
    if (!ridingName) return;
    const rKey = norm(ridingName);
    let riding = ridings.get(rKey);
    if (!riding) ridings.set(rKey, (riding = { name: ridingName, nameYear: 0, years: new Map() }));
    if (year > riding.nameYear) {
      riding.nameYear = year;
      riding.name = ridingName;
    }

    const assocName = r[COL.recipientLast].trim();
    let yearMap = riding.years.get(year);
    if (!yearMap) riding.years.set(year, (yearMap = new Map()));
    const aKey = norm(assocName);
    let a = yearMap.get(aKey);
    if (!a) {
      yearMap.set(aKey, (a = {
        name: assocName,
        party: shortParty(r[COL.party]),
        monetary: 0,
        nonMonetary: 0,
        count: 0,
      }));
    }
    a.monetary += monetary;
    a.nonMonetary += nonMonetary;
    if (total > 0) {
      a.count++;
      kept++;
    }
  });

  const out = {
    built: new Date().toISOString().slice(0, 10),
    source: SOURCE_URL,
    sinceYear: SINCE_YEAR,
    ridings: {},
  };
  let assocYears = 0;
  for (const [key, r] of ridings) {
    const years = {};
    for (const [year, yearMap] of [...r.years.entries()].sort((a, b) => a[0] - b[0])) {
      years[year] = [...yearMap.values()]
        .map((a) => {
          assocYears++;
          return { ...a, monetary: Math.round(a.monetary), nonMonetary: Math.round(a.nonMonetary) };
        })
        .sort((a, b) => b.monetary + b.nonMonetary - (a.monetary + a.nonMonetary));
    }
    out.ridings[key] = { name: r.name, years };
  }

  fs.mkdirSync(path.dirname(EDA_OUT_PATH), { recursive: true });
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(out)), { level: 9 });
  fs.writeFileSync(EDA_OUT_PATH, gz);
  console.log(
    `rows ${rows} → contributions ${kept} (short rows ${shortRows})\n` +
      `ridings ${ridings.size}, association-years ${assocYears}\n` +
      `wrote ${EDA_OUT_PATH} (${(gz.length / 1024).toFixed(0)} KB gz)`
  );
}

await ensureZip();
if (INSPECT) await inspect();
else if (ENTITY === 'Candidates') await build();
else await buildAssociations();
