import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { customAlphabet } from 'nanoid'
import { searchTmdbMovies } from '../src/lib/tmdb'

const nanoid = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 12)

// Known spelling/casing variants seen in the source spreadsheet, mapped to one canonical
// category name. If next year's spreadsheet introduces a new spelling, this script will
// throw a clear "Unknown voting category" error — add the new alias here and re-run.
const CATEGORY_ALIASES: Record<string, string> = {
  'comedy': 'Comedy',
  'other': 'Other',
  'action': 'Action',
  'big star': 'Big Star',
  'campy': 'Campy',
  'triple b': 'Triple B',
  "so bad, it's good.": "So Bad It's Good",
  "so bad its good": "So Bad It's Good",
  'music / documentary': 'Music/Documentary',
  'music /documentary': 'Music/Documentary',
  'music/documentary': 'Music/Documentary',
}

function normalizeCategory(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  const alias = CATEGORY_ALIASES[key]
  if (!alias) throw new Error(`Unknown voting category: "${raw}". Add it to CATEGORY_ALIASES in build-event-seed.ts.`)
  return alias
}

function parseSlotLabel(label: string): { category: string; placement: 1 | 2 } {
  const m = label.match(/^(.*?)\s*(1st|first|2nd|second)\s*choice\s*$/i)
  if (!m) throw new Error(`Cannot parse schedule slot label: "${label}"`)
  const placement: 1 | 2 = /1st|first/i.test(m[2]!) ? 1 : 2
  return { category: normalizeCategory(m[1]!), placement }
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function sqlValue(value: string | number | null): string {
  if (value === null) return 'NULL'
  if (typeof value === 'number') return String(value)
  return sqlString(value)
}

// Reads TMDB_API_KEY from the environment, falling back to worker/.dev.vars (the same
// file `wrangler dev` reads locally), since this script is run standalone via tsx and
// doesn't get Worker secret bindings automatically.
function loadDevVars(): Record<string, string> {
  try {
    const content = readFileSync('.dev.vars', 'utf-8')
    const vars: Record<string, string> = {}
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      vars[key] = value
    }
    return vars
  } catch {
    return {}
  }
}

function resolveTmdbApiKey(): string {
  if (process.env.TMDB_API_KEY) return process.env.TMDB_API_KEY
  const devVars = loadDevVars()
  if (devVars.TMDB_API_KEY) return devVars.TMDB_API_KEY
  throw new Error(
    'TMDB_API_KEY not found. Set it as an environment variable (TMDB_API_KEY=... npm run import-event -- ...) ' +
    'or add it to worker/.dev.vars, then re-run.'
  )
}

interface Movie {
  title: string
  category: string
}

function parseMovies(rows: unknown[][]): Movie[] {
  const header = rows[0] as string[]
  const titleCol = header.indexOf('Title')
  const categoryCol = header.indexOf('Voting Category')
  if (titleCol === -1 || categoryCol === -1) {
    throw new Error('Movie List sheet must have "Title" and "Voting Category" columns')
  }

  const movies: Movie[] = []
  for (const row of rows.slice(1)) {
    const title = row[titleCol]
    if (!title || typeof title !== 'string' || !title.trim()) continue
    const rawCategory = row[categoryCol]
    if (!rawCategory || typeof rawCategory !== 'string' || !rawCategory.trim()) {
      throw new Error(`Movie "${title}" has no Voting Category`)
    }
    movies.push({ title: title.trim(), category: normalizeCategory(rawCategory) })
  }
  return movies
}

interface Slot {
  day: string
  slotOrder: number
  category: string
  placement: 1 | 2
}

function parseSchedule(rows: unknown[][]): Slot[] {
  const header = rows[0] as string[]
  const dayCol = header.indexOf('Day')
  if (dayCol === -1) throw new Error('Movie Assignment sheet must have a "Day" column')
  const categoryCols = header
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => i !== dayCol && typeof h === 'string' && h.trim())

  const slots: Slot[] = []
  for (const row of rows.slice(1)) {
    const day = row[dayCol]
    if (!day || typeof day !== 'string' || !day.trim()) continue
    let slotOrder = 1
    for (const { i } of categoryCols) {
      const label = row[i]
      if (!label || typeof label !== 'string' || !label.trim()) continue
      const { category, placement } = parseSlotLabel(label.trim())
      slots.push({ day: day.trim(), slotOrder, category, placement })
      slotOrder++
    }
  }
  return slots
}

// Looks up each movie by title on TMDB and returns its metadata JSON (or null if no
// match was found). Logs a one-line match summary per movie to stderr so the operator
// can spot-check the full list afterward — an admin can also fix a wrong match later
// from the app's UI (the "✎ Fix match" control on any movie nomination).
async function lookupMovieMetadata(apiKey: string, movies: Movie[]): Promise<(string | null)[]> {
  const metadata: (string | null)[] = []
  for (const movie of movies) {
    try {
      const results = await searchTmdbMovies(apiKey, movie.title)
      const match = results[0]
      if (!match) {
        console.error(`  ⚠ "${movie.title}" → no TMDB match found`)
        metadata.push(null)
        continue
      }
      console.error(`  "${movie.title}" → matched "${match.title}"${match.year ? ` (${match.year})` : ''} [tmdb:${match.external_id}]`)
      metadata.push(JSON.stringify({ external_id: match.external_id, poster_url: match.poster_url }))
    } catch (e) {
      console.error(`  ⚠ "${movie.title}" → TMDB lookup failed: ${e instanceof Error ? e.message : String(e)}`)
      metadata.push(null)
    }
  }
  return metadata
}

