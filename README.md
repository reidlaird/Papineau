# HonesTea 🍵

**Spilling the tea on Canadian politics — from public records only.**

🔗 **Live at [papineau.vercel.app](https://papineau.vercel.app)**

A dashboard for Canadian Members of Parliament: who they are, how they vote,
what they sponsor, and (eventually) how their campaigns are financed and what they
disclose. Inspired by *Article One*, a US congressional-records app; HonesTea is the
Canadian steep.

## Quick start (local)

```
npm install
npm run build
npm start        # serves everything on http://localhost:3020
```

Development (Vite hot reload on :5173, API on :3020):

```
npm run dev
```

## What works today

- **MP directory** — all sitting MPs (45th Parliament), searchable by name/riding,
  filterable by party, with photos.
- **MP profiles** — party, riding, MP-since, recent recorded votes (with the House
  result and yea/nay split), sponsored bills (linked to LEGISinfo), career timeline,
  contact info and constituency offices, and their statistically most-said word in
  Hansard.
- **My rep** — type your postal code and the issue that's bugging you: finds your
  riding and MP (via the Represent API's postal-code concordance), searches the
  current session's divisions and bills for that issue, and shows how your MP voted
  side-by-side with the MPs of every adjacent riding (boundary `touches` query) —
  including a "voted the same as your MP" agreement tally. Bill numbers (`C-26`)
  work as queries too.
- **House votes** — the latest recorded divisions.
- **Bills** — the most recently introduced bills.
- Every profile links out to the member's official records (ourcommons.ca page,
  expenditure disclosures, Elections Canada, ethics registry, lobbying registry).

## Architecture

```
server/index.js   Express on :3020 — proxies api.openparliament.ca and
                  represent.opennorth.ca, reshapes JSON, caches every upstream
                  response to data/cache/ (6h TTL), serves dist/
client/           React 18 + Vite SPA (react-router)
```

The cache keeps traffic to the volunteer-run OpenParliament API minimal and makes
repeat page loads instant. Upstream 429/5xx responses are retried with backoff, and
per-ballot vote lookups run sequentially for the same reason. Optionally set
`HONESTEA_CONTACT=you@example.com` so the User-Agent identifies you to the API.

**Production** runs the same two pieces split across hosts: the client is served by
[Vercel](https://papineau.vercel.app) and the Express API runs on Render
(`papineau.onrender.com`), with `vercel.json` rewriting `/api/*` to Render and
everything else to the SPA. The Render free tier sleeps when idle, so the first
request after a quiet spell can take ~a minute to wake up.

## Data source map (US reference app → Canadian equivalent)

| Section | Canadian source | Status |
|---|---|---|
| Member directory / profiles | [OpenParliament API](https://api.openparliament.ca/) | ✅ live |
| Find-your-rep + neighbouring ridings | [Represent API](https://represent.opennorth.ca/) (Open North) | ✅ live |
| Floor activity (roll-call votes) | OpenParliament (House divisions) | ✅ live |
| Sponsored bills | OpenParliament + [LEGISinfo](https://www.parl.ca/legisinfo/en/bills) links | ✅ live |
| Campaign finance | [Elections Canada political financing database](https://www.elections.ca/WPAPPS/WPF/EN/Home/Index) (CSV exports) | 🔜 planned |
| Personal finances / ethics | [Conflict of Interest & Ethics Commissioner registry](https://ciec-ccie.parl.gc.ca/) | 🔜 planned |
| Lobbying ("who's calling") | [Registry of Lobbyists](https://lobbycanada.gc.ca/) open data | 🔜 planned |
| MRA spending → Members' expenditures | [House proactive disclosure](https://www.ourcommons.ca/proactivedisclosure/en/members) (quarterly CSV) | 🔜 planned |
| District demographics | StatCan census profiles by federal electoral district | 🔜 planned |
| Election results & margin trend | Elections Canada official results (CSV) | 🔜 planned |

## Roadmap ideas

1. **Elections section** — riding-level results + margin trend from Elections Canada
   official-results CSVs (one-time download into `data/`).
2. **Campaign finance** — parse candidate/EDA returns; receipts-by-size breakdown and
   top-vendor table like the reference app.
3. **Expenditures** — quarterly Members' Expenditure Report CSVs; category breakdown.
4. **Lobbying watch** — registered communications naming the member's office.
5. Riding demographics from the census profile API; French UI toggle (`name.fr` is
   already in the data).

Parliamentary data © House of Commons, made usable by
[openparliament.ca](https://openparliament.ca). This is a personal,
read-only tool.
