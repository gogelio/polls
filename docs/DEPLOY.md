
# Deployment Guide

## Prerequisites

* Cloudflare account (free plan)
* Node.js installed (via fnm, nvm, or your system package manager)
* TMDB API key from https://www.themoviedb.org/settings/api (for movie search)
* Google Books API key from https://console.cloud.google.com (for book search — enable the Books API, then create an API key under Credentials)

This repo has two parts that each manage their own dependencies: `worker/` (the Cloudflare Worker backend) and `frontend/` (the Vite app). You'll run `npm install` in both before anything else will work.

---

## Quick Start (Local Development)

If you just want to run this locally, follow this section top to bottom. Production deployment is further down.

### 1. Install dependencies

Run this once after cloning, and again any time you pull changes that touch `package.json`:

```bash
cd worker
npm install
cd ../frontend
npm install
```

If you skip this, you'll get errors like `command not found` or `vite: command not found` later, since the tools those commands rely on (`wrangler`, `vite`) live inside `node_modules`, which `npm install` creates.

### 2. Authenticate with Cloudflare

```bash
cd worker
npx wrangler login
```

This opens a browser to authorize the CLI against your Cloudflare account. You only need to do this once per machine.

### 3. Set up local API keys

Worker secrets (used in production) aren't available to `wrangler dev` by default. Instead, create a local-only file:

```bash
cd worker
```

Create `worker/.dev.vars` (already gitignored, won't be committed) with:

```
TMDB_API_KEY=your_tmdb_key_here
GOOGLE_BOOKS_API_KEY=your_google_books_key_here
```

`wrangler dev` picks this up automatically, no extra flags needed.

### 4. Apply database migrations (local)

```bash
cd worker
npx wrangler d1 migrations apply polls --local
```

The `--local` flag matters here: this creates a local SQLite file that emulates the D1 database (stored in `worker/.wrangler/`), so this command never touches your real Cloudflare database. Without running this, your local worker has a database connection but no tables, and any query will fail.

### 5. Run both servers

You need two terminals open at once, one for the backend, one for the frontend.

**Terminal 1 — Worker**

```bash
cd worker
npx wrangler dev
# Worker runs on http://localhost:8787
```

**Terminal 2 — Frontend**

```bash
cd frontend
npm run dev
# App runs on http://localhost:5173
# /api/* is proxied to http://localhost:8787 (via vite.config.ts)
```

### 6. Open the app

Visit http://localhost:5173 in your browser.

---

## Running Tests

```bash
cd worker
npm test

# Watch mode
npm run test:watch
```

---

## Production Deployment

### 1. Create the D1 database

```bash
cd worker
npx wrangler d1 create polls
```

Copy the `database_id` from the output and paste it into `worker/wrangler.toml`:

```toml
database_id = "paste-your-id-here"
```

### 2. Apply migrations to the live database

```bash
cd worker
npx wrangler d1 migrations apply polls
```

No `--local` flag here, this applies migrations to the actual production D1 database in Cloudflare's cloud. Only run this after you've set the `database_id` above.

### 3. Set API key secrets

These are separate from the local `.dev.vars` file you created earlier. Secrets here are encrypted and live in Cloudflare, used by the deployed (production) Worker:

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

Note the deployed Worker URL in the output (e.g., `https://polls-worker.YOUR_ACCOUNT.workers.dev`). You'll need this for the frontend's environment variable in the next section.

### 5. Add a custom domain (optional)

In the Cloudflare dashboard:  **Workers & Pages → polls-worker → Settings → Triggers → Add Custom Domain** .

---

## Frontend Deployment (Cloudflare Pages)

### Option A: Via Dashboard (recommended)

**Important:** Create this as a **Pages** project, not a Worker. If the setup screen shows a "Deploy command" field with no "Build output directory" field, you're in the Worker setup, go back and choose Pages instead.

1. Push this repo to GitHub.
2. In the Cloudflare dashboard:  **Workers & Pages → Create → Pages → Connect to Git** .
3. Select your repository.
4. Build settings:
   * **Build command** : `cd frontend && npm install && npm run build`
   * **Build output directory** : `frontend/dist`
   * Leave the deploy command field blank (Pages deploys automatically).
5. Environment variables:
   * `VITE_API_URL` = the Worker URL you noted in the deploy step above (e.g., `https://polls-worker.YOUR_ACCOUNT.workers.dev`)
6. Deploy.

### Option B: Manual deploy

```bash
cd frontend
cp .env.production.example .env.production
# Edit .env.production and set VITE_API_URL to your deployed Worker URL
npm run build
npx wrangler pages deploy dist --project-name polls
```
