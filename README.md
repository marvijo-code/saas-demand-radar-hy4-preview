# SaaS Demand Radar - HY4 Preview implementation

This repository is the HY4 Preview implementation from a controlled model comparison.
It is published as a standalone source artifact. It does not include model transcripts,
credentials, local databases, recordings, build output, or operator workspace paths.

Discover which software-as-a-service products people are **publicly asking for** right now on
X and Reddit.

The product ingests public source records, classifies demand language, groups related evidence
into *SaaS needs*, scores those needs with an explainable model, and learns from reviewer
feedback. Every number in the interface comes from persisted data — when no source records have
been ingested, the product shows a real empty state instead of demo content.

---

## Quick start

```bash
npm start
```

That one command installs dependencies, migrates and seeds SQLite, builds the web bundle if it
is stale, and starts both servers:

| Surface | URL |
| --- | --- |
| Web app | <http://127.0.0.1:4173> |
| API | <http://127.0.0.1:4174/api/health> |

Sign in with one of the deterministic seeded accounts:

| Account | Password | Workspace | Role |
| --- | --- | --- | --- |
| `admin@acme.test` | `AcmeAdmin!2026` | Acme Growth | Admin |
| `member@acme.test` | `AcmeMember!2026` | Acme Growth | Member |
| `admin@beta.test` | `BetaAdmin!2026` | Beta Labs | Admin |

The first two accounts share one workspace; the third belongs to a separate tenant with fully
isolated data.

```bash
npm run dev     # Vite dev server with hot reload + API with --watch-friendly logging
npm run stop    # stop whatever is listening on ports 4173 and 4174
```

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | install → migrate → seed → build (if stale) → serve web:4173 and api:4174 |
| `npm run dev` | Vite dev server on 4173 proxying `/api` to the API on 4174 |
| `npm run stop` | stop the processes holding ports 4173/4174 |
| `npm run build` | build the web bundle into `apps/web/dist` |
| `npm run migrate` | apply pending migrations and re-seed the accounts |
| `npm run db:reset` | drop every table, then migrate and seed again |
| `npm run seed` | seed the deterministic accounts |
| `npm run typecheck` / `npm run lint` | `tsc --noEmit` over shared, api and web (including tests) |
| `npm test` | unit + API + browser suites |
| `npm run test:unit` | shared package unit tests (`node --test`) |
| `npm run test:api` | API integration tests (`node --test`, temporary SQLite file) |
| `npm run test:browser` | Playwright flows against the real build (mobile + desktop) |

`test:browser` boots the product on ports **4273/4274** so it never collides with
`npm start`. Each suite can also be run on its own:

```bash
node scripts/test-browser.mjs --project=desktop --grep "review feedback"
```

---

## Architecture

```
packages/shared      pure, dependency-free domain logic (types, tokens, classifier,
                     clustering, scoring, time windows) — used by the API, the web app
                     and the tests so all three agree byte for byte
apps/api             Express 4 + TypeScript API, SQLite (node:sqlite) persistence,
                     ingestion pipeline, ranking/learning pipeline, scheduler
apps/web             React 18 + TypeScript SPA (Vite), served by a tiny zero-dependency
                     static server that proxies /api to the API
scripts              start / dev / stop / build / typecheck / test runners
```

### Request path

```
browser ──► web server :4173 ──static assets──► apps/web/dist
        └─► /api/*  ──proxied (cookies + body + headers)──► api :4174
                                                            │
                                                   Express app
                                                   ├─ attachSession (HTTP-only cookie)
                                                   ├─ rate limits (read / mutation / login)
                                                   ├─ origin check for state changes
                                                   └─ routes
```

`/api` is proxied by the web server so the session cookie stays **first-party**: the browser
only ever talks to one origin, which means the `HttpOnly; SameSite=Lax` cookie works in
development and production without CORS preflights.

### Ingestion pipeline

1. An **adapter** returns raw records (`snapshot`, `x`, `reddit`).
2. `sources/normalize.ts` validates every record; failures are reported per record and never
   silently dropped.
3. `source_records` is upserted on `(workspace_id, platform, external_id)` — this single
   constraint is what makes ingestion **idempotent**.
4. `pipeline/derive.ts` re-classifies every record into `demand_signals`, regroups the records
   into `needs` with deterministic average-linkage clustering, and relinks `need_evidence`.
