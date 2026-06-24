import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './types'
import { pollsRouter } from './routes/polls'
import { participantsRouter } from './routes/participants'
import { nominationsRouter } from './routes/nominations'
import { votesRouter } from './routes/votes'
import { searchRouter } from './routes/search'

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors({
  origin: (origin) => {
    const allowed = [
      'http://localhost:5173',
      'http://localhost:4173',
    ]
    // Allow any *.pages.dev subdomain and the configured production domain
    if (!origin) return '*'
    if (allowed.includes(origin)) return origin
    if (origin.endsWith('.pages.dev')) return origin
    return null
  },
}))

app.route('/polls', pollsRouter)
app.route('/polls', participantsRouter)
app.route('/polls', nominationsRouter)
app.route('/polls', votesRouter)
app.route('/search', searchRouter)

export default app
