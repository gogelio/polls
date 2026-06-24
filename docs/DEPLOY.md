# Deployment Guide

## Prerequisites

- Cloudflare account (free plan)
- `wrangler` CLI installed (`npm install -g wrangler`)
- `wrangler login` completed
- TMDB API key from https://www.themoviedb.org/settings/api

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
# Local dev
npx wrangler d1 migrations apply polls --local

# Production
npx wrangler d1 migrations apply polls
```

### 3. Set TMDB API key secret

```bash
npx wrangler secret put TMDB_API_KEY
# Paste your TMDB API key when prompted
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

1. Push this repo to GitHub
2. In Cloudflare dashboard: Workers & Pages → Create Application → Pages → Connect to Git
3. Select your repository
4. Build settings:
   - Build command: `cd frontend && npm run build`
   - Build output directory: `frontend/dist`
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
