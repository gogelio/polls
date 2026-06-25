import { useCallback } from 'react'

export function useSpotlight() {
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const container = e.currentTarget as HTMLElement
    const cards = container.querySelectorAll<HTMLElement>('.spotlight-card')
    for (const card of cards) {
      const rect = card.getBoundingClientRect()
      card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`)
      card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`)
    }
  }, [])

  return { onMouseMove }
}
