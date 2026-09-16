import { describe, it, expect } from 'vitest'
import {
  cleanTeamName,
  stringSimilarity,
  isFixtureLive,
  matchGameWithApiFixtures,
  type ApiFootballFixture,
} from './apiFootballMatcher'

describe('apiFootballMatcher', () => {
  describe('cleanTeamName', () => {
    it('deve remover acentos e ruídos comuns de times', () => {
      expect(cleanTeamName('São Paulo FC')).toBe('sao paulo')
      expect(cleanTeamName('C.R. Flamengo')).toBe('flamengo')
      expect(cleanTeamName('SE Palmeiras')).toBe('se palmeiras')
      expect(cleanTeamName('Atlético Mineiro')).toBe('mineiro')
      expect(cleanTeamName('Real Madrid C.F.')).toBe('real madrid')
    })
  })

  describe('stringSimilarity', () => {
    it('deve retornar 1 para nomes idênticos após limpeza', () => {
      expect(stringSimilarity('Vasco da Gama', 'Vasco')).toBeGreaterThanOrEqual(0.8)
      expect(stringSimilarity('Palmeiras', 'Palmeiras')).toBe(1)
    })

    it('deve retornar alta similaridade para pequenas variações de grafia', () => {
      expect(stringSimilarity('Corinthians', 'Corinthians Paulista')).toBeGreaterThanOrEqual(0.7)
      expect(stringSimilarity('Flamengo', 'CR Flamengo')).toBeGreaterThanOrEqual(0.8)
    })

    it('deve retornar baixa similaridade para times completamente diferentes', () => {
      expect(stringSimilarity('Palmeiras', 'Flamengo')).toBeLessThan(0.4)
    })
  })

  describe('isFixtureLive', () => {
    it('deve reconhecer status ao vivo de Football-Data.org, TheSportsDB e API-Football', () => {
      expect(isFixtureLive('1H')).toBe(true)
      expect(isFixtureLive('2H')).toBe(true)
      expect(isFixtureLive('HT')).toBe(true)
      expect(isFixtureLive('ET')).toBe(true)
      expect(isFixtureLive('P')).toBe(true)
      expect(isFixtureLive('LIVE')).toBe(true)
      expect(isFixtureLive('IN_PLAY')).toBe(true)
      expect(isFixtureLive('PAUSED')).toBe(true)
    })

    it('deve retornar false para jogos encerrados ou não iniciados', () => {
      expect(isFixtureLive('FT')).toBe(false)
      expect(isFixtureLive('FINISHED')).toBe(false)
      expect(isFixtureLive('TIMED')).toBe(false)
      expect(isFixtureLive('SCHEDULED')).toBe(false)
      expect(isFixtureLive('NS')).toBe(false)
      expect(isFixtureLive('TBD')).toBe(false)
      expect(isFixtureLive('CANC')).toBe(false)
      expect(isFixtureLive(undefined)).toBe(false)
    })
  })

  describe('matchGameWithApiFixtures', () => {
    const mockFixtures: ApiFootballFixture[] = [
      {
        fixture: {
          id: 101,
          status: { short: '1H', long: 'First Half', elapsed: 35 },
        },
        teams: {
          home: { id: 1, name: 'Vasco da Gama' },
          away: { id: 2, name: 'Palmeiras' },
        },
        goals: { home: 1, away: 0 },
      },
      {
        fixture: {
          id: 102,
          status: { short: '2H', long: 'Second Half', elapsed: 72 },
        },
        teams: {
          home: { id: 3, name: 'Flamengo' },
          away: { id: 4, name: 'Fluminense' },
        },
        goals: { home: 2, away: 2 },
      },
    ]

    it('deve encontrar correspondência fuzzy direta (Vasco x Palmeiras)', () => {
      const match = matchGameWithApiFixtures('Vasco', 'Palmeiras', mockFixtures)
      expect(match).not.toBeNull()
      expect(match?.found).toBe(true)
      expect(match?.placarA).toBe(1)
      expect(match?.placarB).toBe(0)
      expect(match?.isLive).toBe(true)
      expect(match?.displayLabel).toContain("AO VIVO 35' • 1 x 0")
    })

    it('deve suportar dados no formato do Football-Data.org', () => {
      const footballDataFixtures: ApiFootballFixture[] = [
        {
          provider: 'football_data',
          fixture: {
            id: 450123,
            status: { short: '1H', long: 'IN_PLAY', elapsed: 22 },
          },
          teams: {
            home: { id: 10, name: 'Real Madrid CF' },
            away: { id: 11, name: 'FC Barcelona' },
          },
          goals: { home: 2, away: 1 },
        },
      ]

      const match = matchGameWithApiFixtures('Real Madrid', 'Barcelona', footballDataFixtures)
      expect(match).not.toBeNull()
      expect(match?.found).toBe(true)
      expect(match?.provider).toBe('football_data')
      expect(match?.placarA).toBe(2)
      expect(match?.placarB).toBe(1)
      expect(match?.isLive).toBe(true)
      expect(match?.displayLabel).toContain("AO VIVO 22' • 2 x 1")
    })

    it('deve suportar inversão de mandante/visitante', () => {
      const match = matchGameWithApiFixtures('Fluminense', 'Flamengo', mockFixtures)
      expect(match).not.toBeNull()
      expect(match?.found).toBe(true)
      // Fluminense é time A (away do fixture = 2) e Flamengo time B (home = 2)
      expect(match?.placarA).toBe(2)
      expect(match?.placarB).toBe(2)
    })

    it('deve retornar null se não encontrar correspondência aceitável', () => {
      const match = matchGameWithApiFixtures('Real Madrid', 'Barcelona', mockFixtures)
      expect(match).toBeNull()
    })

    it('deve lidar com lista de fixtures vazia com segurança sem quebrar', () => {
      const match = matchGameWithApiFixtures('Vasco', 'Palmeiras', [])
      expect(match).toBeNull()
    })
  })
})