async function main() {
  const [xlsxPath, slug, title] = process.argv.slice(2)
  if (!xlsxPath || !slug || !title) {
    console.error('Usage: npm run import-event -- <path-to.xlsx> <slug> <title>')
    process.exit(1)
  }

  const apiKey = resolveTmdbApiKey()

  const workbook = XLSX.read(readFileSync(xlsxPath))
  const movieSheet = workbook.Sheets['Movie List']
  const scheduleSheet = workbook.Sheets['Movie Assignment']
  if (!movieSheet) throw new Error('Workbook has no "Movie List" sheet')
  if (!scheduleSheet) throw new Error('Workbook has no "Movie Assignment" sheet')

  const movieRows = XLSX.utils.sheet_to_json(movieSheet, { header: 1, defval: null }) as unknown[][]
  const scheduleRows = XLSX.utils.sheet_to_json(scheduleSheet, { header: 1, defval: null }) as unknown[][]

  const movies = parseMovies(movieRows)
  const slots = parseSchedule(scheduleRows)

  const categories = [...new Set(movies.map(m => m.category))]
  const slotCategories = new Set(slots.map(s => s.category))
  for (const cat of slotCategories) {
    if (!categories.includes(cat)) {
      throw new Error(`Schedule references category "${cat}" which has no movies`)
    }
  }

  console.error(`Looking up ${movies.length} movies on TMDB…`)
  const movieMetadata = await lookupMovieMetadata(apiKey, movies)

  const now = Date.now()
  const eventAdminToken = nanoid(24)
  const statements: string[] = []
  const pollIdByCategory = new Map<string, string>()
  const systemParticipantIdByCategory = new Map<string, string>()

  statements.push(
    `INSERT INTO events (id, admin_token, title, is_public, created_at) VALUES (${sqlValue(slug)}, ${sqlValue(eventAdminToken)}, ${sqlValue(title)}, 0, ${now});`
  )

  categories.forEach((category, index) => {
    const pollId = nanoid(8)
    const pollAdminToken = nanoid(24)
    const movieCount = movies.filter(m => m.category === category).length
    pollIdByCategory.set(category, pollId)

    statements.push(
      `INSERT INTO polls (id, admin_token, title, category, voting_method, phase, max_nominations, nominations_visible, votes_visible, is_public, nomination_closes_at, created_at) VALUES (${sqlValue(pollId)}, ${sqlValue(pollAdminToken)}, ${sqlValue(category)}, 'movie', 'ranked_choice', 'voting', ${movieCount}, 1, 1, 0, NULL, ${now});`
    )

    const systemParticipantId = nanoid(8)
    systemParticipantIdByCategory.set(category, systemParticipantId)
    statements.push(
      `INSERT INTO participants (id, poll_id, name, token, joined_at) VALUES (${sqlValue(systemParticipantId)}, ${sqlValue(pollId)}, 'Maurice', ${sqlValue(nanoid(24))}, ${now});`
    )

    statements.push(
      `INSERT INTO event_polls (event_id, poll_id, category, sort_order) VALUES (${sqlValue(slug)}, ${sqlValue(pollId)}, ${sqlValue(category)}, ${index});`
    )
  })

  movies.forEach((movie, index) => {
    const pollId = pollIdByCategory.get(movie.category)!
    const participantId = systemParticipantIdByCategory.get(movie.category)!
    const nominationId = nanoid(8)
    const metadata = movieMetadata[index] ?? null
    statements.push(
      `INSERT INTO nominations (id, poll_id, participant_id, title, metadata, created_at) VALUES (${sqlValue(nominationId)}, ${sqlValue(pollId)}, ${sqlValue(participantId)}, ${sqlValue(movie.title)}, ${sqlValue(metadata)}, ${now + index});`
    )
  })

  for (const slot of slots) {
    statements.push(
      `INSERT INTO event_slots (event_id, day, slot_order, category, placement) VALUES (${sqlValue(slug)}, ${sqlValue(slot.day)}, ${slot.slotOrder}, ${sqlValue(slot.category)}, ${slot.placement});`
    )
  }

  console.log(statements.join('\n'))
  console.error(`\n${categories.length} categories, ${movies.length} movies, ${slots.length} schedule slots.`)
  const noMatchCount = movieMetadata.filter(m => m === null).length
  if (noMatchCount > 0) {
    console.error(`${noMatchCount} movie(s) had no TMDB match — check the warnings above and fix them from the app's admin UI after import.`)
  }
  console.error(`Admin URL (after deploy): https://<your-frontend-host>/e/${slug}?admin=${eventAdminToken}`)
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
