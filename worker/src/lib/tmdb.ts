export interface TmdbMovieResult {
  external_id: string
  title: string
  director: null
  year: string | null
  poster_url: string | null
}

export async function searchTmdbMovies(apiKey: string, query: string): Promise<TmdbMovieResult[]> {
  const url = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}&api_key=${apiKey}&page=1`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Movie search failed')

  const data = await res.json() as {
    results?: Array<{
      id: number
      title: string
      release_date?: string
      poster_path?: string
    }>
  }

  return (data.results ?? []).slice(0, 5).map(movie => ({
    external_id: String(movie.id),
    title: movie.title,
    director: null,
    year: movie.release_date?.slice(0, 4) ?? null,
    poster_url: movie.poster_path
      ? `https://image.tmdb.org/t/p/w185${movie.poster_path}`
      : null,
  }))
}
