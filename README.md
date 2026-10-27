# Sentinel

**Self-hosted job-search automation with a built-in security console.** Every morning it searches 5–8 job sources per person,
filters the ads, has an AI score each job against that person's CV, adds the new jobs to their Google Sheet and emails them a
ranked list. A local web console shows the job hunt *and* the health and security of the whole setup, backed by a 34-test red-team suite.

Runs on one Windows laptop with free tools only: [n8n](https://n8n.io) (self-hosted), the Gemini API free tier, Google Sheets/Gmail
and Windows Task Scheduler. No cloud server, no paid service.

**Status:** in daily use since October 2026 by 3 people (Germany, UK/EU, Netherlands/Sweden/UAE/India searches), 2 more joining.

![Today: the best open jobs, in the order to apply](docs/screenshots/today.png)

> All screenshots use the console's demo mode (`node redteam/server.js --demo`): fictional people, real public job ads.

## What it does

| Part | What it does |
|---|---|
| **Job finder** (`finder/`) | Per person: searches Careerjet, LinkedIn (guest API), national job boards (Bundesagentur, NHS Jobs, JobTech, EURES), remote boards and company career pages (Greenhouse, Ashby, SmartRecruiters, Recruitee, Teamtailor). Merges duplicates across sources, filters by title, country, age and required language, then scores every job with Gemini against the CV (skills, experience, domain, must-haves, hard blockers). The best matches get a second check by a stronger model. New jobs go into the person's Google Sheet; a ranked HTML email goes out. |
| **Daily sheet check** | Fills in "Applied On", flags a follow-up 7 days after applying, marks jobs whose ad is gone as Expired. |
| **Weekly summary** | Skills employers ask for most, the person's top gaps and free ways to close them. |
| **Sentinel console** (`redteam/`) | One local web page: today's mission (best jobs to apply to), application pipeline and streaks, market and skill gaps, delivery check (did every email go out, with Gmail receipts), open ports, login expiry, workflow integrity, and the red-team suite with a live log. |
| **Red-team suite** (`redteam/attacks.js`) | 34 tests run against the real code: prompt injection, XSS, formula injection, SSRF, ReDoS, command injection, sheet tampering, duplicate floods, AI outage, budget caps, secrets in git history, dependency advisories, file permissions, and live probes of the running services. |

| Delivery check (Overview) | Red team (Defence) |
|---|---|
| ![Overview](docs/screenshots/overview.png) | ![Defence](docs/screenshots/defence.png) |
| **Market & skills** | **Operations** |
| ![Market and skills](docs/screenshots/market.png) | ![Operations](docs/screenshots/ops.png) |

## How it works

```
Windows Task Scheduler (per person, wakes the laptop, hourly retries)
  └─ tools/daily.ps1 -Person <id>
       1. Google login pre-check (read-only)   → popup if a login expired, nothing written
       2. daily sheet check (no AI)            → Applied On, follow-ups, expired links
       3. job finder workflow (n8n CLI)        → fetch → merge/filter → Gemini score → recheck → sheet + email
       4. Sundays: weekly summary

finder/profiles/<person>.js ──build-workflows.js──▶ finder/workflows/<person>/*.json ──tools/host.js──▶ n8n
redteam/server.js (127.0.0.1:7777) ── reads the n8n database, logs, Task Scheduler, git ──▶ dashboard.html
```

- **Everything person-specific lives in one profile file** (countries, search words, title filters, sources, AI instructions, email text).
  The console and the tests pick up every file in `finder/profiles/` by themselves.
- **Code nodes are plain files** (`finder/src/*.js`, shared helpers in `finder/src/lib/`) that the build inlines into the n8n workflows,
  so they can be linted, tested and diffed. The red team checks that what runs in n8n is exactly the reviewed build.
- **AI budget:** jobs are scored 10 per call; caps per person keep the whole setup far below the free Gemini limits, with a fallback model and
  retries. If Gemini is down, no job is lost: unscored jobs are retried the next day.

## Security notes

- Job ads are treated as hostile input: text aimed at the AI is removed before scoring (several languages and look-alike letters), the AI's
  answer is validated, email HTML is escaped, sheet writes are RAW (no formulas), and links from the sheet are only opened if they are public web addresses.
- n8n and the console listen on 127.0.0.1 only. The console refuses foreign Host headers (DNS rebinding) and cross-site posts, and sends CSP / no-framing headers.
- No secrets in the repository: logins live encrypted in n8n; CVs, Drive ids and logs are git-ignored, and the suite scans the whole git history for secrets.
- Personal data is removed from the CV before it goes to Gemini (email, phone). Note: on the Gemini free tier Google may use what is sent to improve its products.

## Set up

Requirements: Windows 10/11, Node.js 24+, `npm install -g n8n`, a Google account, a free Gemini API key.

1. Start n8n (`start-n8n.bat`), open http://localhost:5678 and create credentials: Google Gemini API, Google Sheets, Google Docs, Google Drive, Gmail (OAuth2).
2. Copy `finder/profiles/alex.js` to `finder/profiles/<you>.js`, change the id, names, workflow ids and search; put your CV as text in `finder/<you>-cv.txt` (git-ignored) and set `cvFile`.
3. Test without touching anything live (emails only you, at most 10 jobs scored):
   `node tools/host.js --profile=<you> --to=you@example.com --test --max=10`
4. Go live (creates the Drive folder, sheet and CV doc, imports the workflows, formats the sheet):
   `node tools/host.js --profile=<you> --to=you@example.com`
5. Create a Windows task that runs `powershell -File tools\daily.ps1 -Person <you>` every morning (wake the computer, repeat hourly for a few hours).
6. Console: `node redteam/server.js`, then http://127.0.0.1:7777 (or double-click `tools/open-sentinel.vbs`). Security tests: `node redteam/run.js`.

Try the console without any setup: `node redteam/server.js --demo`.

## Repository

| Path | Contents |
|---|---|
| `finder/profiles/` | One file per person (two fictional examples: `alex.js`, `maria.js`; sample CVs in `finder/examples/`) |
| `finder/src/` | Code of each n8n Code node; `lib/` = shared helpers (job parsing, prompt-injection filter, link guard, scoring) |
| `finder/prompts/` | AI instructions (job scoring, weekly insights) |
| `finder/build-workflows.js` | Builds the n8n workflows from a profile + the code |
| `finder/test/harness.js` | Runs the finder's Code nodes against the live job sites without n8n, Google or AI |
| `tools/host.js` | Imports a person's workflows into n8n, creates their Drive files, `--test` mode |
| `tools/daily.ps1` | What the Windows task runs |
| `redteam/` | Console (`server.js`, `monitor.js`, `career.js`, `dashboard.html`) and the red-team suite (`attacks.js`, `engine.js`, `sim.js`, `run.js`) |

## License

MIT, see [LICENSE](LICENSE).
