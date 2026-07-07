# HANDOFF

## 2026-07-07 — Ethics artifact first run ✅ (PR #9, deployed)

The resume-here item is done: first real `scripts/build-ethics.mjs` run from
Reid's machine (8,399 declarations, 2,069 declarants, 160 KB gz), artifact
committed, About/README flipped to live, Render deployed, prod verified
(May 20 ✓ card renders, Joly 56 with accents intact ✓, Fanjoy 1 ✓ — all
exact against manual registry `searchTerm` counts).

**Scraper fixes the probe surfaced (now in the script):**
- Declarant name comes from each card's `/en/client?clientId=` anchor — the
  text-scan fallback bled label words into Gifts rows ("Other Advantages
  Bahoz Dara Aziz").
- PDF "View attachment" links are excluded from row detection (they matched
  `/declaration…` and phantom-inflated the row count).
- Row date prefers the footer's "Disclosed on YYYY-MM-DD" — free-text gift
  descriptions contain earlier dates that DATE_RE matched first.
- `decodeEntities` now handles hex entities (`&#xE7;`) — French names were
  corrupting and breaking `norm()` matching (Champagne, Joly…).

**Refresh drill (occasionally through the Parliament):** `node
scripts/build-ethics.mjs` → sanity gates → commit the .gz via PR. Snapshot
only — departed members vanish from the registry. No JSON API surfaced in
the page source (probe checks each run).

**Remaining roadmap:** French toggle (needs Reid's product calls: default
language, URL vs setting, chrome-only vs data), in-app vote/bill pages.

## 2026-07-07 — Ethics / personal finances (last data-source-map feature)

**What happened:** The final 🔜 row of the data source map shipped as code:
**"Ethics & personal finances" card (#ethics)** on MP profiles, fed by the
Ethics Commissioner's public registry via the offline-artifact pattern
(`scripts/build-ethics.mjs` → `data/ethics/mp-declarations.json.gz` →
`/api/ethics?mp=` → EthicsCard). Branch
`claude/personal-finances-ethics-pfxo03`, PR opened.

**⚠ The artifact is NOT committed yet — this session couldn't reach the
registry at all.** The sandbox's egress policy 403'd every parl.gc.ca /
elections.ca / openparliament host (only GitHub + package registries were
allowed; even WebFetch was blocked). So, deliberately:
- `/api/ethics` answers `{ pending: true }` while the artifact file is absent,
  and the card renders a useful pending state: a deep link to
  `ciec-ccie.parl.gc.ca/en/public-registry?searchTerm=<member name>` (that
  query param is real — see below). Prod can ship this safely today.
- **Next session with network (or Reid locally):** run
  `node scripts/build-ethics.mjs --probe`, eyeball
  `data/ethics/probe-page1.html`, adjust `extractRows()` if needed, then the
  full build + commit the artifact. The script refuses to write garbage
  (sanity gates on name/date coverage and row count vs the advertised total).

**Scraping research (via search-engine snippets only — encode-worthy):**
- The registry has NO bulk export. The current front end is
  `https://ciec-ccie.parl.gc.ca/en/public-registry` with plain query params:
  `page`, `searchTerm`, `declarationType=<guid>`, `declarationReportType`,
  `affiliationRole`, `declarationStatus`, `disclosureFrom/To`,
  `sortBy=declarationDisclosureDate`, `sortDir`. ~8,398 declarations / 280
  pages (30/page) as of 2026-07. Type-filter GUIDs are Dataverse-style and
  unknown — the script fetches unfiltered and reads type labels off the rows.
- The legacy SharePoint host still serves declaration details:
  `prciec-rpccie.parl.gc.ca/EN/PublicRegistries/Pages/Declaration.aspx?DeclarationID=<guid>`
  (+ PDF attachments under `/Lists/Declarations/`). Row links may point there.
- Registry lists CURRENT members/office holders only — departed people are
  removed, so the artifact is a snapshot, and card copy says so.
- The parser has three strategies (embedded JSON state → detail-link
  segmentation → table rows); all were unit-tested against synthetic HTML in
  both fields-before-link and fields-after-link directions (a fixed-width
  context window bled neighbouring rows' names/dates — segmentation is
  strictly link-to-link now). `--probe` also dumps any `/api/...` paths seen
  in the page source in case the front end has a JSON API worth using instead.

**Verified this session (fixture artifact + seeded openparliament cache +
Playwright on the bundled Chromium):** pending state, populated card (headline
count, by-type bars, latest-declarations links), exact + first/last fallback
name match (`Elizabeth May` ↔ artifact `Elizabeth E. May`), no-match copy,
`mp required` 400, and ENOENT→pending→artifact-appears recovery without a
restart. `npm run build` clean. Stale "integration planned" tags removed from
the profile's Public-records links (lobbying was long live); ethics About row
now "pending data".

**After artifact lands:** flip About row + README to live, Render Manual
Deploy (server change!), prod verify. Remaining roadmap after that: French
toggle (needs Reid's product calls), in-app vote/bill pages.

## 2026-07-06 (overnight loop, ~02:00) — Turnout on election blocks

Small one: each election block's meta line now shows **turnout % and electors**
from Elections Canada **Table 11** (same directory as Table 12; identical
columns 2015–2025: electors col 4, turnout col 11). Merged into
`getElectionData` as enhancement-only (an election still renders if Table 11 is
missing). Verified against raw values (Avalon GE45 66.9% of 70,859 ✓).
Branch `turnout-tile`, PR opened. Render deploy needed after merge (server
change). **Remaining idea queue after this: French toggle (needs Reid's
product calls: default language, URL vs setting, chrome-only vs data), ethics
registry (no bulk export — scraping research), in-app vote/bill pages.**

## 2026-07-06 (overnight loop, ~01:40) — Registered lobbying on MP profiles

**What happened:** **"Registered lobbying of this office" card (#lobbying)** —
Registry of Lobbyists monthly communication reports, offline-artifact pattern
(654 KB gz: 8,622 House-of-Commons DPOH names, 373,678 communications with
11,115 amended reports deduplicated via PREV_COMLOG_ID chains). Branch
`lobby-watch`, PR opened.

**Gotchas (all encoded in scripts/build-lobbying.mjs header):**
- lobbycanada.gc.ca's WAF rejects curl AND PowerShell — **Node fetch with a
  browser User-Agent works** (that's how the 23 MB zip must be fetched).
- The CSVs are **Windows-1252, not UTF-8** — decode latin1 or French names
  corrupt and norm() matching breaks.
- DPOH titles are unusable as a filter ("MP" / "Member of Parliament" /
  "Député" / typo "Parliment" / parliamentary-secretary titles) — filter on
  INSTITUTION ~ /house of commons/i and match by member NAME server-side
  (exact norm, then matchCampaign first/last fallback).
- Face-validity checks: E. May 869 comms (top: David Suzuki Foundation),
  Poilievre 385, M. Michel 31 (top: Canadian Medical Association).

**After merge:** Render Manual Deploy (artifact + route), prod verify.
Remaining roadmap idea: French toggle. Nice-to-haves: turnout tile, in-app
vote/bill pages, ethics registry (no bulk export — needs scraping research).

## 2026-07-06 (overnight loop, later still) — Riding war chests (EDA finance)

**What happened:** First post-roadmap feature, via the new **branch + PR
workflow** (branch `eda-finance`): **"Riding war chests" card on `/mp/:slug`
(#warchest)** — each riding association's reported fundraising per fiscal year
since 2015, from the EDA slice of the same Elections Canada contributions dump.

**Data findings that shape the code (probe: `scripts/probe-eda.mjs`):**
- The Form-ID "versions" (20081, 20081v2…) are FORM-ERA revisions, not
  amendments: one version per (association, year), report parts never overlap
  within a return → plain summation is safe. (The initial inspect looked like
  74% of returns were amended — that was the assoc|event key collapsing all
  years of "Annual" returns together. Probe before trusting inspect keys.)
- **Fiscal 2019 is entirely absent from EC's dump**; 2020 is thin, 2024 is
  landing. The attribution says so; don't "fix" gap years.
- Association name arrives in the recipient LAST-NAME column; party comes as a
  full registered name (same `shortParty` mapping as candidates).
- `build-finance.mjs --entity associations` writes
  `data/finance/eda-contributions.json.gz` (46 KB, 341 ridings, 3,978
  association-years). Verified against probe ground truth (Papineau LPC 2016
  $111,471 / 2017 $11,538 / 2018 $11,334 exact; 2015 riding total $241,961 =
  LPC $239k + minor assocs).
- `/api/eda?riding=` → `{ riding, built, years: [{year, total, assocs[]}] }`.

**Status:** verified locally (card renders 5 Papineau fiscal years, console
clean); committed to `eda-finance`, PR open. **After merge: Render Manual
Deploy** (artifact + server change), then prod verify.

## 2026-07-06 (overnight loop, later) — Riding demographics on MP profiles

**What happened:** Roadmap #4 shipped by the same loop session: **"District
profile" card on `/mp/:slug` (#district)** — 8 census stats for the member's
riding with province + Canada comparators. That completes the original
four-item feature roadmap from the initial build.

**⚠ Server changed → Render deploy** (same drill; check the memory note for
whether this session already drove it).

**New feature — demographics (`server/index.js` + Profile.jsx):**
- Data: StatCan **2021 Census Profile SDMX web data service**, one small CSV per
  geography: `api.statcan.gc.ca/census-recensement/profile/sdmx/rest/data/
  STC_CP,DF_FED/A5.<dguid>.1.<charIds +-joined>.?format=csv`. FED dguid =
  `2023A0004` + 5-digit FED code; Canada (`2021A000011124`) and provinces
  (`2021A0002` + 2-digit) ride the `DF_PR` flow.
- ⚠ **Node fetch 500s StatCan by default**: undici sends `Accept-Language: *`
  and their language-tag parser rejects the wildcard (error body
  "languageTag1"). `cachedGet` now always sends `Accept-Language: en` —
  that fix is global and deliberate.
- ⚠ Chars 1–7 (Population & dwellings block) are EMPTY for 2023-order FEDs —
  population comes from the age-table total (char 8).
- Characteristic ids are pinned in `CENSUS_CHARS` and were value-verified
  against a labeled export (don't trust profile row order — it drifts from the
  SDMX codelist; the codelist's Bachelor's label uses a curly apostrophe).
- Riding name → FED code via Represent boundary set
  `federal-electoral-districts-2023-representation-order` (the unsuffixed set
  is the OLD 2013 order — 338 districts, wrong).
- `/api/demographics?riding=` → `{ riding, fedCode, values, canada, province }`,
  memoized + 90d CSV cache. Unknown riding → `values: null` → muted empty state.
- Verified: Papineau (110,810 pop, 72.1% renters vs QC 39.9%, $57,200 income vs
  QC $72,500), comparators exact, empty state, no console errors. Population
  row deliberately shows no comparator (riding-vs-province population is noise).

**Next steps:** Render deploy if not done. Original roadmap complete — remaining
ideas: EDA/riding-association finance, lobbying registry, turnout tile, in-app
vote/bill pages, French toggle.

## 2026-07-06 (overnight loop) — Members' expenditures on MP profiles

**What happened:** Roadmap #3 shipped by the /loop session that was watching the
finance build: **"Office & travel spending" card on `/mp/:slug` (#expenditures)**
from the House of Commons quarterly Members' Expenditures Reports. Also fixed the
About table (Campaign finance and Members' expenditures now "live" — finance was
left "planned" by the previous session) and contained `.margin-trend` overflow
(12-quarter trends forced horizontal page scroll on phones; now the strip itself
scrolls, cols `flex-shrink: 0`).

**⚠ Server changed → needs Render deploy** (unless this session already drove it
via Chrome — check the memory index note / Render dashboard for the deployed SHA).
Until then prod shows the spending card's empty state — graceful, same as the
elections rollout.

**New feature — expenditures (`server/index.js` + Profile.jsx):**
- Data: ourcommons.ca proactive disclosure, quarterly since FY2021 Q2 (Jul 2020).
  CSV per quarter: `Name,Constituency,Caucus,Salaries,Travel,Hospitality,Contracts`.
- ⚠ The `/csv` route wants a per-report GUID that ONLY appears on the quarter's
  own page — the quarter's summaryId returns 500 on /csv. Flow: landing page
  (regex quarter links, TTL 1d) → quarter page (TTL 30d) → csv (TTL 30d), all
  through `cachedGet`. `getExpQuarters` / `getExpQuarter` memoized.
- Names arrive "Last,  First" with honorifics ("Alghabra, Hon. Omar"), double
  spaces, literal "Vacant" rows; `flipMemberName` normalizes, `matchCampaign`
  (shared with finance) matches the profile MP. Departed MPs keep trailing rows
  (Alghabra had $21.44 in FY2026Q4) — that's why matching is by name, not riding.
- `/api/expenditures/quarters` → newest-first list; `/api/expenditures?fy&q&riding&mp`
  → `{ mine, others[], house: {median, reporting} }`. Median is over all
  non-Vacant rows with total > 0 (includes small trailing rows — framed as
  "N members reporting" in the UI).
- Client walks quarters newest→oldest sequentially (politeness + Render's
  ephemeral cache; card fills progressively like MyRep's ballot table). Stop
  rules: 2 consecutive non-matches after a match (predecessor territory), or 6
  straight misses with none matched. Trend chart capped at 12 quarters; detail
  blocks show newest 4 with "Show all N quarters" toggle. Verified: Elizabeth
  May 23/23 quarters, Bruce Fanjoy exactly his 4 (stop-early confirmed), Carleton
  FY2025Q3 correctly attributes to Poilievre in `others`.
- Sidebar anchor "Spending"; sources list tag removed.

**Gotchas this session:**
- Two Claude sessions ran concurrently overnight (finance + this loop). Protocol
  that worked: check `list_sessions` + transcript mtimes before editing, wait for
  the peer's commit (monitor on `git log` + clean tree), read-only prep meanwhile.
- The peer's dev servers held 3020 AND 5173; `server/dev.js` pins 3020 so dev
  mode would have crashed the API while vite proxied to the peer's OLD server —
  verify server changes with `npm run build` + the `hones-tea` launch config
  (autoPort) instead when ports are contested.
- `preview_screenshot` flaked again (2× timeout after working earlier) —
  eval/snapshot/inspect fallback per existing note.

**Next steps:** Render deploy if not already done. Roadmap: riding demographics
(StatCan census profiles) is #4. Turnout tile, in-app vote/bill pages, French
toggle still queued from the critique.

## 2026-07-06 — Campaign finance (roadmap #2)

**What happened:** Roadmap item #2 shipped: **Campaign finance section on MP
profiles** (`#finance` card + sidebar anchor) from Elections Canada's audited
contributions open data. README refreshed (Elections + finance now ✅ in the
data-source map; roadmap renumbered).

**⚠ Server changed → needs Render Manual Deploy** (dashboard → service papineau →
Manual Deploy → Deploy latest commit). Vercel picks the client up on push. Until
then prod profiles show the finance card with its "no returns" empty message
(old server 404s /api/finance → getJSON throws → client catch sets events: []).

**Architecture — the important decision:** the source
(`od_cntrbtn_audt_e.zip`, the "as reviewed" contributions dataset, updated
weekly) is a 115 MB zip holding one 2.2 GB CSV — every contribution to every
entity since 2004. Render free tier (0.1 CPU, disk wiped per spin-down) can't
chew that per boot, so `scripts/build-finance.mjs` pre-aggregates offline and
the artifact is **committed**: `data/finance/candidate-contributions.json.gz`
(105 KB gz; Candidates entity, events ≥2015 = GE42–45 + 18 by-elections, 2,967
campaigns). Refresh = `node scripts/build-finance.mjs` (downloads the zip to
data/finance/, gitignored) + commit. Worth re-running occasionally through
~2027: **GE45 returns are still being audited** (GE45 has 3,978 rows vs GE42's
19,681 — that's audit lag, not a bug; the UI carries a caveat).

**What --inspect established about the dump** (also in the script header):
one report part only ("Statement of Contributions Received"), contributor type
always Individuals, zero returns with >1 Form ID (no amendment double-counting),
blank-name rows all $0.00. **The data is ITEMIZED contributions only** — the Act
requires itemizing gifts over $200, so totals ≠ all money raised; UI copy says
so. Candidate-level totals are small vs US intuitions (Singh GE43: $30!) because
Canadian small-dollar fundraising is central-party/EDA — that's real, not a
parse bug (verified: independent row-recount of Poilievre GE44 = $20,321/25 rows,
exact artifact match).

**Server:** `/api/finance?riding=<name>&mp=<name>` → riding-scoped like
/api/elections (norm-matched key), events newest-first with all campaigns'
field totals + `top` 3, and `mine` = the MP's campaign matched by norm name
(fallback: same last name + compatible first token — EC uses "SMITH, Bob J"-ish
variants). MP who ran elsewhere earlier simply doesn't match those events.
Artifact loaded lazily via memoAsync + gunzipSync.

**Client:** `FinanceCard` in Profile.jsx mirrors ElectionsCard's grammar —
margin-trend columns reused for per-election $ trend (party colour), per-event
blocks with receipts-by-size bars (edges 250/500/1000), meta line (field share,
home-province %, in-kind), muted note listing events with data but no matching
return, and a top-campaigns fallback when nothing matches (e.g. Poilievre in
Battle River—Crowfoot: shows Kurek's GE45 return — correct, he arrived by
by-election and that return isn't audited yet). New CSS: .fin-headline,
.fin-total, .fin-headline-meta, .fin-missing.

**Verified in preview:** May (1 matched GE + missing-events note), Kwan (trend +
2 blocks, field share 54%, 68% from BC), Boulerice (accents/em-dash riding, 3
GEs), Poilievre (fallback path). Mobile ≤620px stacking inherited from
.result-row reuse. `npm run build` clean. preview_screenshot timed out both
tries this session (eval/snapshot/inspect all fine — the flakiness is real).

**Gotchas:**
- The build script's zip parsing is minimal (single deflate entry, header
  skipped by hand) — if EC ever re-packs the dump as multi-file zip it needs
  yauzl or similar.
- `od_cntrbtn_de_e.zip` is the "as submitted" twin (158 MB) — we deliberately
  use "as reviewed" (`_audt_`).
- WebFetch/WebSearch tooling 529'd repeatedly this session; curl straight to
  elections.ca worked fine (their pages are plain ASP.NET HTML, grep-able).

**Next steps:** Render manual deploy. Roadmap: expenditures (ourcommons
quarterly CSVs) → riding-association finance (same dump, EDA entity) →
demographics. The finance card could later gain: contributions-by-month within
the writ period (received-date is in the dump but not aggregated), and a
directory-level "biggest war chests" page.

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
