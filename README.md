# Polls

A lightweight group polling tool for collective decisions — think movie night, book clubs, team lunches, anything where a group needs to converge on a choice without it turning into a 45-minute Slack thread.

Built on Cloudflare Workers (Hono) + D1 + Pages (React/Vite). Runs entirely on Cloudflare's free tier.

---

## How it works

Polls moves through three phases: **nominating → voting → closed**. An admin controls the transitions; participants join via a shared link. Here's the full flow:

**Creating a poll**

The creator picks a category (movies, books, TV, games, music, places, or a freeform custom category), a voting method, and an optional nomination deadline. After creation, they receive a unique admin URL — this is the only time the admin token is shown, so save it.

**Nominating**

Participants join by entering their name. Each person can nominate options up to the per-person limit set by the admin. Movie and book categories pull rich metadata (poster, author, year) automatically from TMDB and Google Books. The admin can optionally keep nominations hidden from participants until voting begins, which prevents anchoring bias.

**Voting**

The admin advances the poll to the voting phase. Depending on the voting method:

- **Plurality** — pick one. Highest vote count wins.
- **Ranked choice (Borda count)** — rank your options in order of preference. Points are awarded based on rank position and summed across all voters. Works well for groups up to ~20 people where you want preference depth without the complexity of elimination rounds.
- **Ranked pairs (Tideman)** — pairwise comparison across all ranked ballots. Determines the "strongest" winner by finding the candidate that beats all others head-to-head. More resistant to spoiler candidates than plurality.

Not sure which method to use? The poll creation flow links to `/learn`, an explainer page that breaks down how each method works with plain-English examples.

**Results**

Results can be made visible to participants at any time (admin-controlled), or held until the poll closes. The results view shows the winner, full standings, and flags ties when the top scores are equal.

**Admin controls**

Throughout the poll, the admin panel lets you:
- Edit the poll title, voting method (while still in the nominating phase), and nomination deadline
- Toggle nominations visible/hidden
- Toggle results visible/hidden
- Pause the poll — participants see a "poll is paused" card and can't submit nominations or votes until unpaused
- Delete the poll entirely (with a confirmation step)

**Session reclaim**

If a participant clears their browser storage or switches devices, they can rejoin by entering the same name they used originally. The app detects the match and restores their session automatically, showing a welcome-back banner. No account or login required.

---

