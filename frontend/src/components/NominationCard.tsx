import type { Category, PollNomination, NominationMetadata } from '../types'

interface NominationCardProps {
  nomination: PollNomination
  category: Category
  onDelete?: () => void
}

export function NominationCard({ nomination, category, onDelete }: NominationCardProps) {
  const meta = nomination.metadata
    ? (typeof nomination.metadata === 'string'
        ? JSON.parse(nomination.metadata) as NominationMetadata
        : nomination.metadata)
    : null
  const imageUrl = meta?.cover_url ?? meta?.poster_url
  const externalUrl = meta?.external_id && (category === 'book' || category === 'movie')
    ? category === 'book'
      ? `https://books.google.com/books?id=${meta.external_id}`
      : `https://www.themoviedb.org/movie/${meta.external_id}`
    : null

  const inner = (
    <div className="flex items-center gap-3 bg-raised border border-line rounded-xl p-3 group">
      {imageUrl && (
        <img src={imageUrl} alt="" className="w-9 h-14 object-cover rounded-lg flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm text-ink truncate">{nomination.title}</div>
        {meta?.author && (
          <div className="text-xs text-ink-2">{meta.author}{meta.year ? ` · ${meta.year}` : ''}</div>
        )}
        {meta?.director && (
          <div className="text-xs text-ink-2">{meta.director}{meta.year ? ` · ${meta.year}` : ''}</div>
        )}
        <div className="text-xs text-ink-3 mt-0.5">by {nomination.participant_name}</div>
      </div>
      {onDelete && (
        <button
          onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete() }}
          className="text-ink-3 hover:text-danger transition-colors flex-shrink-0 p-1.5 rounded-lg hover:bg-[oklch(62%_0.22_25_/_0.1)] opacity-0 group-hover:opacity-100"
          aria-label="Remove nomination"
        >
          ✕
        </button>
      )}
    </div>
  )

  if (externalUrl) {
    return (
      <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="block hover:opacity-90 transition-opacity">
        {inner}
      </a>
    )
  }
  return inner
}
