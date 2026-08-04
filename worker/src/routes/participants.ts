import { Hono } from 'hono'
import type { Env } from '../types'
import { joinOrReclaim } from '../lib/joinOrReclaim'

export const participantsRouter = new Hono<{ Bindings: Env }>()

participantsRouter.post('/:id/join', async (c) => {
  const pollId = c.req.param('id')
  const existingToken = c.req.header('Participant-Token') ?? null
  const body = await c.req.json<{ name?: string }>()

  const result = await joinOrReclaim(c.env, pollId, body.name ?? '', existingToken)
  if ('error' in result) return c.json({ error: result.error }, result.status)

  const { created, ...response } = result
  return c.json(response, created ? 201 : 200)
})
