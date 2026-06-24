import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { CreatePoll } from './pages/CreatePoll'
import { PollPage } from './pages/PollPage'

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50">
        <nav className="border-b bg-white px-4 py-3">
          <a href="/" className="font-bold text-indigo-600 text-lg">Polls</a>
        </nav>
        <Routes>
          <Route path="/" element={<CreatePoll />} />
          <Route path="/p/:id" element={<PollPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
