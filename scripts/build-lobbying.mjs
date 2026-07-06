// Builds data/lobbying/mp-communications.json.gz from the Registry of
// Lobbyists monthly communication reports open data.
//
// Why offline: the export is a 23 MB zip of ~150 MB of CSVs covering every
// filed communication since 2008 — same free-Render constraints as the
// finance artifacts. Reports are amended by refiling (PREV_COMLOG_ID chains),
// and the registry updates monthly; re-run and commit to refresh.
//
// Getting the data (two steps — the zip has multiple entries, so it's
// extracted with your OS tools rather than in here):
//   1. Download https://lobbycanada.gc.ca/media/mqbbmaqk/communications_ocl_cal.zip
//      ⚠ their WAF rejects curl and PowerShell; Node fetch with a browser
//      User-Agent works:  node -e "fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}})…"
//   2. Expand-Archive communications_ocl_cal.zip -DestinationPath <dir>
//   3. node scripts/build-lobbying.mjs --dir <dir>
//
// ⚠ The CSVs are Windows-1252, NOT UTF-8 — decoded as latin1 below; reading
// them as utf8 corrupts every accented client and member name.
//
// What probing established (2026-07 export): DPOH institution values for
// members are "House of Commons" (168k rows) and "Members of the House of
// Commons" (3.4k). Titles are too inconsistent to filter on ("MP",
// "Member of Parliament", "Député", "Member of Parliment", parliamentary-
// secretary titles…) — so the artifact keys every House-of-Commons DPOH by
// normalized name and the server matches the profile MP's name against it.
// Staff (assistants, advisors) share the institution but not MP names.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = path.join(ROOT, 'data', 'lobbying', 'mp-communications.json.gz');
const SOURCE_URL = 'https://lobbycanada.gc.ca/media/mqbbmaqk/communications_ocl_cal.zip';

const argv = process.argv.slice(2);
const dirArg = argv.indexOf('--dir');
if (dirArg < 0) throw new Error('usage: node scripts/build-lobbying.mjs --dir <extracted csv dir>');
const DIR = path.resolve(argv[dirArg + 1]);

const fold = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
const norm = (s) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();

// RFC-4180 stream parser (quoted newlines handled); latin1 per file encoding.
function forEachRow(file, onRow) {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder('latin1');
    const stream = fs.createReadStream(path.join(DIR, file));
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

const nul = (s) => (s === 'null' ? '' : (s || '').trim());

// Pass 1 — primary: comlog → {date, client}; superseded ids (amended reports).
const comms = new Map();
const superseded = new Set();
await forEachRow('Communication_PrimaryExport.csv', (r) => {
  const id = r[0];
  const client = nul(r[2]) || nul(r[3]);
  comms.set(id, { date: nul(r[7]), client });
  const prev = nul(r[11]);
  if (prev) superseded.add(prev);
});
console.log(`primary: ${comms.size} communications, ${superseded.size} superseded by amendments`);

// Pass 2 — subject codes per comlog + code → EN label.
const codeLabels = new Map();
await forEachRow('Codes_SubjectMatterTypesExport.csv', (r) => codeLabels.set(r[0], r[1]));
const subjects = new Map();
await forEachRow('Communication_SubjectMattersExport.csv', (r) => {
  const label = codeLabels.get(r[1]) || nul(r[2]);
  if (!label) return;
  let set = subjects.get(r[0]);
  if (!set) subjects.set(r[0], (set = new Set()));
  set.add(label);
});
console.log(`subjects: ${subjects.size} communications tagged`);

// Pass 3 — DPOH rows for the House of Commons, keyed by normalized name.
const dpoh = new Map();
let hocRows = 0;
await forEachRow('Communication_DpohExport.csv', (r) => {
  if (!/house of commons/i.test(r[6] || '')) return;
  const id = r[0];
  if (superseded.has(id)) return;
  const comm = comms.get(id);
  if (!comm || !comm.date) return;
  hocRows++;
  const name = `${nul(r[2])} ${nul(r[1])}`.replace(/\s+/g, ' ').trim();
  const key = norm(name);
  if (!key) return;
  let d = dpoh.get(key);
  if (!d) dpoh.set(key, (d = { name, lastDate: '', total: 0, byYear: {}, clients: new Map(), all: [] }));
  d.total++;
  if (comm.date > d.lastDate) {
    d.lastDate = comm.date;
    d.name = name; // keep the most recent spelling
  }
  const year = comm.date.slice(0, 4);
  d.byYear[year] = (d.byYear[year] || 0) + 1;
  if (comm.client) d.clients.set(comm.client, (d.clients.get(comm.client) || 0) + 1);
  d.all.push({ date: comm.date, client: comm.client, subjects: [...(subjects.get(id) || [])].slice(0, 3) });
});
console.log(`dpoh: ${hocRows} House-of-Commons rows across ${dpoh.size} names`);

const out = { built: new Date().toISOString().slice(0, 10), source: SOURCE_URL, dpoh: {} };
for (const [key, d] of dpoh) {
  d.all.sort((a, b) => b.date.localeCompare(a.date));
  out.dpoh[key] = {
    name: d.name,
    total: d.total,
    byYear: d.byYear,
    topClients: [...d.clients.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([client, n]) => ({ client, n })),
    recent: d.all.slice(0, 8),
  };
}

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
const gz = zlib.gzipSync(Buffer.from(JSON.stringify(out)), { level: 9 });
fs.writeFileSync(OUT_PATH, gz);
console.log(`wrote ${OUT_PATH} (${(gz.length / 1024).toFixed(0)} KB gz, ${Object.keys(out.dpoh).length} names)`);
