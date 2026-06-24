import { Hono } from 'hono'
import type { Env } from '../types'
export const searchRouter = new Hono<{ Bindings: Env }>()
