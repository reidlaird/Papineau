# HANDOFF

## 2026-07-05→06 (later) — Elections feature + design-critique pass

**What happened:** Three things. (1) Roadmap item #1 shipped: **Elections section
on MP profiles** from Elections Canada official results. (2) A structured design
critique of the whole UI, with the actionable fixes applied. (3) The stale
"Local build" sidebar footer replaced (now an "Open source · GitHub ↗" link —
accurate locally and in prod).

**⚠ Server changed → needs Render Manual Deploy** (dashboard → service papineau →
Manual Deploy → Deploy latest commit). Vercel picks up the client automatically
on push. Until the Render deploy happens, prod's profile pages show the Elections
card in its "no results" state and /bills still shows the C-1 bug.

**New feature — Elections on `/mp/:slug` (#elections):**
- Server fetches **Table 12** (candidates + individual results) of the official
  voting results for the last four general elections (GE42 2015 → GE45 2025).
  URLs live in `ELECTIONS` in server/index.js; note each election's path id is
  arbitrary (ovrGE45/62, ovr2021app/53, ovr2019app/51, ovr2015app/41 — probed by
  hand, don't guess future ones).
- `cachedGet` grew `{ text, ttl }` opts; election CSVs cache 30 days (results are
  final). CSV parsed by a local RFC-4180 parser; BOM stripped by char code.
- The Candidate column jams "First Last ** PartyEN/PartyFR" into one string
  (`**` = incumbent at dissolution, NOT winner — winner is the row with a
  Majority value). Party recovered by folded suffix match against
  `EC_AFFILIATIONS`; unknown parties fall back to "Other" with the name left
  intact. 2019 writes "People's Party" without "- PPC"; 2025 writes "United
  Party of Canada (UP)" — both handled. Verified against Carleton 2025's
  91-candidate Longest Ballot (1 Other row) and accented ridings.
- Ridings matched across elections by `norm()`ed name (EC uses `--` where
  openparliament uses em-dash — norm folds both). New-in-2025 ridings simply
  show fewer elections, with a boundaries caveat in the card.
- `/api/elections?riding=<name>` → `{ riding, elections: [{ge, date, name,
  number, province, candidates[], totalVotes, margin}] }` newest first.
- UI: margin-of-victory trend bars (winner-party colour, per GE) + per-election
  result bars (top 6 candidates, "+n more" collapsed), winner ✓-bolded,
  incumbent in the row title. Sidebar member anchors gained "Elections".

**Design critique → fixes applied:**
- 🔴 **Bills page bug**: `/api/bills` was the unfiltered upstream list — page
  showed every session's ceremonial Bill C-1 twenty times. Now current session,
  sorted by introduced desc, top 25. Bill titles are links now (openparliament),
  meta adds LEGISinfo; `legisinfoUrl` moved to Bits.jsx (shared with Profile).
- 🔴 **Contrast**: `--muted` #868d9b was 3.3:1 on white (AA fail) → #6b7280
  (4.8:1). Sidebar `navgroup-label` alpha .55→.75, `navlink-anchor` .75→.85.
- 🟡 **Emoji nav icons → inline SVG stroke icons** (Sidebar.jsx `icons`),
  currentColor so they follow active state. Brand 🍵 stays.
- 🟡 404 catch-all route ("Nothing steeping here", in Bits.jsx).
- 🟢 span.chip (non-clickable) no longer shows pointer cursor; :focus-visible
  rings on chips/buttons/nav/search; aria-labels on both search inputs; About
  copy no longer says "local" proxy; directory empty-state spans the grid.
- Result bars stack on ≤620px (the 1fr track collapsed to 0 width on phones).

**Gotchas added/updated this session:**
- `npm run dev` now runs `server/dev.js` which pins the API to 3020 — the
  preview harness injects PORT into the whole script, which used to send
  Express to vite's port. `.claude/launch.json` gained a `hones-tea-dev`
  config (vite on 5173, HMR); the old `hones-tea` config still runs the prod
  server (serves dist/).
- `preview_screenshot` is **intermittent** on this machine (worked ~6 times,
  then timed out once) — not permanently broken as previously noted. Fall back
  to preview_eval/snapshot/inspect when it times out.
- The preview panel's native viewport is ~819px — under the app's 860px
  breakpoint, so the sidebar collapses and the footer hides. `preview_resize`
  to 1280 before judging desktop layout.

**Next steps:** Render manual deploy (see above). Roadmap: campaign finance
(Elections Canada financing CSVs — the reference app's flagship page) →
expenditures → demographics. Nice adds spotted during critique: turnout tile
(Table 11), in-app vote/bill detail pages, French toggle.

## 2026-07-05→06 — Deployed to production (Vercel + Render)

**What happened:** App went from "builds but no data anywhere" to fully live.
**Production: https://papineau.vercel.app** — verified end-to-end (341 MPs, votes,
bills through the proxy chain).

**Architecture of the deployment:**
- **Vercel** (team `vandelay` → project `papineau`, Hobby, user `reidlaird-3304`)
  builds the client on every push to `main` (Vite preset, all default settings —
  audited, correct) and serves `dist/` from its CDN. It does NOT run
  `server/index.js` — never port it to serverless; the disk cache + slow polite
  crawls are deliberate.
- **Render** (workspace "My Workspace", GitHub-OAuth sign-in) runs the Express API:
  Blueprint **papineau** (`exs-d95k7khoagis738ukhkg`) → web service **papineau**
  (`srv-d95k7u7avr4c73aghpp0`, free plan) at **https://papineau.onrender.com**,
  health check `/api/health`, `HONESTEA_CONTACT=reid.laird@live.ca`.
- **`vercel.json`** glues them: `/api/*` rewrites to papineau.onrender.com, rest
  falls back to `/index.html` (fixes react-router deep links). If the Render URL
  ever changes, update this file.
- Commit `2fd3704` did both config changes: added `vercel.json` and pinned
  `engines.node` to `24.x` (open `>=20` made Vercel warn about silent major
  auto-upgrades; 24 matches local v24.18.0 and both hosts; Vercel's dashboard Node
  setting is overridden by this field — keep it pinned).

**Deploy workflows (asymmetric — the thing to remember):**
- Client change → `git push` to `main`, done (Vercel auto-deploys ~20s; other
  branches get preview URLs). Already-deployed SHAs are skipped.
- Server change → push, then Render dashboard → service papineau → **Manual
  Deploy → Deploy latest commit**. No auto-deploy because the repo is connected by
  public URL (Render's GitHub App never installed). Installing the app ("Configure
  account" on Render's connect-repo page, GitHub consent screen — Reid must click)
  would make both halves auto-deploy. `render.yaml` edits DO sync automatically
  (blueprint-managed).

**Gotchas added this session:**
- Free Render instance spins down after ~15 idle min → first API call takes ~50s
  (looks like a hang through the Vercel proxy, then works). Fix when annoying:
  UptimeRobot ping to `/api/health` every 5 min (per render.yaml comments).
- `data/cache/` lives on Render's ephemeral disk — wiped each deploy/restart. Fine
  by design.
- Render dashboard sign-in is GitHub OAuth in Chrome; papineau.onrender.com
  answering plain "Not Found" + `x-render-routing: no-server` header means the
  service doesn't exist / isn't deployed (that's how the missing blueprint was
  diagnosed).

**Next steps (all optional):** UptimeRobot keep-warm; install Render GitHub App if
manual server deploys get old; custom domain; README still says "local tool" —
could add live URL + Deployment section; `render-deploy` branch (local+origin) is
merged — safe to delete. Feature roadmap unchanged (below).

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
