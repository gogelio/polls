import { Hono } from 'hono'
import type { Env } from '../types'
export const participantsRouter = new Hono<{ Bindings: Env }>()