5. `pipeline/scoring.ts` scores and ranks every need for the current model version.
6. The run row is updated with counts, notes, per-record errors and the final status, and the
   outcome is written to the audit trail and the schedule settings.

Re-running the same snapshot reports `0 created, 0 updated, 0 new signals, 0 new needs`.

### Ranking and learning

A need's score is five normalised measurements combined with model weights:

```
score = (Σ weight_c × component_c) × 100
        × phraseMultiplier × sourceMultiplier × feedbackMultiplier
        + bonusPoints
```

| Component | What it measures |
| --- | --- |
| Frequency | `log2` of how many source records were grouped into the need |
| Recency | exponential decay of evidence age (half-life from the model weights) |
| Intent strength | confidence of the strongest buying-intent / tool-request phrases |
| Engagement | `log2` of total likes, comments, reposts and upvotes |
| Cross-source diversity | distinct platforms, authors and subreddits |

Feedback changes ranking in two ways:

* **Immediately.** Storing feedback recomputes the learned phrase and source weights
  (`+0.18` per relevant decision, `−0.25` per irrelevant one, clamped to `0.5 … 1.8`) and the
  feedback multiplier, so the needs list reflects the review on the next request.
* **As a version.** `POST /api/ranking/rescore` snapshots the weights into a new
  `ranking_models` row together with `changeSummary` and the ids of the feedback that caused
  it, and returns every rank and score change.

`GET /api/ranking/versions` shows what changed, when, who triggered it and which review caused
it. The feedback screen marks each review with the versions it was applied in and how many
reviews are still pending.

### Roles

`apps/api/src/auth/adminOnly.ts` holds **one** list of Admin-only mutations. The guard is
applied centrally in `createApp()`, so a new state-changing route can never silently become
available to Members — if it should be Admin-only it is registered in that list, and if it is
not listed it stays open.

| Mutation | Admin | Member |
| --- | --- | --- |
| `POST /api/sources/ingest` | ✅ | ❌ 403 |
| `POST /api/source-runs/:id/retry` | ✅ | ❌ 403 |
| `PUT /api/settings/schedule` | ✅ | ❌ 403 |
| `POST /api/ranking/rescore` (cut a model version) | ✅ | ❌ 403 |
| `PUT /api/team/name`, `POST|PATCH|DELETE /api/team/members[/:id]` | ✅ | ❌ 403 |
| `POST /api/needs/:id/feedback` | ✅ | ✅ |
| `POST /api/needs/:id/evidence/:recordId/feedback` | ✅ | ✅ |
| `PATCH /api/needs/:id/status` | ✅ | ✅ |
| every `GET` route | ✅ | ✅ |

The split is deliberate: an Admin owns anything that changes data or configuration for the
*whole workspace*, while both roles can record their own review, because that is the
collaboration the product exists for. Members still get the full learning effect — feedback
updates the weights immediately — only cutting an official model version is Admin-only.
Anonymous callers get `401` on every one of these mutations, Members get `403`.

The interface mirrors this: the ingestion buttons, the schedule form and the "Re-score and
create version" button are only rendered for Admins, and the screen says why.

### Accessibility and responsiveness

* Landmarks (`banner`, `navigation`, `main`, `contentinfo`), labelled form controls, visible
  focus rings, and a skip link.
* Every page sets a descriptive `document.title`.
* No horizontal overflow at **390 × 844** and **1440 × 900**, asserted on every route.
* Every visible interactive control — buttons, links, inputs, selects, textareas and anything
  with `role="button"` — is at least **44 px** tall at 390 × 844, on every required route
  including `/login` and `/needs/:id`. The browser suite scans them all and fails with the
  offending selector and measured height.

---

## Data model

| Table | Purpose |
| --- | --- |
| `workspaces` | tenant (`ws_acme`, `ws_beta`) |
| `users` | email, scrypt password hash, role (`admin` / `member`), workspace |
| `sessions` | opaque session tokens; only a SHA-256 hash is stored |
| `source_records` | one row per public post, unique on `(workspace, platform, external_id)` |
| `demand_signals` | one classified signal per `(record, kind, matched phrase)` |
| `needs` | grouped SaaS need, keyed by its representative record |
| `need_evidence` | links a need to the source records behind it |
| `need_scores` | score, rank and full explanation per `(need, model version)` |
| `feedback` | reviewer decision on a need or on a single piece of evidence |
| `ranking_models` | versioned weights, phrase/source weights, change summary, feedback provenance |
| `phrase_weights` / `source_weights` | current learned multipliers (neutral = 1.0) |
| `source_runs` / `source_run_errors` | ingestion history, counts, notes, per-record errors |
| `schedule_settings` | enabled flag, interval, adapter, keywords, subreddits, last/next run, last error |
| `audit_events` | workspace-scoped trail of every meaningful action |
| `schema_migrations` | applied migration versions |

