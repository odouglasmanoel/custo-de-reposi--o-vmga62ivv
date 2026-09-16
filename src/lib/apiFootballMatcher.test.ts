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
      expect(cleanTeamName('SE Palmeiras')).toBe('palmeiras')
      expect(cleanTeamName('Atlético Mineiro')).toBe('atletico mineiro')
      expect(cleanTeamName('Real Madrid C.F.')).toBe('real madrid')
    })

    it('deve normalizar sinônimos como LDU e Liga de Quito para a forma canônica', () => {
      expect(cleanTeamName('LDU')).toBe('ldu quito')
      expect(cleanTeamName('Liga de Quito')).toBe('ldu quito')
      expect(cleanTeamName('Liga Deportiva Universitaria')).toBe('ldu quito')
      expect(stringSimilarity('LDU', 'Liga de Quito')).toBe(1)
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

    it('deve suportar dados no formato do Football-Data.org com marcadores de gols', () => {
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
          scorers: [
            { name: 'Vinícius Júnior', minute: 12 },
            { name: 'Robert Lewandowski', minute: 18 },
            { name: 'Jude Bellingham', minute: 21 },
          ],
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
      expect(match?.scorers).toHaveLength(3)
      expect(match?.golsSummary).toBe(
        "Gols: Vinícius Júnior 12', Robert Lewandowski 18', Jude Bellingham 21'",
      )
    })

    it('deve extrair marcadores formatados de API-Football / TheSportsDB', () => {
      const fixtureWithScorers: ApiFootballFixture[] = [
        {
          provider: 'api_football',
          fixture: {
            id: 888,
            status: { short: '2H', long: 'Second Half', elapsed: 65 },
          },
          teams: {
            home: { id: 50, name: 'LDU' },
            away: { id: 51, name: 'Palmeiras' },
          },
          goals: { home: 1, away: 1 },
          scorers: [
            { name: 'Luis Segovia', minute: 30 },
            { name: 'Marlon Freitas', minute: 55 },
          ],
        },
      ]

      const match = matchGameWithApiFixtures('LDU', 'Palmeiras', fixtureWithScorers)
      expect(match).not.toBeNull()
      expect(match?.placarA).toBe(1)
      expect(match?.placarB).toBe(1)
      expect(match?.isLive).toBe(true)
      expect(match?.isFinished).toBe(false)
      expect(match?.golsSummary).toBe("Gols: Luis Segovia 30', Marlon Freitas 55'")
      expect(match?.scorers).toHaveLength(2)
      expect(match?.scorers[0].name).toBe('Luis Segovia')
      expect(match?.scorers[1].name).toBe('Marlon Freitas')
    })

    it('deve encontrar correspondência com nomes alternativos como Liga de Quito x Palmeiras', () => {
      const fixtureLigaQuito: ApiFootballFixture[] = [
        {
          provider: 'api_football',
          fixture: {
            id: 9991,
            date: '2026-09-16T22:00:00Z',
            status: { short: '2H', long: 'Second Half', elapsed: 78 },
          },
          teams: {
            home: { id: 50, name: 'Liga de Quito' },
            away: { id: 51, name: 'SE Palmeiras' },
          },
          goals: { home: 1, away: 1 },
          scorers: [
            { name: 'Luis Segovia', minute: 30 },
            { name: 'Marlon Freitas', minute: 55 },
          ],
        },
      ]

      // Cadastrado no Bolão como "LDU" x "Palmeiras"
      const match = matchGameWithApiFixtures('LDU', 'Palmeiras', fixtureLigaQuito)
      expect(match).not.toBeNull()
      expect(match?.found).toBe(true)
      expect(match?.placarA).toBe(1)
      expect(match?.placarB).toBe(1)
      expect(match?.isLive).toBe(true)
    })

    it('deve identificar partida encerrada corretamente (status FT ou FINISHED)', () => {
      const finishedFixtures: ApiFootballFixture[] = [
        {
          provider: 'api_football',
          fixture: {
            id: 777,
            date: '2026-09-16T19:00:00Z',
            status: { short: 'FT', long: 'Match Finished' },
          },
          teams: {
            home: { id: 50, name: 'LDU' },
            away: { id: 51, name: 'Palmeiras' },
          },
          goals: { home: 2, away: 1 },
          scorers: [
            { name: 'Luis Segovia', minute: 30 },
            { name: 'Marlon Freitas', minute: 55 },
            { name: 'Veiga', minute: 89 },
          ],
        },
      ]

      const match = matchGameWithApiFixtures('LDU', 'Palmeiras', finishedFixtures)
      expect(match).not.toBeNull()
      expect(match?.isLive).toBe(false)
      expect(match?.isFinished).toBe(true)
      expect(match?.displayLabel).toBe('Encerrado 2 x 1')
    })

    it('deve priorizar fixture que bate a data informada no fuso America/Sao_Paulo', () => {
      const multiDateFixtures: ApiFootballFixture[] = [
        {
          provider: 'api_football',
          fixture: {
            id: 111,
            date: '2026-05-10T19:00:00Z',
            status: { short: 'FT', long: 'Match Finished' },
          },
          teams: {
            home: { id: 50, name: 'LDU' },
            away: { id: 51, name: 'Palmeiras' },
          },
          goals: { home: 0, away: 0 },
        },
        {
          provider: 'api_football',
          fixture: {
            id: 222,
            date: '2026-09-16T22:00:00Z', // 19:00 SP
            status: { short: '2H', long: 'Second Half', elapsed: 60 },
          },
          teams: {
            home: { id: 50, name: 'LDU' },
            away: { id: 51, name: 'Palmeiras' },
          },
          goals: { home: 1, away: 1 },
        },
      ]

      const match = matchGameWithApiFixtures(
        'LDU',
        'Palmeiras',
        multiDateFixtures,
        0.6,
        '2026-09-16',
      )
      expect(match).not.toBeNull()
      expect(match?.fixtureId).toBe(222)
      expect(match?.placarA).toBe(1)
      expect(match?.placarB).toBe(1)
    })
    it('deve lidar graciosamente quando não houver marcadores disponíveis', () => {
      const fixtureWithoutScorers: ApiFootballFixture[] = [
        {
          provider: 'thesportsdb',
          fixture: {
            id: 999,
            status: { short: '1H', long: 'Live', elapsed: 10 },
          },
          teams: {
            home: { id: 70, name: 'Flamengo' },
            away: { id: 71, name: 'Corinthians' },
          },
          goals: { home: 0, away: 0 },
          scorers: [],
        },
      ]

      const match = matchGameWithApiFixtures('Flamengo', 'Corinthians', fixtureWithoutScorers)
      expect(match).not.toBeNull()
      expect(match?.placarA).toBe(0)
      expect(match?.placarB).toBe(0)
      expect(match?.scorers).toEqual([])
      expect(match?.golsSummary).toBe('')
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
