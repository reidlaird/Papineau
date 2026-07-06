// One-off probe for the EDA slice: for a couple of known associations, group
// rows by year × report × part × formId to decide (a) whether amended
// versions duplicate the original's rows and (b) whether "Statement of
// Contributions Received" and the "Details of…" parts coexist in one return.
// Usage: node scripts/probe-eda.mjs --zip <path>
import { StringDecoder } from 'node:string_decoder';

// Reuse the zip/CSV streaming from the build script by importing nothing —
// small copy keeps this probe deletable without touching the real script.
import fs from 'node:fs';
import zlib from 'node:zlib';

const zipArg = process.argv.indexOf('--zip');
const ZIP_PATH = process.argv[zipArg + 1];

function openCsvStream() {
  const head = Buffer.alloc(64);
  const fd = fs.openSync(ZIP_PATH, 'r');
  fs.readSync(fd, head, 0, 64, 0);
  fs.closeSync(fd);
  const dataStart = 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  const inflate = zlib.createInflateRaw();
  const file = fs.createReadStream(ZIP_PATH, { start: dataStart });
  file.pipe(inflate);
  inflate.on('end', () => file.destroy());
  return inflate;
}

const TARGETS = new Set([
  'Davenport Federal Liberal Association',
  'Bloc Québécois de Joliette',
  'Papineau Federal Liberal Association',
]);

const groups = new Map(); // assoc|year|report|part|form → {n, sum}
let ridingSamples = new Set();

const stream = openCsvStream();
const decoder = new StringDecoder('utf8');
let row = [];
let field = '';
let inQuotes = false;
let header = true;

const onRow = (r) => {
  if (r[0] !== 'Registered associations') return;
  const assoc = r[3];
  if (!TARGETS.has(assoc)) return;
  const key = [assoc, r[9], r[11], r[13], r[10]].join(' | ');
  let g = groups.get(key);
  if (!g) groups.set(key, (g = { n: 0, sum: 0 }));
  g.n++;
  g.sum += (parseFloat(String(r[23]).replace(/[$,\s]/g, '')) || 0) +
    (parseFloat(String(r[24]).replace(/[$,\s]/g, '')) || 0);
  if (ridingSamples.size < 6) ridingSamples.add(`${assoc} → riding[7]="${r[7]}" event[8]="${r[8]}"`);
};

stream.on('data', (chunk) => {
  const text = decoder.write(chunk);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') {
      row.push(field);
      if (!header && row.length > 20) onRow(row);
      header = false;
      row = []; field = '';
    } else if (c !== '\r') field += c;
  }
});
stream.on('end', () => {
  console.log([...ridingSamples].join('\n'));
  console.log('');
  for (const [k, g] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`${k}  →  rows=${g.n}  sum=$${Math.round(g.sum).toLocaleString('en-CA')}`);
  }
});
