import type { PollNomination, NominationMetadata } from '../types'

interface NominationCardProps {
  nomination: PollNomination
  onDelete?: () => void
}

export function NominationCard({ nomination, onDelete }: NominationCardProps) {
  const meta = nomination.metadata
    ? (typeof nomination.metadata === 'string'
        ? JSON.parse(nomination.metadata) as NominationMetadata
        : nomination.metadata)
    : null
  const imageUrl = meta?.cover_url ?? meta?.poster_url

  return (
    <div className="flex items-center gap-3 border rounded-lg p-3">
      {imageUrl && (
        <img src={imageUrl} alt="" className="w-10 h-14 object-cover rounded flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{nomination.title}</div>
        {meta?.author && <div className="text-xs text-gray-500">{meta.author}{meta.year ? ` · ${meta.year}` : ''}</div>}
        {meta?.director && <div className="text-xs text-gray-500">{meta.director}{meta.year ? ` · ${meta.year}` : ''}</div>}
        <div className="text-xs text-gray-400">nominated by {nomination.participant_name}</div>
      </div>
      {onDelete && (
        <button onClick={onDelete} className="text-red-400 hover:text-red-600 text-xs flex-shrink-0">✕</button>
      )}
    </div>
  )
}
