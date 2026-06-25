import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

interface DateTimePickerProps {
  value: Date | null
  onChange: (date: Date | null) => void
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa']
const MINUTES = [0, 15, 30, 45]

function formatDateTime(d: Date): string {
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' at ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  )
}

function Stepper({ value, onUp, onDown }: { value: string; onUp: () => void; onDown: () => void }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button type="button" onClick={onUp} className="text-ink-2 hover:text-ink transition-colors text-xs leading-none py-0.5">▲</button>
      <span className="text-sm font-semibold text-ink w-7 text-center tabular-nums">{value}</span>
      <button type="button" onClick={onDown} className="text-ink-2 hover:text-ink transition-colors text-xs leading-none py-0.5">▼</button>
    </div>
  )
}

export function DateTimePicker({ value, onChange }: DateTimePickerProps) {
  const [open, setOpen] = useState(false)
  const [popPos, setPopPos] = useState({ top: 0, left: 0, width: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Calendar view navigation (which month is displayed)
  const [viewYear, setViewYear] = useState(new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(new Date().getMonth())

  // Draft selection (uncommitted until Confirm)
  const [draftYear, setDraftYear] = useState(new Date().getFullYear())
  const [draftMonth, setDraftMonth] = useState(new Date().getMonth())
  const [draftDay, setDraftDay] = useState(new Date().getDate())
  const [draftHour, setDraftHour] = useState(11)      // 1–12
  const [draftMinute, setDraftMinute] = useState(45)  // 0 | 15 | 30 | 45
  const [draftAmPm, setDraftAmPm] = useState<'AM' | 'PM'>('PM')

  const seedDraft = useCallback((d: Date | null) => {
    const ref = d ?? new Date()
    setViewYear(ref.getFullYear())
    setViewMonth(ref.getMonth())
    setDraftYear(ref.getFullYear())
    setDraftMonth(ref.getMonth())
    setDraftDay(ref.getDate())
    if (d) {
      const h = d.getHours()
      setDraftAmPm(h >= 12 ? 'PM' : 'AM')
      setDraftHour(h % 12 || 12)
      const m = Math.round(d.getMinutes() / 15) * 15
      setDraftMinute(m >= 60 ? 45 : m)
    } else {
      // Default to 11:45 PM when no value is set
      setDraftHour(11)
      setDraftMinute(45)
      setDraftAmPm('PM')
    }
  }, [])

  const openPicker = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPopPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
    seedDraft(value)
    setOpen(true)
  }

  const confirm = () => {
    const h24 =
      draftAmPm === 'PM'
        ? draftHour === 12 ? 12 : draftHour + 12
        : draftHour === 12 ? 0 : draftHour
    onChange(new Date(draftYear, draftMonth, draftDay, h24, draftMinute, 0, 0))
    setOpen(false)
  }

  const clear = () => {
    onChange(null)
    setOpen(false)
  }

  // Dismiss on click outside
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Dismiss on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  // Calendar helpers
  const today = new Date()
  const todayY = today.getFullYear()
  const todayM = today.getMonth()
  const todayD = today.getDate()

  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array<null>(firstDayOfWeek).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  const isPast = (day: number) =>
    new Date(viewYear, viewMonth, day) < new Date(todayY, todayM, todayD)
  const isSelected = (day: number) =>
    viewYear === draftYear && viewMonth === draftMonth && day === draftDay
  const isToday = (day: number) =>
    viewYear === todayY && viewMonth === todayM && day === todayD

  const stepHour = (dir: 1 | -1) =>
    setDraftHour(h => { const n = h + dir; return n > 12 ? 1 : n < 1 ? 12 : n })
  const stepMinute = (dir: 1 | -1) => {
    setDraftMinute((m): number => {
      const idx = MINUTES.indexOf(m)
      let n = idx + dir
      if (n >= MINUTES.length) n = 0
      else if (n < 0) n = MINUTES.length - 1
      return MINUTES[n]!
    })
  }

  const popover = (
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        top: popPos.top,
        left: popPos.left,
        width: Math.max(popPos.width, 260),
        zIndex: 9999,
      }}
      className="bg-[var(--surface)] border border-line rounded-2xl shadow-2xl p-4 space-y-4"
    >
      {/* Calendar */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={prevMonth}
            className="text-ink-2 hover:text-ink w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--hover)] transition-colors"
          >
            ‹
          </button>
          <span className="text-sm font-semibold text-ink">{MONTHS[viewMonth]} {viewYear}</span>
          <button
            type="button"
            onClick={nextMonth}
            className="text-ink-2 hover:text-ink w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--hover)] transition-colors"
          >
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 mb-1">
          {DAYS.map(d => (
            <span key={d} className="text-xs font-semibold text-ink-3 text-center py-1">{d}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1">
          {cells.map((day, i) => {
            if (day === null) return <span key={i} />
            const past = isPast(day)
            const sel = isSelected(day)
            const tod = isToday(day)
            return (
              <button
                key={i}
                type="button"
                disabled={past}
                onClick={() => { setDraftYear(viewYear); setDraftMonth(viewMonth); setDraftDay(day) }}
                className={[
                  'w-8 h-8 mx-auto rounded-full text-sm transition-colors flex items-center justify-center',
                  past ? 'text-ink-3 opacity-30 cursor-not-allowed' : 'cursor-pointer',
                  sel ? 'bg-accent text-white' : '',
                  tod && !sel ? 'ring-1 ring-accent text-accent' : '',
                  !past && !sel ? 'hover:bg-[var(--hover)] text-ink' : '',
                ].filter(Boolean).join(' ')}
              >
                {day}
              </button>
            )
          })}
        </div>
      </div>

      <div className="border-t border-line" />

      {/* Time picker */}
      <div className="flex items-center justify-center gap-3">
        <Stepper
          value={String(draftHour).padStart(2, '0')}
          onUp={() => stepHour(1)}
          onDown={() => stepHour(-1)}
        />
        <span className="text-ink-2 font-bold text-lg">:</span>
        <Stepper
          value={String(draftMinute).padStart(2, '0')}
          onUp={() => stepMinute(1)}
          onDown={() => stepMinute(-1)}
        />
        <button
          type="button"
          onClick={() => setDraftAmPm(ap => ap === 'AM' ? 'PM' : 'AM')}
          className="text-sm font-semibold text-ink-2 hover:text-ink px-3 py-1.5 rounded-lg border border-line hover:border-line-bright transition-colors"
        >
          {draftAmPm}
        </button>
      </div>

      <div className="border-t border-line" />

      {/* Actions */}
      <div className="flex items-center justify-between">
        {value ? (
          <button
            type="button"
            onClick={clear}
            className="text-sm text-ink-3 hover:text-ink transition-colors"
          >
            Clear
          </button>
        ) : <span />}
        <button
          type="button"
          onClick={confirm}
          className="bg-accent hover:bg-accent-hover text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
        >
          Confirm
        </button>
      </div>
    </div>
  )

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openPicker}
        className="input flex items-center justify-between text-left w-full"
      >
        <span className={`flex items-center gap-2 min-w-0 ${value ? 'text-ink' : 'text-ink-3'}`}>
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0121 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
          <span className="text-sm truncate">{value ? formatDateTime(value) : 'No deadline'}</span>
        </span>
        {value && (
          <span
            role="button"
            onClick={e => { e.stopPropagation(); clear() }}
            className="text-ink-3 hover:text-ink transition-colors ml-1 flex-shrink-0 text-base leading-none"
          >
            ×
          </span>
        )}
      </button>
      {open && createPortal(popover, document.body)}
    </>
  )
}
