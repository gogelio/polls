import { Hono } from 'hono'
import type { Env } from '../types'
export const votesRouter = new Hono<{ Bindings: Env }>()
