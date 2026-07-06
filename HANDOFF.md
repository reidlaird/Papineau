# HANDOFF

## 2026-07-05 (later) — "My rep" issue lookup + GitHub

**What happened:** Two things. (1) Project is now a git repo pushed to
https://github.com/reidlaird/Papineau (repo existed empty; `gh` authed as reidlaird).
(2) Built the "this issue is bugging me → look up my local rep → compare with members
in the area" feature Reid asked for.

**New feature — `/my-rep` page:**
- Postal code → riding + MP via **Represent API** (represent.opennorth.ca, Open North).
  Resolution path: postcode → federal boundary (concordance first, centroid fallback;
  only boundaries a sitting MP is attached to count, which auto-selects the 2023
  representation order) → `/representatives/house-of-commons/` indexed by
  `related.boundary_url`. Neighbouring ridings via `?touches=<set>/<id>`.
- Represent MP → openparliament slug by normalized riding name (`norm()` folds
  accents/em-dashes), person-name fallback. Unmatched members (e.g. Jonathan
  Wilkinson — in Represent's 343 but NOT in openparliament's 341) render as
  non-clickable chips and stay out of the comparison. That 341-vs-343 gap is
  upstream data lag, not a bug.
- Issue search `/api/issues/search?q=` over the current session's votes+bills
  (session auto-detected from newest vote; lists memoized 6h). Vote haystack includes
  the linked bill's name. Stopworded AND-match, any-word relaxed fallback (flagged
  "loose match" in UI), bill-number tokens (C-26) match linked bills AND description
  prose with word-boundary regex (so c-2 ≠ c-26).
- Comparison table: `/api/vote-ballots?vote=45-1/169` returns ALL 343 ballots in one
  upstream request (limit=500 works). Client fetches per-vote sequentially
  (openparliament rate limits parallel bursts), rows fill progressively; neighbour
  toggle needs no refetch. Top 8 divisions compared, rest listed; agreement tally
  ("voted same as your MP n/N over shared Yes/No ballots") in tfoot.
- Server refactor: `cachedGet(url)` (disk cache + retry) now shared by `opFetch` and
  new `repFetch`/`repFetchAll` (Represent paginates with `meta.next`); `memoAsync()`
  replaces the ad-hoc mps memo. Cache keys now include host (old cache entries
  orphaned — harmless).
- Suggestion chips curated to topics with hits in 45-1 (pharmacare/dental/firearms/
  climate all have ZERO divisions this session — revisit chips when session changes).

**Verified live:** V6B 1A1 → Jenny Kwan (NDP, Vancouver East) + 6 neighbours; housing
(4 divisions), budget (17), C-26 (3 incl. procedural motions); full UI flow incl.
form submit, chip toggles, agreement footer, error states (bad/unknown postcode,
all-stopword query, zero results).

**Gotchas added this session:**
- `.claude/launch.json` now has `"autoPort": true` — another session's server was
  holding 3020; the express server reads `process.env.PORT` so this Just Works.
- `preview_screenshot` times out on this machine even when the page is healthy —
  verify with preview_eval/snapshot/inspect instead.
- React controlled inputs ignore `preview_fill` (value-tracker dedupe); drive them
  with the native value setter + `input` event via preview_eval.
- Represent API: no key, be polite (same UA + disk cache as openparliament).
  Attribution shown on the page and in About.

**Next steps:** unchanged from below (elections → campaign finance → expenditures →
demographics), plus: French toggle would pair well with My rep; agreement tally could
extend to "over the whole session" using per-MP ballot pagination.

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
