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
import type { Poll, PollNomination, NominationMetadata } from '../types'
import { api } from '../api/client'

interface SortableItemProps { nomination: PollNomination; rank: number }

function SortableItem({ nomination, rank }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: nomination.id })
  const meta = nomination.metadata
    ? (typeof nomination.metadata === 'string'
        ? JSON.parse(nomination.metadata) as NominationMetadata
        : nomination.metadata)
    : null
  const imageUrl = meta?.cover_url ?? meta?.poster_url

  return (
    <div ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="flex items-center gap-3 border-2 rounded-lg p-3 bg-white cursor-grab active:cursor-grabbing"
      {...attributes} {...listeners}>
      <span className="text-indigo-600 font-bold text-lg w-6 text-center">{rank}</span>
      {imageUrl && <img src={imageUrl} alt="" className="w-8 h-11 object-cover rounded flex-shrink-0" />}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{nomination.title}</div>
        {meta?.author && <div className="text-xs text-gray-400">{meta.author}</div>}
        {meta?.director && <div className="text-xs text-gray-400">{meta.director}</div>}
      </div>
      <span className="text-gray-300 text-xl select-none">⠿</span>
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
  const [selected, setSelected] = useState<string | null>(null) // for plurality
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
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
        if (!selected) { setError('Please select an option'); setSubmitting(false); return }
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
    return <p className="text-center text-green-600 py-8">Your vote has been submitted!</p>
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">
        {poll.voting_method === 'plurality' ? 'Vote for one' : 'Drag to rank — 1 = most preferred'}
      </h2>

      {poll.voting_method === 'plurality' ? (
        <div className="space-y-2">
          {nominations.map(nom => (
            <button key={nom.id} type="button"
              className={`w-full flex items-center gap-3 border-2 rounded-lg p-3 text-left ${selected === nom.id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200'}`}
              onClick={() => setSelected(nom.id)}>
              <span className="text-sm font-medium">{nom.title}</span>
            </button>
          ))}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={ranked.map(n => n.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {ranked.map((nom, i) => (
                <SortableItem key={nom.id} nomination={nom} rank={i + 1} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <button onClick={handleSubmit} disabled={submitting}
        className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold disabled:opacity-50">
        {submitting ? 'Submitting…' : 'Submit Vote'}
      </button>
    </div>
  )
}
