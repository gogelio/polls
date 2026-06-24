import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { Category, VotingMethod } from '../types'

export function CreatePoll() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<Category>('general')
  const [votingMethod, setVotingMethod] = useState<VotingMethod>('ranked_choice')
  const [maxNominations, setMaxNominations] = useState(3)
  const [nominationsVisible, setNominationsVisible] = useState(true)
  const [votesVisible, setVotesVisible] = useState(false)
  const [timerMinutes, setTimerMinutes] = useState<number | ''>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) { setError('Title is required'); return }
    setSubmitting(true)
    setError(null)
    try {
      const result = await api.createPoll({
        title: title.trim(),
        category,
        voting_method: votingMethod,
        max_nominations: maxNominations,
        nominations_visible: nominationsVisible,
        votes_visible: votesVisible,
        nomination_closes_at: timerMinutes ? Date.now() + Number(timerMinutes) * 60 * 1000 : null,
      })
      // Store admin token in sessionStorage
      sessionStorage.setItem(`poll_admin_${result.id}`, result.admin_token)
      navigate(`/p/${result.id}?admin=${result.admin_token}`, { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create poll')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto py-12 px-4">
      <h1 className="text-3xl font-bold mb-8">New Poll</h1>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-1">Poll title</label>
          <input
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={title} onChange={e => setTitle(e.target.value)} placeholder="What should we watch next?" />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Category</label>
          <div className="flex gap-3">
            {(['book', 'movie', 'general'] as Category[]).map(cat => (
              <button key={cat} type="button"
                className={`flex-1 py-2 rounded-lg border-2 text-sm font-medium ${category === cat ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200'}`}
                onClick={() => setCategory(cat)}>
                {cat === 'book' ? '📚 Book Club' : cat === 'movie' ? '🎬 Movies' : '💬 General'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Voting method</label>
          <select className="w-full border rounded-lg px-3 py-2"
            value={votingMethod} onChange={e => setVotingMethod(e.target.value as VotingMethod)}>
            <option value="plurality">Plurality (most votes wins)</option>
            <option value="ranked_choice">Ranked Choice (instant runoff)</option>
            <option value="ranked_pairs">Ranked Pairs (Tideman method)</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Max nominations per person</label>
            <input type="number" min={1} max={10}
              className="w-full border rounded-lg px-3 py-2"
              value={maxNominations} onChange={e => setMaxNominations(Number(e.target.value))} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Nomination timer (minutes, optional)</label>
            <input type="number" min={1}
              className="w-full border rounded-lg px-3 py-2"
              value={timerMinutes} onChange={e => setTimerMinutes(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="No timer" />
          </div>
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={nominationsVisible} onChange={e => setNominationsVisible(e.target.checked)} />
            <span className="text-sm">Show nominations live during nomination phase</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={votesVisible} onChange={e => setVotesVisible(e.target.checked)} />
            <span className="text-sm">Show live results during voting phase</span>
          </label>
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button type="submit" disabled={submitting}
          className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold disabled:opacity-50">
          {submitting ? 'Creating…' : 'Create Poll →'}
        </button>
      </form>
    </div>
  )
}
