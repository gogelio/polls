# Deployment Guide

## Prerequisites

- Cloudflare account (free plan)
- `wrangler` CLI installed (`npm install -g wrangler`)
- `wrangler login` completed
- TMDB API key from https://www.themoviedb.org/settings/api (for movie search)
- Google Books API key from https://console.cloud.google.com (for book search — enable the Books API, then create an API key under Credentials)

## Worker Deployment

### 1. Create D1 database

```bash
cd worker
npx wrangler d1 create polls
```

Copy the `database_id` from the output and update `worker/wrangler.toml`:
```toml
database_id = "paste-your-id-here"
```

### 2. Apply migrations

```bash
# Production only — run this to apply migrations to the live D1 database
npx wrangler d1 migrations apply polls
```

The `--local` flag applies migrations to a local SQLite file used by `wrangler dev`. Only run that if you need local development to work; skip it for a production-only deploy.

### 3. Set API key secrets

```bash
npx wrangler secret put TMDB_API_KEY
# Paste your TMDB API key when prompted

npx wrangler secret put GOOGLE_BOOKS_API_KEY
# Paste your Google Books API key when prompted
```

### 4. Deploy the Worker

```bash
npx wrangler deploy
```

Note the deployed Worker URL (e.g., `https://polls-worker.YOUR_ACCOUNT.workers.dev`).

### 5. Add your custom domain (optional)

In the Cloudflare dashboard: Workers & Pages → polls-worker → Settings → Triggers → Add Custom Domain.

## Frontend Deployment (Cloudflare Pages)

### Option A: Via Dashboard (recommended)

**Important:** Create this as a **Pages** project, not a Worker. If you see a "Deploy command" field and no "Build output directory" field, you're in the Worker setup — go back and choose Pages instead.

1. Push this repo to GitHub
2. In Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**
3. Select your repository
4. Build settings:
   - **Build command**: `cd frontend && npm install && npm run build`
   - **Build output directory**: `frontend/dist`
   - Leave the deploy command field blank (Pages deploys automatically)
5. Environment variables:
   - `VITE_API_URL` = `https://polls-worker.YOUR_ACCOUNT.workers.dev`
6. Deploy!

### Option B: Manual deploy

```bash
cd frontend
cp .env.production.example .env.production
# Edit .env.production and set VITE_API_URL
npm run build
npx wrangler pages deploy dist --project-name polls
```

## Local Development

### API keys for local dev

Worker secrets are not available in `wrangler dev` by default. Create `worker/.dev.vars` (already gitignored) with your keys:

```
TMDB_API_KEY=your_tmdb_key_here
GOOGLE_BOOKS_API_KEY=your_google_books_key_here
```

`wrangler dev` picks this file up automatically — no extra flags needed.

Also apply migrations to the local D1 database so the worker has a schema:

```bash
cd worker
npx wrangler d1 migrations apply polls --local
```

### Terminal 1 — Worker
```bash
cd worker
npx wrangler dev
# Worker runs on http://localhost:8787
```

### Terminal 2 — Frontend
```bash
cd frontend
npm run dev
# App runs on http://localhost:5173
# /api/* is proxied to http://localhost:8787 (via vite.config.ts)
```

Open http://localhost:5173 in your browser.

## Running Tests

```bash
# Worker tests
cd worker && npm test

# Worker tests (watch mode)
cd worker && npm run test:watch
```
