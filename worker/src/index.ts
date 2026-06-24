import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './types'
import { pollsRouter } from './routes/polls'
import { participantsRouter } from './routes/participants'
import { nominationsRouter } from './routes/nominations'
import { votesRouter } from './routes/votes'
import { searchRouter } from './routes/search'

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors())

app.route('/polls', pollsRouter)
app.route('/polls', participantsRouter)
app.route('/polls', nominationsRouter)
app.route('/polls', votesRouter)
app.route('/search', searchRouter)

export default app
