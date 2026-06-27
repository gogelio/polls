import { useState } from 'react'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Category, Poll, PollNomination, NominationMetadata } from '../types'
import { api } from '../api/client'
import { ResultsView } from './ResultsView'

interface SortableItemProps { nomination: PollNomination; rank: number; category: Category }

function SortableItem({ nomination, rank, category }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: nomination.id })
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

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="flex items-center gap-3 bg-raised border border-line rounded-xl p-3 cursor-grab active:cursor-grabbing select-none touch-none"
      {...attributes}
      {...listeners}
    >
      <span className="text-accent font-extrabold text-base w-6 text-center flex-shrink-0 tabular-nums">
        {rank}
      </span>
      {imageUrl && (
        <img src={imageUrl} alt="" className="w-8 h-11 object-cover rounded-lg flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        {externalUrl ? (
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="font-semibold text-sm text-ink truncate hover:underline block"
          >
            {nomination.title}
          </a>
        ) : (
          <div className="font-semibold text-sm text-ink truncate">{nomination.title}</div>
        )}
        {meta?.author && <div className="text-xs text-ink-3">{meta.author}</div>}
        {meta?.director && <div className="text-xs text-ink-3">{meta.director}</div>}
      </div>
      <span className="text-ink-3 text-lg select-none flex-shrink-0">⠿</span>
    </div>
  )
}

interface VotingPhaseProps {
  poll: Poll
  onRefetch: () => void
}

export function VotingPhase({ poll, onRefetch }: VotingPhaseProps) {
  const nominations = poll.nominations ?? []
  const [ranked, setRanked] = useState<PollNomination[]>(nominations)
  const [selected, setSelected] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(poll.has_voted ?? false)
  const [error, setError] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setRanked(items => {
        const oldIndex = items.findIndex(i => i.id === active.id)
        const newIndex = items.findIndex(i => i.id === over.id)
        return arrayMove(items, oldIndex, newIndex)
      })
    }
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      let votes: Array<{ nomination_id: string; rank: number | null }>
      if (poll.voting_method === 'plurality') {
        if (!selected) { setError('Pick one to vote'); setSubmitting(false); return }
        votes = [{ nomination_id: selected, rank: null }]
      } else {
        votes = ranked.map((nom, i) => ({ nomination_id: nom.id, rank: i + 1 }))
      }
      await api.submitVotes(poll.id, votes)
      setSubmitted(true)
      onRefetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit vote')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    if (poll.votes_visible) {
      return (
        <div className="space-y-4">
          <div className="card px-5 py-3 flex items-center gap-3">
            <span className="text-success text-lg">✓</span>
            <p className="text-sm font-semibold text-ink">Vote submitted! Live standings below.</p>
          </div>
          <ResultsView poll={poll} />
        </div>
      )
    }
    return (
      <div className="card p-10 text-center">
        <div className="text-5xl mb-4">✓</div>
        <p className="text-xl font-extrabold text-ink mb-1">Vote submitted!</p>
        <p className="text-ink-3 text-sm">Waiting for results…</p>
      </div>
    )
  }

  if (poll.is_paused) {
    return (
      <div className="card p-10 text-center space-y-2">
        <p className="text-3xl">⏸</p>
        <p className="text-lg font-extrabold text-ink">This poll is paused</p>
        <p className="text-ink-3 text-sm">The admin has temporarily paused submissions.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <p className="text-sm font-semibold text-ink mb-4">
          {poll.voting_method === 'plurality'
            ? 'Pick your favourite'
            : 'Drag to rank — #1 is your top pick'}
        </p>

        {poll.voting_method === 'plurality' ? (
          <div className="space-y-2">
            {nominations.map(nom => (
              <button
                key={nom.id}
                type="button"
                onClick={() => setSelected(nom.id)}
                className={`w-full flex items-center gap-3 border-2 rounded-xl p-3 text-left transition-colors ${
                  selected === nom.id
                    ? 'border-accent bg-accent-muted'
                    : 'border-line bg-raised hover:border-line-bright'
                }`}
              >
                <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 transition-colors ${
                  selected === nom.id ? 'border-accent bg-accent' : 'border-line'
                }`} />
                <span className="font-semibold text-sm text-ink">{nom.title}</span>
              </button>
            ))}
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={ranked.map(n => n.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {ranked.map((nom, i) => (
                  <SortableItem key={nom.id} nomination={nom} rank={i + 1} category={poll.category} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {error && <div className="card px-4 py-3"><p className="text-danger text-sm">{error}</p></div>}

      <button onClick={handleSubmit} disabled={submitting} className="btn-primary">
        {submitting ? 'Submitting…' : 'Submit vote →'}
      </button>
    </div>
  )
}
