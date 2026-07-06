# HANDOFF

## 2026-07-05 — initial build

**What happened:** Project created from scratch. Reid wants an "Article One" (US
congressional transparency dashboard) equivalent for Canadian politicians — he shared
screenshots of Article One's Overview / Campaign Finance / Biography / Elections /
Floor Activity pages as the design reference (indigo sidebar, white cards on light
gray, mono uppercase micro-labels, stat tiles).

**Current state — working v1:**
- Express caching proxy (`server/index.js`, port 3020) over api.openparliament.ca:
  disk cache in `data/cache/` (6h TTL), 429/5xx retry with backoff, sequential
  per-ballot vote enrichment (parallel bursts trip their rate limit — learned the
  hard way, 6/8 ballots failed before serializing).
- React 18 + Vite SPA (`client/`): MP directory (search + party chips), MP profile
  (votes, bills, career, contact, external record links), House votes page, Bills
  page, About page with the full US→CA data-source mapping.
- Verified live against the 45th Parliament: 341 MPs, June 2026 divisions, profile
  pages for ziad-aboultaif and elizabeth-may render fully.
- `.claude/launch.json` configured (`npm run start`, port 3020). Build: `npm run build`.

**Not yet done / next steps (in rough priority order):**
1. Elections section — Elections Canada official-results CSVs → riding results +
   margin trend per MP.
2. Campaign finance — Elections Canada political financing CSV exports → receipts by
   size, expense categories, vendor table (the reference app's flagship page).
3. Members' expenditures — ourcommons proactive-disclosure quarterly CSVs.
4. Riding demographics (StatCan census profile) for a "District" page.
5. Nice-to-haves: attendance %, French toggle, bilingual names already in API.

**Gotchas for next session:**
- OpenParliament API: always go through `opFetch()` (cache + retry + User-Agent).
  Set `HONESTEA_CONTACT` env var for polite identification.
- `current_party`/`current_riding` exist on the politicians *list* endpoint but NOT
  on the detail endpoint — profile derives them from the membership with no end_date.
- Not a git repo yet (`git init` when ready).
