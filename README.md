# Polls

A lightweight group polling tool for collective decisions. Create a poll, share a link, nominate options, vote, see the winner. Supports plurality, ranked choice, and ranked pairs voting. Movie and book categories pull metadata from TMDB and Google Books.

Built on Cloudflare Workers (Hono) + D1 + Pages (React/Vite).

---

## What you'll need before starting

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free plan works)
- Node.js 18+
- A [TMDB API key](https://www.themoviedb.org/settings/api) (for movie search)
- A [Google Books API key](https://console.cloud.google.com) — enable the Books API, then create a key under Credentials (for book search)

---

## Configuration

Three places need your values before deploying:

### 1. `worker/wrangler.toml` — Worker name and allowed origins

```toml
name = "polls-worker"          # change to whatever you want your Worker named

[vars]
ALLOWED_ORIGINS = "https://your-frontend-domain.com"  # your frontend URL
```

Multiple origins are comma-separated: `"https://polls.example.com,https://staging.example.com"`

### 2. `worker/.dev.vars` — Local API keys (never committed)

Create this file yourself (it's gitignored):

```
TMDB_API_KEY=your_tmdb_key_here
GOOGLE_BOOKS_API_KEY=your_google_books_key_here
```

### 3. Cloudflare secrets — Production API keys

Set these once after deploying the Worker (see production steps below):

```bash
npx wrangler secret put TMDB_API_KEY
npx wrangler secret put GOOGLE_BOOKS_API_KEY
```

---

## Local development

### 1. Install dependencies

Run once after cloning, and again after any `package.json` changes:

```bash
cd worker && npm install
cd ../frontend && npm install
```

### 2. Authenticate with Cloudflare

```bash
cd worker
npx wrangler login
```

Opens a browser to authorize the CLI. One-time per machine.

### 3. Set up local API keys

Create `worker/.dev.vars` as shown in the Configuration section above.

### 4. Apply database migrations (local)

```bash
cd worker
npx wrangler d1 migrations apply polls --local
```

Creates a local SQLite file under `worker/.wrangler/` — never touches your production database.

### 5. Run both servers

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
# /api/* is proxied to http://localhost:8787
```

Visit [http://localhost:5173](http://localhost:5173).

---

## Running tests

```bash
cd worker
npm test

# Watch mode
npm run test:watch
```

---

## Production deployment

### 1. Create the D1 database

```bash
cd worker
npx wrangler d1 create polls
```

Copy the `database_id` from the output into `worker/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "polls"
database_id = "paste-your-id-here"
```

### 2. Apply migrations to the live database

```bash
cd worker
npx wrangler d1 migrations apply polls
```

No `--local` flag — this runs against your real Cloudflare D1 database.

### 3. Set production secrets

```bash
cd worker
npx wrangler secret put TMDB_API_KEY
npx wrangler secret put GOOGLE_BOOKS_API_KEY
```

### 4. Deploy the Worker

```bash
cd worker
npx wrangler deploy
```

Note the Worker URL in the output (e.g. `https://polls-worker.YOUR_ACCOUNT.workers.dev`). You'll need it for the next step.

### 5. Add a custom domain (optional)

In the Cloudflare dashboard: **Workers & Pages → polls-worker → Settings → Triggers → Add Custom Domain**

If you add a custom domain, update `ALLOWED_ORIGINS` in `wrangler.toml` to match it and redeploy.

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
5. Environment variables:
   - `VITE_API_URL` = your Worker URL from step 4 above
6. Deploy.

### Option B: Manual deploy

```bash
cd frontend
VITE_API_URL=https://your-worker-url.workers.dev npm run build
npx wrangler pages deploy dist --project-name polls
```