Migrations live in `apps/api/src/db/migrations/*.sql` and are applied in filename order.
Adding a file is enough — no code change is needed.

---

## Environment variables

Every variable has a working default; the product runs with **no configuration at all**.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4174` | API port |
| `WEB_PORT` | `4173` | web port |
| `WEB_ORIGIN` | `http://127.0.0.1:4173` | allowed CORS origin for the web app |
| `API_ORIGIN` | `http://127.0.0.1:4174` | where the web server proxies `/api` |
| `SDR_CORS_ORIGINS` | `http://127.0.0.1:4173,http://localhost:4173` | comma-separated allow list |
| `SDR_DATABASE_PATH` | `data/signal-radar.sqlite` | SQLite file (created if missing) |
| `SDR_SNAPSHOT_PATH` | `source-snapshot.json` | snapshot used when `/ingest` sends no records |
| `SDR_MAX_INGEST_RECORDS` | `500` | maximum records accepted in one ingestion call |
| `SDR_SCHEDULER_ENABLED` | `true` | run scheduled ingestion inside the API process |
| `SDR_SCHEDULER_TICK_MS` | `30000` | scheduler tick |
| `SDR_HTTP_TIMEOUT_MS` | `8000` | timeout for live adapter HTTP calls |
| `SESSION_TTL_HOURS` | `12` | session lifetime |
| `NODE_ENV` | `development` | `production` marks the session cookie `Secure` |
| `RATE_LOGIN_MAX` / `RATE_LOGIN_WINDOW_MS` | `10` / `900000` | sign-in rate limit |
| `RATE_MUTATION_MAX` / `RATE_MUTATION_WINDOW_MS` | `120` / `60000` | POST/PUT/PATCH/DELETE limit |
| `RATE_READ_MAX` / `RATE_READ_WINDOW_MS` | `600` / `60000` | read limit |
| `X_BEARER_TOKEN` | – | X API bearer token (paid; adapter stays inert without it) |
| `X_SEARCH_QUERY` | see `config.ts` | X recent-search query |
| `X_MAX_RESULTS` | `25` | X page size |
| `REDDIT_USER_AGENT` | `saas-demand-radar/1.0` | required by Reddit's public JSON API |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | – | optional OAuth app for higher rate limits |
| `REDDIT_SUBREDDITS` | `SaaS,Entrepreneur,smallbusiness` | search scope |
| `REDDIT_QUERY` | see `config.ts` | Reddit search query |
| `REDDIT_MAX_RESULTS` | `25` | Reddit page size |
| `VITE_API_BASE_URL` | `/api` | only needed if the API is not proxied by the web server |

No secret is ever sent to the browser: the web bundle only contains `VITE_API_BASE_URL`, and
session tokens stay inside an HTTP-only cookie.

---

## Source adapters and their limits

Adapters are replaceable and live behind one interface
(`apps/api/src/sources/types.ts`). Adding credentials later needs no change to ingestion,
grouping or scoring.

### `snapshot` — deterministic (no credentials)

Reads `source-snapshot.json` or the `records` array sent in the request body. This is the
adapter used by the acceptance suite and local development: the output is byte-for-byte
reproducible, needs no network access and invents nothing.

### `x` — X recent search (paid credential)

* Requires `X_BEARER_TOKEN` from a paid X API project. **Without it the adapter is inactive**
  and `POST /api/sources/ingest` answers `503` with a hint instead of fabricating posts.
* Recent search only covers the **last 7 days** of public posts, not full history.
* Rate limited by X (basic tiers are typically 180 requests / 15 minutes).
* Only public posts are read; no private account data is requested.

### `reddit` — Reddit search (works without credentials)

* Reddit's public JSON search endpoint needs no credentials — only a descriptive
  `User-Agent`. With `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` it switches to the OAuth
  endpoint for higher rate limits.
