import { describe, expect, it } from 'vitest'
import { hashSource } from './hash'

describe('hashSource', () => {
  it('is stable across calls', () => {
    const text = '# Block 2\n## Day A\n- Squat 5x5\n'
    expect(hashSource(text)).toBe(hashSource(text))
  })

  it('changes when the routine changes', () => {
    expect(hashSource('- Squat 5x5')).not.toBe(hashSource('- Squat 4x5'))
  })

  it('notices an edit inside a line, since that is content', () => {
    expect(hashSource('- Squat 5x5')).not.toBe(hashSource('- Squat  5x5'))
  })

  it('ignores the BOM a spreadsheet export prepends', () => {
    expect(hashSource('﻿exercise,sets')).toBe(hashSource('exercise,sets'))
  })

  it('ignores line-ending differences between publishes', () => {
    expect(hashSource('a\r\nb\r\nc')).toBe(hashSource('a\nb\nc'))
  })

  it('ignores trailing blank lines, which a sheet gains and loses on its own', () => {
    expect(hashSource('a\nb\n\n\n')).toBe(hashSource('a\nb'))
  })

  it('is eight hex characters, so it reads sanely in a debug line', () => {
    expect(hashSource('anything at all')).toMatch(/^[0-9a-f]{8}$/)
  })

  it('separates inputs that a weaker hash would collide', () => {
    const seen = new Set(
      ['Squat 5x5', 'Squat 5x6', 'Squat 6x5', 'Bench 5x5', 'Squat 5x5 ', ' Squat 5x5'].map(
        hashSource,
      ),
    )
    expect(seen.size).toBe(6)
  })
})
