import { Hono } from 'hono'
import type { Env } from '../types'
export const nominationsRouter = new Hono<{ Bindings: Env }>()