* Public search is rate limited per IP by Reddit.
* Search relevance ordering means some older matches may be missed between runs.
* Only public posts are returned; deleted or quarantined posts are not.

A failed run is always visible: `GET /api/source-runs` shows the status, the duration, the per
record errors, the adapter error and the scheduled retry time.

---

## API

All routes are JSON and workspace-scoped. Sign-in sets the `sdr_session` HTTP-only cookie.

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | `{ "status": "ok" }` plus version and environment |
| `GET` | `/api/capabilities` | adapters, windows, sorts, statuses |
| `POST` | `/api/auth/login` | `{ email, password }` → user + workspace, sets the cookie |
| `POST` | `/api/auth/logout` | destroys the session |
| `GET` | `/api/auth/me` | signed-in user, workspace and members |
| `POST` | `/api/sources/ingest` | `{ adapter, records?, snapshotPath?, keywords?, subreddits? }` |
| `GET` | `/api/sources/adapters` | adapter readiness and limits |
| `GET` | `/api/source-runs` | ingestion history, last success, schedule summary |
| `GET` | `/api/source-runs/:id` | one run with notes and errors |
| `POST` | `/api/source-runs/:id/retry` | re-runs a previous ingestion |
| `GET` | `/api/needs` | `window`, `search`, `platform`, `status`, `sort`, `page`, `pageSize`, `now` |
| `GET` | `/api/needs/:id` | need, evidence, score explanation, trend, score history, feedback |
| `PATCH` | `/api/needs/:id/status` | `new` / `reviewing` / `validated` / `dismissed` |
| `POST` | `/api/needs/:id/feedback` | `{ relevant, willingnessToPay, contacted, note }` |
| `POST` | `/api/needs/:id/evidence/:recordId/feedback` | review a single piece of evidence |
| `GET` | `/api/needs/evidence/all` | every stored source record |
| `POST` | `/api/ranking/rescore` | new model version; returns changed ranks and scores |
| `GET` | `/api/ranking/versions` | version history with feedback provenance |
| `GET` / `PUT` | `/api/settings/schedule` | scheduled-ingestion settings |
| `GET` | `/api/audit` | workspace audit trail (`action`, `limit`) |
| `GET` | `/api/overview` | dashboard summary |
| `GET` | `/api/feedback` | reviews, learned weights, applied versions, pending count |
| `GET` / `PUT` | `/api/team`, `/api/team/name` | workspace and members (admin) |
| `POST` / `PATCH` / `DELETE` | `/api/team/members[/:id]` | admin-only membership management |

`now=<ISO date>` pins the clock for window filtering so time-window behaviour is testable
without waiting.

---

## Tests

```bash
npm test                 # everything
npm run test:unit        # 40 pure-domain tests (tokens, classifier, clustering, scoring, windows)
npm run test:api         # 83 HTTP integration tests (auth, ingestion, needs, learning,
                         # isolation, roles, settings, audit, scheduler, rate limiting, passwords)
npm run test:browser     # 48 Playwright flows × { mobile 390×844, desktop 1440×900 } = 96 runs
```

Test data is deterministic:

* the **only** corpus is the six public records in `source-snapshot.json`;
* API tests run against a fresh temporary SQLite file per test file;
* browser tests seed that same snapshot into the Acme workspace and leave Beta empty;
* no test invents product data, and no test requires a paid credential.

The browser suite asserts the contract surfaces by `data-testid`
(`app-shell`, `login-form`, `dashboard`, `needs-list`, `need-detail`, `source-runs`,
`feedback-learning`, `team-settings`, `audit-trail`), the responsive requirements, and the
accessibility basics.

## Security notes

* Passwords are hashed with **scrypt** and a per-user random salt; only the hash is stored.
* Sessions are opaque 32-byte tokens; the database stores only a SHA-256 hash, and the cookie
  is `HttpOnly`, `SameSite=Lax`, `Path=/` and `Secure` in production.
* Sign-in failures are constant-time and return one identical message whether or not the
  account exists.
* Rate limits are applied per user (per IP when anonymous) on reads, mutations and sign-in.
* State-changing requests carrying an `Origin` outside the allow list are rejected.
* Every read and write is filtered by the session's `workspace_id`, so cross-tenant access is
  impossible by construction.
* Source text is rendered as text only — React escapes it, so a post can never execute as HTML.
* `npm audit` is not part of the suite; dependencies are limited to Express, React, Vite and
  Playwright.
