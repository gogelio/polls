import { useState } from 'react'
import { Link } from 'react-router-dom'

// ---- Scenario ----

const BALLOTS = [
  { voter: 'Alice', ranks: ['Dune', 'Oppenheimer', 'Barbie', 'Alien'] },
  { voter: 'Bob',   ranks: ['Dune', 'Oppenheimer', 'Barbie', 'Alien'] },
  { voter: 'Carol', ranks: ['Oppenheimer', 'Barbie', 'Alien', 'Dune'] },
]

// ---- Types ----

interface Step {
  label: string
  description: string
  content: React.ReactNode
}

// ---- MethodCard ----

function MethodCard({ title, tagline, winner, steps }: {
  title: string
  tagline: string
  winner: string
  steps: Step[]
}) {
  const [current, setCurrent] = useState(0)
  const step = steps[current]!
  const isFirst = current === 0
  const isLast = current === steps.length - 1

  return (
    <div className="card p-6 flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-ink font-semibold text-lg">{title}</h2>
          <p className="text-ink-2 text-sm mt-0.5">{tagline}</p>
        </div>
        {isLast && (
          <span className="badge text-success bg-[oklch(68%_0.18_145_/_0.12)] whitespace-nowrap shrink-0">
            🏆 {winner} wins
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="text-sm w-full border-collapse">
          <thead>
            <tr className="text-ink-3 text-xs uppercase tracking-wide">
              <th className="text-left py-1 pr-4 font-medium">Voter</th>
              <th className="text-left py-1 pr-3 font-medium">1st</th>
              <th className="text-left py-1 pr-3 font-medium">2nd</th>
              <th className="text-left py-1 pr-3 font-medium">3rd</th>
              <th className="text-left py-1 font-medium">4th</th>
            </tr>
          </thead>
          <tbody>
            {BALLOTS.map(b => (
              <tr key={b.voter} className="border-t border-line">
                <td className="py-1.5 pr-4 text-ink-2 font-medium">{b.voter}</td>
                {b.ranks.map((film, i) => (
                  <td key={i} className="py-1.5 pr-3 text-ink">{film}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-surface rounded-xl p-4 min-h-[10rem] flex flex-col gap-3">
        <p className="text-xs text-ink-3 font-semibold uppercase tracking-wide">{step.label}</p>
        {step.content}
        <p className="text-sm text-ink-2 italic mt-auto">{step.description}</p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => setCurrent(c => c - 1)}
          disabled={isFirst}
          className="btn-secondary text-sm disabled:opacity-30"
          aria-label={`Previous step in ${title}`}
        >
          ← Prev
        </button>
        <span className="text-ink-3 text-sm flex-1 text-center">
          Step {current + 1} of {steps.length}
        </span>
        <button
          onClick={() => setCurrent(c => c + 1)}
          disabled={isLast}
          className="btn-secondary text-sm disabled:opacity-30"
          aria-label={current === steps.length - 2 ? `See winner in ${title}` : `Next step in ${title}`}
        >
          {current === steps.length - 2 ? 'See winner →' : 'Next →'}
        </button>
      </div>
    </div>
  )
}

// ---- Shared step sub-components ----

function TallyRow({ film, count, max }: { film: string; count: number; max: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-ink text-sm w-28 shrink-0">{film}</span>
      <div className="flex-1 bg-raised rounded-full h-2 overflow-hidden">
        <div
          className="h-full bg-accent rounded-full"
          style={{ width: max > 0 ? `${(count / max) * 100}%` : '0%' }}
        />
      </div>
      <span className="text-ink-2 text-sm w-4 text-right">{count}</span>
    </div>
  )
}

function ScoreRow({ film, score, pct, highlight }: { film: string; score: number; pct: number; highlight?: boolean }) {
  return (
    <div className={`flex items-center gap-3 ${highlight ? 'text-accent font-semibold' : ''}`}>
      <span className="text-sm w-28 shrink-0">{film}</span>
      <div className="flex-1 bg-raised rounded-full h-2 overflow-hidden">
        <div
          className={`h-full rounded-full ${highlight ? 'bg-accent' : 'bg-[var(--line-bright)]'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-sm w-20 text-right">{score} pts ({pct}%)</span>
    </div>
  )
}

function MatchupRow({ a, b, result }: { a: string; b: string; result: string }) {
  const locked = result.startsWith('✓')
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-ink-2 w-36 shrink-0 truncate">{a} vs {b}</span>
      <span className="text-ink-3 mx-0.5">→</span>
      <span className={locked ? 'text-success font-medium' : 'text-ink-3'}>{result}</span>
    </div>
  )
}

// ---- Plurality steps ----

const PLURALITY_STEPS: Step[] = [
  {
    label: 'Step 1 — Alice votes',
    description: "Alice picks Dune — her top choice. First-place votes only count.",
    content: (
      <div className="flex flex-col gap-2">
        <TallyRow film="Dune"        count={1} max={3} />
        <TallyRow film="Oppenheimer" count={0} max={3} />
        <TallyRow film="Barbie"      count={0} max={3} />
        <TallyRow film="Alien"       count={0} max={3} />
      </div>
    ),
  },
  {
    label: 'Step 2 — Bob votes',
    description: "Bob also picks Dune. Rankings beyond 1st are completely ignored.",
    content: (
      <div className="flex flex-col gap-2">
        <TallyRow film="Dune"        count={2} max={3} />
        <TallyRow film="Oppenheimer" count={0} max={3} />
        <TallyRow film="Barbie"      count={0} max={3} />
        <TallyRow film="Alien"       count={0} max={3} />
      </div>
    ),
  },
  {
    label: 'Step 3 — Carol votes · Final result',
    description: "Dune wins with the most first-place votes. But Carol would rather watch anything else — Plurality doesn't capture that.",
    content: (
      <div className="flex flex-col gap-2">
        <TallyRow film="Dune"        count={2} max={3} />
        <TallyRow film="Oppenheimer" count={1} max={3} />
        <TallyRow film="Barbie"      count={0} max={3} />
        <TallyRow film="Alien"       count={0} max={3} />
      </div>
    ),
  },
]

// ---- Borda steps ----
// N=4 candidates, 3 voters. maxPossible = 4*3 = 12.
// Alice+Bob: Dune=4, Opp=3, Barbie=2, Alien=1 each.
// Carol: Opp=4, Barbie=3, Alien=2, Dune=1.
// Totals: Dune=9(75%), Opp=10(83%), Barbie=7(58%), Alien=4(33%).

const BORDA_STEPS: Step[] = [
  {
    label: "Step 1 — Alice's ballot counted (1st=4pts, 2nd=3pts, 3rd=2pts, 4th=1pt)",
    description: "Each rank earns points. First place earns the most (N points, where N = number of candidates).",
    content: (
      <div className="flex flex-col gap-2">
        <ScoreRow film="Dune"        score={4} pct={33} />
        <ScoreRow film="Oppenheimer" score={3} pct={25} />
        <ScoreRow film="Barbie"      score={2} pct={17} />
        <ScoreRow film="Alien"       score={1} pct={8}  />
      </div>
    ),
  },
  {
    label: "Step 2 — Bob's ballot added",
    description: "Bob's rankings match Alice's exactly, so Dune stretches its lead.",
    content: (
      <div className="flex flex-col gap-2">
        <ScoreRow film="Dune"        score={8} pct={67} />
        <ScoreRow film="Oppenheimer" score={6} pct={50} />
        <ScoreRow film="Barbie"      score={4} pct={33} />
        <ScoreRow film="Alien"       score={2} pct={17} />
      </div>
    ),
  },
  {
    label: "Step 3 — Carol's ballot added · Final scores",
    description: "Carol loves Oppenheimer (4pts) and puts Dune last (1pt). That penalty pulls Dune below Oppenheimer.",
    content: (
      <div className="flex flex-col gap-2">
        <ScoreRow film="Oppenheimer" score={10} pct={83} highlight />
        <ScoreRow film="Dune"        score={9}  pct={75} />
        <ScoreRow film="Barbie"      score={7}  pct={58} />
        <ScoreRow film="Alien"       score={4}  pct={33} />
      </div>
    ),
  },
  {
    label: 'Step 4 — Winner',
    description: "Oppenheimer wins — it's Carol's top pick and Alice & Bob's solid second. Borda rewards broad appeal over concentrated first-place votes.",
    content: (
      <div className="flex flex-col gap-2">
        <ScoreRow film="Oppenheimer" score={10} pct={83} highlight />
        <ScoreRow film="Dune"        score={9}  pct={75} />
        <ScoreRow film="Barbie"      score={7}  pct={58} />
        <ScoreRow film="Alien"       score={4}  pct={33} />
      </div>
    ),
  },
]

// ---- Ranked Pairs steps ----
// Dune beats Opp/Barbie/Alien 2-1. Opp beats Barbie/Alien 3-0. Barbie beats Alien 3-0.
// Locked in margin order: 3-0 pairs first, then 2-1 pairs. No cycles → Dune wins.

const RANKED_PAIRS_STEPS: Step[] = [
  {
    label: 'Step 1 — All head-to-head matchups',
    description: "Every candidate faces every other in a head-to-head vote across all three ballots.",
    content: (
      <div className="flex flex-col gap-1.5">
        <MatchupRow a="Dune"        b="Oppenheimer" result="Dune 2–1"        />
        <MatchupRow a="Dune"        b="Barbie"       result="Dune 2–1"        />
        <MatchupRow a="Dune"        b="Alien"        result="Dune 2–1"        />
        <MatchupRow a="Oppenheimer" b="Barbie"       result="Oppenheimer 3–0" />
        <MatchupRow a="Oppenheimer" b="Alien"        result="Oppenheimer 3–0" />
        <MatchupRow a="Barbie"      b="Alien"        result="Barbie 3–0"      />
      </div>
    ),
  },
  {
    label: 'Step 2 — Lock strongest wins first (3–0 sweeps)',
    description: "Clearest wins are locked first to build the ranking. Oppenheimer swept Barbie and Alien; Barbie swept Alien.",
    content: (
      <div className="flex flex-col gap-1.5">
        <MatchupRow a="Oppenheimer" b="Barbie"       result="✓ Locked (3–0)" />
        <MatchupRow a="Oppenheimer" b="Alien"        result="✓ Locked (3–0)" />
        <MatchupRow a="Barbie"      b="Alien"        result="✓ Locked (3–0)" />
        <MatchupRow a="Dune"        b="Oppenheimer"  result="pending (2–1)"  />
        <MatchupRow a="Dune"        b="Barbie"       result="pending (2–1)"  />
        <MatchupRow a="Dune"        b="Alien"        result="pending (2–1)"  />
      </div>
    ),
  },
  {
    label: 'Step 3 — Lock remaining pairs (no cycles created)',
    description: "Dune beats Oppenheimer, Barbie, and Alien head-to-head — all locked in without creating any contradiction.",
    content: (
      <div className="flex flex-col gap-1.5">
        <MatchupRow a="Oppenheimer" b="Barbie"       result="✓ Locked" />
        <MatchupRow a="Oppenheimer" b="Alien"        result="✓ Locked" />
        <MatchupRow a="Barbie"      b="Alien"        result="✓ Locked" />
        <MatchupRow a="Dune"        b="Oppenheimer"  result="✓ Locked" />
        <MatchupRow a="Dune"        b="Barbie"       result="✓ Locked" />
        <MatchupRow a="Dune"        b="Alien"        result="✓ Locked" />
      </div>
    ),
  },
  {
    label: 'Step 4 — Winner · Dune > Oppenheimer > Barbie > Alien',
    description: "Dune beats every other film head-to-head — it's the Condorcet winner. When a Condorcet winner exists, Ranked Pairs always finds them.",
    content: (
      <div className="flex flex-col gap-1.5">
        <MatchupRow a="Oppenheimer" b="Barbie"       result="✓ Locked" />
        <MatchupRow a="Oppenheimer" b="Alien"        result="✓ Locked" />
        <MatchupRow a="Barbie"      b="Alien"        result="✓ Locked" />
        <MatchupRow a="Dune"        b="Oppenheimer"  result="✓ Locked" />
        <MatchupRow a="Dune"        b="Barbie"       result="✓ Locked" />
        <MatchupRow a="Dune"        b="Alien"        result="✓ Locked" />
      </div>
    ),
  },
]

// ---- Page ----

export function LearnPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-8 flex flex-col gap-8">
      <div>
        <Link to="/" className="text-ink-2 text-sm hover:text-ink transition-colors">
          ← Create a poll
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-ink">How voting methods work</h1>
        <p className="text-ink-2 text-sm mt-1">
          Same three voters, same four films. Step through each method to see how they count differently.
        </p>
        <div className="mt-2">
          <span className="badge bg-accent-muted text-accent">3 voters · 4 films</span>
        </div>
      </div>

      <MethodCard
        title="Plurality"
        tagline="Most first-place votes wins"
        winner="Dune"
        steps={PLURALITY_STEPS}
      />

      <MethodCard
        title="Ranked Choice (Borda method)"
        tagline="Points for every ranking — rewards broad appeal"
        winner="Oppenheimer"
        steps={BORDA_STEPS}
      />

      <MethodCard
        title="Ranked Pairs (Tideman method)"
        tagline="Head-to-head matchups — finds the true majority pick"
        winner="Dune"
        steps={RANKED_PAIRS_STEPS}
      />

      <div className="card p-6">
        <h2 className="text-ink font-semibold text-lg mb-4">Which should you pick?</h2>
        <div className="overflow-x-auto">
          <table className="text-sm w-full">
            <thead>
              <tr className="text-ink-3 text-xs uppercase tracking-wide">
                <th className="text-left py-2 pr-6 font-medium w-28"></th>
                <th className="text-left py-2 pr-6 font-medium">Plurality</th>
                <th className="text-left py-2 pr-6 font-medium">Ranked Choice</th>
                <th className="text-left py-2 font-medium">Ranked Pairs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <tr>
                <td className="py-2.5 pr-6 text-ink-3 font-medium">Best for</td>
                <td className="py-2.5 pr-6 text-ink">Quick decisions</td>
                <td className="py-2.5 pr-6 text-ink">Small groups, consensus</td>
                <td className="py-2.5 text-ink">Larger groups, fairness</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-6 text-ink-3 font-medium">Ballot</td>
                <td className="py-2.5 pr-6 text-ink">Pick one</td>
                <td className="py-2.5 pr-6 text-ink">Drag to rank</td>
                <td className="py-2.5 text-ink">Drag to rank</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-6 text-ink-3 font-medium">Wins by</td>
                <td className="py-2.5 pr-6 text-ink">Most 1st-place votes</td>
                <td className="py-2.5 pr-6 text-ink">Highest Borda points</td>
                <td className="py-2.5 text-ink">Beats all others 1-on-1</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-6 text-ink-3 font-medium">This example</td>
                <td className="py-2.5 pr-6 text-accent font-medium">Dune</td>
                <td className="py-2.5 pr-6 text-accent font-medium">Oppenheimer</td>
                <td className="py-2.5 text-accent font-medium">Dune</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
