import { Hono } from 'hono'
import type { Env } from '../types'
import { participantAuth } from '../middleware/auth'

type Variables = { participantId: string }
export const searchRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

searchRouter.get('/books', participantAuth, async (c) => {
  const q = c.req.query('q')?.trim()
  if (!q) return c.json({ error: 'q is required' }, 400)

  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=5&fields=items(id,volumeInfo(title,authors,publishedDate,imageLinks))`
  const res = await fetch(url)
  if (!res.ok) return c.json({ error: 'Book search failed' }, 502)

  const data = await res.json() as {
    items?: Array<{
      id: string
      volumeInfo: { title: string; authors?: string[]; publishedDate?: string; imageLinks?: { thumbnail?: string } }
    }>
  }

  const results = (data.items ?? []).map(item => ({
    external_id: item.id,
    title: item.volumeInfo.title,
    author: item.volumeInfo.authors?.[0] ?? null,
    year: item.volumeInfo.publishedDate?.slice(0, 4) ?? null,
    cover_url: item.volumeInfo.imageLinks?.thumbnail?.replace('http:', 'https:') ?? null,
  }))

  return c.json(results)
})

searchRouter.get('/movies', participantAuth, async (c) => {
  const q = c.req.query('q')?.trim()
  if (!q) return c.json({ error: 'q is required' }, 400)

  const apiKey = c.env.TMDB_API_KEY
  const url = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(q)}&api_key=${apiKey}&page=1`
  const res = await fetch(url)
  if (!res.ok) return c.json({ error: 'Movie search failed' }, 502)

  const data = await res.json() as {
    results?: Array<{
      id: number
      title: string
      release_date?: string
      poster_path?: string
    }>
  }

  const results = (data.results ?? []).slice(0, 5).map(movie => ({
    external_id: String(movie.id),
    title: movie.title,
    director: null,
    year: movie.release_date?.slice(0, 4) ?? null,
    poster_url: movie.poster_path
      ? `https://image.tmdb.org/t/p/w185${movie.poster_path}`
      : null,
  }))

  return c.json(results)
})
