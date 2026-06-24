import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { CreatePoll } from './pages/CreatePoll'
import { PollPage } from './pages/PollPage'
import { useReducedMotion } from './hooks/useReducedMotion'

const Dither = lazy(() => import('./components/Dither'))

export default function App() {
  const reducedMotion = useReducedMotion()

  return (
    <BrowserRouter>
      {/* Animated background */}
      <div className="fixed inset-0 z-0" aria-hidden="true">
        <Suspense fallback={<div className="w-full h-full bg-bg" />}>
          <Dither
            waveColor={[0.32, 0.15, 1]}
            disableAnimation={reducedMotion}
            enableMouseInteraction={false}
            mouseRadius={1}
            colorNum={4}
            pixelSize={3}
            waveAmplitude={0.3}
            waveFrequency={3}
            waveSpeed={0.01}
          />
        </Suspense>
      </div>

      {/* Content layer */}
      <div className="relative z-10 min-h-screen flex flex-col">
        <nav className="sticky top-0 z-20 border-b border-line px-6 py-3.5 flex items-center backdrop-blur-md bg-[var(--nav-glass)]">
          <a href="/" className="flex items-center gap-2 font-extrabold text-xl text-ink tracking-tight">
            <span className="text-accent">◆</span>
            Polls
          </a>
        </nav>
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<CreatePoll />} />
            <Route path="/p/:id" element={<PollPage />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
