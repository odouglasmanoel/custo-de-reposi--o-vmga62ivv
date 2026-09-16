import { describe, it, expect } from 'vitest'
import { parseScoreString, calculateMatchScore } from './spreadsheetParser'

describe('parseScoreString', () => {
  it('handles standard score patterns "1x2", "1 x 2", "1-2"', () => {
    expect(parseScoreString('1x2')).toEqual({ placarA: 1, placarB: 2 })
    expect(parseScoreString('1 x 2')).toEqual({ placarA: 1, placarB: 2 })
    expect(parseScoreString('1-2')).toEqual({ placarA: 1, placarB: 2 })
    expect(parseScoreString('0 x 0')).toEqual({ placarA: 0, placarB: 0 })
    expect(parseScoreString('3:1')).toEqual({ placarA: 3, placarB: 1 })
  })

  it('handles score with additional text e.g. "1x2 (Carbonero...)"', () => {
    expect(parseScoreString('1x2 (Carbonero...)')).toEqual({ placarA: 1, placarB: 2 })
    expect(parseScoreString('0x0 (pênaltis 4x2)')).toEqual({ placarA: 0, placarB: 0 })
    expect(parseScoreString("2 x 1 (Gol aos 90')")).toEqual({ placarA: 2, placarB: 1 })
    expect(parseScoreString('3-0 - W.O.')).toEqual({ placarA: 3, placarB: 0 })
  })

  it('returns null for empty or invalid values', () => {
    expect(parseScoreString('')).toBeNull()
    expect(parseScoreString(null)).toBeNull()
    expect(parseScoreString(undefined)).toBeNull()
    expect(parseScoreString('Pendente')).toBeNull()
    expect(parseScoreString('-')).toBeNull()
  })
})

describe('calculateMatchScore', () => {
  it('scores exact match (+8 pts)', () => {
    const res = calculateMatchScore(2, 1, 2, 1)
    expect(res.pontos).toBe(8)
    expect(res.detalhamento).toContain('Placar Exato (+8 pts)')
  })

  it('scores winner (+2 pts) and goal difference (+1 pt)', () => {
    const res = calculateMatchScore(3, 1, 2, 0)
    expect(res.pontos).toBe(3) // 2 (vencedor) + 1 (diferença)
  })

  it('scores draw (+2 pts) and goal difference (+1 pt)', () => {
    const res = calculateMatchScore(1, 1, 2, 2)
    expect(res.pontos).toBe(3) // 2 (empate) + 1 (diferença)
  })

  it('scores half score (+1 pt)', () => {
    const res = calculateMatchScore(1, 0, 1, 2)
    expect(res.pontos).toBe(1) // metade do placar
  })
})
