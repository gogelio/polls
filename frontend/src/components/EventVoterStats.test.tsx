// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { EventVoterStats } from './EventVoterStats'

afterEach(() => cleanup())

describe('EventVoterStats', () => {
  it('renders luckiest and unluckiest overall lists', () => {
    render(
      <EventVoterStats
        luckiest={[{ name: 'Alice', average_score: 1, categories_counted: 2 }]}
        unluckiest={[{ name: 'Bob', average_score: 0, categories_counted: 2 }]}
      />
    )
    expect(screen.getByText('🍀 Luckiest Overall')).toBeTruthy()
    expect(screen.getByText('💔 Unluckiest Overall')).toBeTruthy()
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.getByText('Bob')).toBeTruthy()
  })

  it('renders nothing when both lists are empty', () => {
    const { container } = render(<EventVoterStats luckiest={[]} unluckiest={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