## What you'll need before starting

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free plan works)
- Node.js 18+
- A [TMDB API key](https://www.themoviedb.org/settings/api) (for movie search) — free to register
- A [Google Books API key](https://console.cloud.google.com) — enable the Books API, then create a key under Credentials (for book search). Optional, but without it you'll hit rate limits quickly.

---

## Configuration

Three places need your values before deploying:

### 1. `worker/wrangler.toml` — Worker name

```toml
name = "polls-worker"          # change to whatever you want your Worker named
```

### 2. `worker/.dev.vars` — Local API keys and allowed origins (never committed)

Create this file yourself (it's gitignored):

```
TMDB_API_KEY=your_tmdb_key_here
GOOGLE_BOOKS_API_KEY=your_google_books_key_here
ALLOWED_ORIGINS=https://your-frontend-domain.com
```

`ALLOWED_ORIGINS` controls CORS — requests from origins not in this list will be rejected by the Worker. Multiple origins are comma-separated: `"https://polls.example.com,https://staging.example.com"`. During local development, `localhost:5173` is allowed automatically. Keeping this in `.dev.vars` rather than `wrangler.toml` means your production URL never gets committed to the repo.

### 3. Cloudflare dashboard — Production allowed origins and API keys

Set `ALLOWED_ORIGINS` as an environment variable in the Cloudflare dashboard so your production URL stays out of the repo entirely:

**Workers & Pages → polls-worker → Settings → Variables and Secrets → Add variable**

- Name: `ALLOWED_ORIGINS`
- Value: `https://your-frontend-domain.com`

Dashboard variables persist across all future `wrangler deploy` calls as long as `wrangler.toml` doesn't override them.

### 4. Cloudflare secrets — Production API keys

Set these once after deploying the Worker. They're stored encrypted in Cloudflare's infrastructure and injected at runtime — never in your source code or deployment bundle:

```bash
npx wrangler secret put TMDB_API_KEY
npx wrangler secret put GOOGLE_BOOKS_API_KEY
```

---

## Local development

### 1. Install dependencies

Both packages are independent — install them separately. Run this once after cloning, and again after any `package.json` changes:

```bash
cd worker && npm install
cd ../frontend && npm install
```

### 2. Authenticate with Cloudflare

```bash
cd worker
npx wrangler login
```

This opens a browser window to authorize the Wrangler CLI with your Cloudflare account. It's a one-time step per machine and stores credentials locally. You need this even for local development because Wrangler manages the local D1 database.

### 3. Set up local API keys and allowed origins

Create `worker/.dev.vars` as shown in the Configuration section above. Without `TMDB_API_KEY`, movie search won't return results. Without `GOOGLE_BOOKS_API_KEY`, book search will work but may hit rate limits. Without `ALLOWED_ORIGINS`, CORS will block all requests from the frontend.

### 4. Apply database migrations (local)

```bash
cd worker
npx wrangler d1 migrations apply polls --local
```

This creates a local SQLite database under `worker/.wrangler/state/` and applies all migrations to it. The `--local` flag is important — without it, Wrangler targets your production D1 database. If you add new migration files later, run this again to apply them locally.

### 5. Run both servers

The Worker and frontend must run simultaneously. The Vite dev server proxies all `/api/*` requests to the Worker, so from the frontend's perspective there's only one origin.

**Terminal 1 — Worker:**
```bash
cd worker
npx wrangler dev
# Runs on http://localhost:8787
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
# Runs on http://localhost:5173
# All /api/* requests are proxied to http://localhost:8787
```

Visit [http://localhost:5173](http://localhost:5173). Any changes to Worker or frontend code hot-reload automatically.

---

## Running tests

Worker tests run inside the actual Cloudflare Workers runtime via `@cloudflare/vitest-pool-workers`, so they catch runtime-specific behavior that Node-based test environments miss.

```bash
cd worker
npm test

# Watch mode (re-runs on file changes)
npm run test:watch

# Run a single test file
npx vitest run test/votes.test.ts
```

Each test file starts with a fresh database schema applied in `beforeEach`, so tests are fully isolated from each other and from your local development database.

---

## Production deployment

### 1. Create the D1 database

```bash
cd worker
npx wrangler d1 create polls
```

This provisions a new D1 database in your Cloudflare account and prints output like:

```
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Copy that `database_id` into `worker/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "polls"
database_id = "paste-your-id-here"
```

The `binding = "DB"` line is what makes the database available to the Worker as `env.DB` in code — don't change it.

### 2. Apply migrations to the live database

```bash
cd worker
npx wrangler d1 migrations apply polls
```

Note the absence of `--local` — this runs against your real Cloudflare D1 database. You'll run this again any time new migration files are added (e.g., after pulling changes that add a column or table).

### 3. Set production variables and secrets

First, set `ALLOWED_ORIGINS` as a dashboard environment variable (see the Configuration section — this keeps your production URL out of the repo).

Then set the API keys as secrets:

```bash
cd worker
npx wrangler secret put TMDB_API_KEY
npx wrangler secret put GOOGLE_BOOKS_API_KEY
```

Each command prompts you to paste the key value. Secrets are encrypted at rest in Cloudflare and injected into the Worker at runtime — they never appear in your deployment bundle or source code.

### 4. Deploy the Worker

```bash
cd worker
npx wrangler deploy
```

Wrangler bundles the Worker and deploys it to Cloudflare's network. Note the Worker URL in the output — it will look like `https://polls-worker.YOUR_ACCOUNT.workers.dev`. You'll need this URL when configuring the frontend.

### 5. Add a custom domain (optional)

If you want the Worker to serve from your own domain instead of `workers.dev`:

In the Cloudflare dashboard: **Workers & Pages → polls-worker → Settings → Triggers → Add Custom Domain**

After adding a custom domain, update `ALLOWED_ORIGINS` in `wrangler.toml` to include it and redeploy (`npx wrangler deploy`). If you skip this, the frontend on your custom domain will get CORS errors.

---

## Frontend deployment (Cloudflare Pages)

### Option A: Via dashboard (recommended)

> **Note:** Create this as a **Pages** project, not a Worker. If the setup screen shows a "Deploy command" field but no "Build output directory" field, you're in the wrong flow — go back and choose Pages.

1. Push this repo to GitHub.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**
3. Select your repository.
4. Build settings:
   - **Build command:** `cd frontend && npm install && npm run build`
   - **Build output directory:** `frontend/dist`
5. Environment variables — add this under the deployment settings:
   - `VITE_API_URL` = your Worker URL from step 4 above (e.g. `https://polls-worker.YOUR_ACCOUNT.workers.dev`)
6. Click **Save and Deploy**.

After the first deploy, Cloudflare Pages will automatically redeploy on every push to your main branch.

### Option B: Manual deploy

If you prefer to deploy from the command line without connecting GitHub:

```bash
cd frontend
VITE_API_URL=https://your-worker-url.workers.dev npm run build
npx wrangler pages deploy dist --project-name polls
```

`VITE_API_URL` is baked into the frontend build at compile time — if you change the Worker URL later, you'll need to rebuild and redeploy the frontend.
