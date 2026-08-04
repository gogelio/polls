// FNV-1a 32-bit hash. Not cryptographic — only needs to look unpredictable
// to a human, and to be fast and dependency-free.
function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function shuffleKey(participantId: string, nominationId: string): number {
  return fnv1a(`${participantId}:${nominationId}`)
}

export function shuffleByParticipant<T extends { id: string }>(items: T[], participantId: string): T[] {
  return [...items].sort(
    (a, b) => shuffleKey(participantId, a.id) - shuffleKey(participantId, b.id)
  )
}
