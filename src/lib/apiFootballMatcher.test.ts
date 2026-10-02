import { describe, it, expect } from 'vitest'
import {
  cleanTeamName,
  stringSimilarity,
  isFixtureLive,
  isFixturePostponed,
  isFixtureCancelled,
  matchGameWithApiFixtures,
  resolveLiveScoreForGame,
  formatFixtureToLiveScore,
  deriveScoresFromEvents,
  getFixtureDateSaoPaulo,
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

    it('deve normalizar PSG, Marseille, Bournemouth e Atlético de Madrid com similaridade >= 0.85', () => {
      // PSG
      expect(cleanTeamName('PSG')).toBe('paris saint germain')
      expect(cleanTeamName('Paris Saint-Germain')).toBe('paris saint germain')
      expect(stringSimilarity('PSG', 'Paris Saint-Germain')).toBeGreaterThanOrEqual(0.85)

      // Marseille
      expect(cleanTeamName('Marseille')).toBe('olympique marseille')
      expect(cleanTeamName('Olympique de Marseille')).toBe('olympique marseille')
      expect(stringSimilarity('Marseille', 'Olympique de Marseille')).toBeGreaterThanOrEqual(0.85)

      // Bournemouth
      expect(cleanTeamName('Bournemouth')).toBe('bournemouth')
      expect(cleanTeamName('AFC Bournemouth')).toBe('bournemouth')
      expect(stringSimilarity('Bournemouth', 'AFC Bournemouth')).toBeGreaterThanOrEqual(0.85)

      // Atlético de Madrid
      expect(cleanTeamName('Atlético Madrid')).toBe('atletico madrid')
      expect(cleanTeamName('Atlético de Madrid')).toBe('atletico madrid')
      expect(stringSimilarity('Atlético Madrid', 'Atlético de Madrid')).toBeGreaterThanOrEqual(0.85)
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

  describe('isFixturePostponed e isFixtureCancelled (PST e CANC)', () => {
    it('deve identificar jogos adiados nos dialetos de API-Football e Football-Data.org', () => {
      expect(isFixturePostponed('PST')).toBe(true)
      expect(isFixturePostponed('POSTP')).toBe(true)
      expect(isFixturePostponed(undefined, 'POSTPONED')).toBe(true)
      expect(isFixturePostponed(undefined, 'Match Postponed')).toBe(true)
      expect(isFixturePostponed('FT')).toBe(false)
      expect(isFixturePostponed('1H')).toBe(false)
    })

    it('deve identificar jogos cancelados/suspensos nos dialetos de API-Football e Football-Data.org', () => {
      expect(isFixtureCancelled('CANC')).toBe(true)
      expect(isFixtureCancelled('CANCELLED')).toBe(true)
      expect(isFixtureCancelled('SUSP')).toBe(true)
      expect(isFixtureCancelled('ABD')).toBe(true)
      expect(isFixtureCancelled(undefined, 'Cancelled')).toBe(true)
      expect(isFixtureCancelled(undefined, 'Match Suspended')).toBe(true)
      expect(isFixtureCancelled('FT')).toBe(false)
      expect(isFixtureCancelled('NS')).toBe(false)
    })
  })

  describe('getFixtureDateSaoPaulo (Filtro rigoroso America/Sao_Paulo)', () => {
    it('converte corretamente partida UTC da noite para a data local de Brasília', () => {
      // Jogo de ontem 23h00 em SP = 02h00 UTC do dia seguinte
      // Ex: 2026-06-16T01:30:00Z -> 2026-06-15 22:30:00 em SP
      expect(getFixtureDateSaoPaulo('2026-06-16T01:30:00Z')).toBe('2026-06-15')
      // Jogo das 20h00 em SP = 23h00 UTC do mesmo dia
      expect(getFixtureDateSaoPaulo('2026-06-15T23:00:00Z')).toBe('2026-06-15')
      // Jogo na madrugada em Londres (02:00 UTC) = dia anterior em SP (23:00)
      expect(getFixtureDateSaoPaulo('2026-06-16T02:00:00Z')).toBe('2026-06-15')
      // Jogo às 03:00 UTC = 00:00 (meia-noite) em SP já é dia 16
      expect(getFixtureDateSaoPaulo('2026-06-16T03:00:00Z')).toBe('2026-06-16')
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

    it('deve suportar contingência do Football-Data.org com separação por equipe mandante/visitante', () => {
      const contingencyFixtures: ApiFootballFixture[] = [
        {
          provider: 'football_data',
          fixture: {
            id: 50012,
            status: { short: '2H', long: 'IN_PLAY', elapsed: 68 },
          },
          teams: {
            home: { id: 100, name: 'Flamengo' },
            away: { id: 200, name: 'Palmeiras' },
          },
          goals: { home: 2, away: 1 },
          scorers: [
            { name: 'Pedro', minute: 14, teamSide: 'home', teamId: 100 },
            { name: 'Raphael Veiga', minute: 35, teamSide: 'away', teamId: 200 },
            { name: 'Arrascaeta', minute: 60, teamSide: 'home', teamId: 100 },
          ],
        },
      ]

      const match = matchGameWithApiFixtures('Flamengo', 'Palmeiras', contingencyFixtures)
      expect(match).not.toBeNull()
      expect(match?.found).toBe(true)
      expect(match?.provider).toBe('football_data')
      expect(match?.placarA).toBe(2)
      expect(match?.placarB).toBe(1)
      expect(match?.isLive).toBe(true)
      expect(match?.elapsed).toBe(68)
      expect(match?.scorers).toHaveLength(3)
      expect(match?.scorers[0].teamSide).toBe('home')
      expect(match?.scorers[1].teamSide).toBe('away')
      expect(match?.scorers[2].teamSide).toBe('home')
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

    it('extrai marcadores a partir de events do tipo Goal se scorers não veio preenchido', () => {
      const fixtures: ApiFootballFixture[] = [
        {
          provider: 'api_football',
          fixture: {
            id: 888,
            date: '2026-09-16T22:30:00Z',
            status: { short: '1H', long: 'First Half', elapsed: 35 },
          },
          teams: {
            home: { id: 10, name: 'LDU Quito' },
            away: { id: 20, name: 'Palmeiras' },
          },
          goals: { home: 1, away: 0 },
          events: [
            {
              type: 'Goal',
              detail: 'Normal Goal',
              player: { name: 'Alex Arce' },
              time: { elapsed: 28 },
              team: { id: 10, name: 'LDU Quito' },
            },
            {
              type: 'Card',
              player: { name: 'Gustavo Gómez' },
              time: { elapsed: 32 },
            },
          ],
        },
      ]

      const matched = matchGameWithApiFixtures('LDU', 'Palmeiras', fixtures)
      expect(matched).not.toBeNull()
      expect(matched?.placarA).toBe(1)
      expect(matched?.placarB).toBe(0)
      expect(matched?.scorers).toHaveLength(1)
      expect(matched?.scorers[0].name).toBe('Alex Arce')
      expect(matched?.scorers[0].minute).toBe(28)
      expect(matched?.golsSummary).toBe("Gols: Alex Arce 28'")
    })

    it('faz match de Atlético-MG vs Atletico Mineiro com acentuação e traço', () => {
      const fixtures: ApiFootballFixture[] = [
        {
          provider: 'api_football',
          fixture: {
            id: 991,
            date: '2026-09-16T21:30:00Z',
            status: { short: '2H', long: 'Second Half', elapsed: 80 },
          },
          teams: {
            home: { name: 'Atletico Mineiro' },
            away: { name: 'Fluminense' },
          },
          goals: { home: 2, away: 0 },
          scorers: [
            { name: 'Hulk', minute: 30 },
            { name: 'Paulinho', minute: 75 },
          ],
        },
      ]

      const matched = matchGameWithApiFixtures('Atlético-MG', 'Fluminense', fixtures)
      expect(matched).not.toBeNull()
      expect(matched?.placarA).toBe(2)
      expect(matched?.placarB).toBe(0)
      expect(matched?.scorers[0].name).toBe('Hulk')
    })

    it('quando o jogo não for encontrado, retorna null permitindo fallback sem forçar 0 x 0 falso', () => {
      const fixtures: ApiFootballFixture[] = [
        {
          provider: 'api_football',
          fixture: {
            id: 999,
            date: '2026-09-16T22:30:00Z',
            status: { short: '1H', long: 'First Half', elapsed: 10 },
          },
          teams: {
            home: { name: 'Chelsea' },
            away: { name: 'Arsenal' },
          },
          goals: { home: 1, away: 0 },
        },
      ]
      const matched = matchGameWithApiFixtures('Flamengo', 'Fluminense', fixtures)
      expect(matched).toBeNull()
    })
  })

  describe('resolveLiveScoreForGame (prioridade fixture_id vs fallback por texto)', () => {
    const apiFixturesSample: ApiFootballFixture[] = [
      {
        provider: 'api_football',
        fixture: {
          id: 1208456,
          status: { short: '2H', long: 'Second Half', elapsed: 75 },
        },
        teams: {
          home: { id: 10, name: 'Flamengo' },
          away: { id: 20, name: 'Palmeiras' },
        },
        goals: { home: 3, away: 1 },
        events: [
          {
            type: 'Goal',
            player: { name: 'Pedro' },
            time: { elapsed: 12 },
            team: { id: 10, name: 'Flamengo' },
          },
          {
            type: 'Goal',
            player: { name: 'Arrascaeta' },
            time: { elapsed: 44 },
            team: { id: 10, name: 'Flamengo' },
          },
          {
            type: 'Goal',
            player: { name: 'Veiga' },
            time: { elapsed: 58 },
            team: { id: 20, name: 'Palmeiras' },
          },
          {
            type: 'Goal',
            player: { name: 'Gabi' },
            time: { elapsed: 70 },
            team: { id: 10, name: 'Flamengo' },
          },
        ],
      },
      {
        provider: 'api_football',
        fixture: {
          id: 999999,
          status: { short: '1H', long: 'First Half', elapsed: 20 },
        },
        teams: {
          home: { id: 30, name: 'Corinthians' },
          away: { id: 40, name: 'São Paulo' },
        },
        goals: { home: 0, away: 1 },
        events: [
          {
            type: 'Goal',
            player: { name: 'Lucas Moura' },
            time: { elapsed: 15 },
          },
        ],
      },
    ]

    it('deve priorizar a busca direta por fixture_id quando preenchido no jogo', () => {
      const jogoComId = {
        time_a: 'Fla',
        time_b: 'Pal',
        fixture_id: '1208456',
      }

      const res = resolveLiveScoreForGame(jogoComId, apiFixturesSample)
      expect(res).not.toBeNull()
      expect(res?.matchedBy).toBe('fixture_id')
      expect(res?.fixtureId).toBe(1208456)
      expect(res?.placarA).toBe(3)
      expect(res?.placarB).toBe(1)
      expect(res?.isLive).toBe(true)
      expect(res?.elapsed).toBe(75)
      expect(res?.displayLabel).toContain("AO VIVO 75' • 3 x 1")
      expect(res?.scorers).toHaveLength(4)
      expect(res?.scorers[0].name).toBe('Pedro')
      expect(res?.scorers[1].name).toBe('Arrascaeta')
      expect(res?.golsSummary).toContain('Pedro')
    })

    it('deve funcionar com fixture_id numérico ou string com espaços', () => {
      const jogoComId = {
        time_a: 'Flamengo',
        time_b: 'Palmeiras',
        fixture_id: '  1208456  ',
      }

      const res = resolveLiveScoreForGame(jogoComId, apiFixturesSample)
      expect(res).not.toBeNull()
      expect(res?.matchedBy).toBe('fixture_id')
      expect(res?.fixtureId).toBe(1208456)
    })

    it('se fixture_id não for encontrado na lista, faz fallback automático para matching por texto', () => {
      const jogoComIdInexistente = {
        time_a: 'Corinthians',
        time_b: 'São Paulo',
        fixture_id: '88888888', // não existe na lista mockada
      }

      const res = resolveLiveScoreForGame(jogoComIdInexistente, apiFixturesSample)
      expect(res).not.toBeNull()
      expect(res?.matchedBy).toBe('text')
      expect(res?.fixtureId).toBe(999999)
      expect(res?.placarA).toBe(0)
      expect(res?.placarB).toBe(1)
      expect(res?.scorers[0].name).toBe('Lucas Moura')
    })

    it('quando fixture_id estiver vazio ou nulo, usa matching por texto diretamente', () => {
      const jogoSemId = {
        time_a: 'Corinthians',
        time_b: 'São Paulo',
        fixture_id: '',
      }

      const res = resolveLiveScoreForGame(jogoSemId, apiFixturesSample)
      expect(res).not.toBeNull()
      expect(res?.matchedBy).toBe('text')
      expect(res?.fixtureId).toBe(999999)
      expect(res?.placarA).toBe(0)
      expect(res?.placarB).toBe(1)
    })

    it('faz matching por substring para nomes com variações como LDU vs LDU Quito e Atletico-MG vs Club Atletico Mineiro', () => {
      const fixtures: ApiFootballFixture[] = [
        {
          provider: 'api_football',
          fixture: {
            id: 1001,
            date: '2026-09-17T00:30:00Z',
            status: { short: '2H', long: 'Second Half', elapsed: 72 },
          },
          teams: {
            home: { name: 'Club Atletico Mineiro' },
            away: { name: 'LDU Quito' },
          },
          goals: { home: 3, away: 1 },
          events: [
            {
              type: 'Goal',
              detail: 'Normal Goal',
              player: { name: 'Hulk' },
              time: { elapsed: 15 },
            },
            {
              type: 'Goal',
              detail: 'Normal Goal',
              player: { name: 'Alex Arce' },
              time: { elapsed: 35 },
            },
            {
              type: 'Goal',
              detail: 'Normal Goal',
              player: { name: 'Gustavo Scarpa' },
              time: { elapsed: 60 },
            },
            {
              type: 'Goal',
              detail: 'Normal Goal',
              player: { name: 'Paulinho' },
              time: { elapsed: 70 },
            },
          ],
        },
      ]

      // Busca usando "Atlético-MG" e "LDU"
      const matched = matchGameWithApiFixtures('Atlético-MG', 'LDU', fixtures)
      expect(matched).not.toBeNull()
      expect(matched?.placarA).toBe(3)
      expect(matched?.placarB).toBe(1)
      expect(matched?.scorers).toHaveLength(4)
      expect(matched?.scorers.map((s) => s.name)).toEqual([
        'Hulk',
        'Alex Arce',
        'Gustavo Scarpa',
        'Paulinho',
      ])
      expect(matched?.golsSummary).toBe(
        "Gols: Hulk 15', Alex Arce 35', Gustavo Scarpa 60', Paulinho 70'",
      )
    })

    it('extrai corretamente gols contra com sufixo (contra)', () => {
      const fixtures: ApiFootballFixture[] = [
        {
          provider: 'api_football',
          fixture: {
            id: 1002,
            date: '2026-09-17T02:00:00Z',
            status: { short: '1H', long: 'First Half', elapsed: 40 },
          },
          teams: {
            home: { id: 100, name: 'Flamengo' },
            away: { id: 200, name: 'Palmeiras' },
          },
          goals: { home: 1, away: 0 },
          events: [
            {
              type: 'Goal',
              detail: 'Own Goal',
              player: { name: 'Gustavo Gómez' },
              time: { elapsed: 22 },
              team: { id: 100, name: 'Flamengo' },
            },
          ],
        },
      ]

      const matched = matchGameWithApiFixtures('Flamengo', 'Palmeiras', fixtures)
      expect(matched).not.toBeNull()
      expect(matched?.scorers[0].name).toBe('Gustavo Gómez (contra)')
    })

    it('deve ignorar eventos de pênalti perdido (Missed Penalty) sem gerar marcador, mantendo Normal Goal, Penalty e Own Goal', () => {
      const fixtures: ApiFootballFixture[] = [
        {
          fixture: { id: 1528881, status: { short: 'FT', long: 'Match Finished' } },
          teams: {
            home: { id: 1104, name: 'Geórgia' },
            away: { id: 771, name: 'Irlanda do Norte' },
          },
          goals: { home: 0, away: 1 },
          events: [
            {
              type: 'Goal',
              detail: 'Missed Penalty',
              player: { name: 'Khvicha Kvaratskhelia' },
              time: { elapsed: 65 },
              team: { id: 1104, name: 'Geórgia' },
            },
            {
              type: 'Goal',
              detail: 'Normal Goal',
              player: { name: 'Shea Charles' },
              time: { elapsed: 90 },
              team: { id: 771, name: 'Irlanda do Norte' },
            },
          ],
        },
      ]

      // Teste via matchGameWithApiFixtures
      const matched = matchGameWithApiFixtures('Geórgia', 'Irlanda do Norte', fixtures)
      expect(matched).not.toBeNull()
      expect(matched?.scorers).toHaveLength(1)
      expect(matched?.scorers[0].name).toBe('Shea Charles')
      expect(matched?.scorers[0].minute).toBe(90)

      // Teste via formatFixtureToLiveScore (matching direto por fixture_id)
      const direct = formatFixtureToLiveScore(fixtures[0], 'Geórgia', 'Irlanda do Norte')
      expect(direct.scorers).toHaveLength(1)
      expect(direct.scorers[0].name).toBe('Shea Charles')
      expect(direct.golsSummary).toBe("Gols: Shea Charles 90'")
    })

    it('deve gerar marcadores válidos para Penalty convertido, Normal Goal e Own Goal', () => {
      const fixture: ApiFootballFixture = {
        fixture: { id: 999999, status: { short: 'FT', long: 'Match Finished' } },
        teams: {
          home: { id: 10, name: 'Time A' },
          away: { id: 20, name: 'Time B' },
        },
        goals: { home: 2, away: 1 },
        events: [
          {
            type: 'Goal',
            detail: 'Penalty',
            player: { name: 'Jogador Penalti' },
            time: { elapsed: 30 },
            team: { id: 10, name: 'Time A' },
          },
          {
            type: 'Goal',
            detail: 'Normal Goal',
            player: { name: 'Jogador Normal' },
            time: { elapsed: 55 },
            team: { id: 10, name: 'Time A' },
          },
          {
            type: 'Goal',
            detail: 'Own Goal',
            player: { name: 'Jogador Contra' },
            time: { elapsed: 75 },
            team: { id: 20, name: 'Time B' },
          },
          {
            type: 'Goal',
            detail: 'Penalty Missed',
            player: { name: 'Jogador Errou' },
            time: { elapsed: 88 },
            team: { id: 20, name: 'Time B' },
          },
        ],
      }

      const formatted = formatFixtureToLiveScore(fixture, 'Time A', 'Time B')
      expect(formatted.scorers).toHaveLength(3)
      expect(formatted.scorers.map((s) => s.name)).toEqual([
        'Jogador Penalti',
        'Jogador Normal',
        'Jogador Contra (contra)',
      ])
    })
  })

  describe('deriveScoresFromEvents - não-regressão de derivação e alinhamento', () => {
    it('eventos com 1 gol por time => placar derivado 1x1 exatamente', () => {
      const events = [
        {
          type: 'Goal',
          detail: 'Normal Goal',
          team: { id: 100, name: 'Flamengo' },
          player: { name: 'Pedro' },
        },
        {
          type: 'Goal',
          detail: 'Normal Goal',
          team: { id: 200, name: 'Palmeiras' },
          player: { name: 'Veiga' },
        },
      ]

      const res = deriveScoresFromEvents(events, 100, 200, 0, 0, 'Flamengo', 'Palmeiras')
      expect(res.derivedFromEvents).toBe(true)
      expect(res.homeScore).toBe(1)
      expect(res.awayScore).toBe(1)
      expect(res.validGoalEventsCount).toBe(2)
    })

    it('gol contra do mandante credita ponto para o visitante', () => {
      const events = [
        {
          type: 'Goal',
          detail: 'Own Goal',
          team: { id: 100, name: 'Time Mandante' },
          player: { name: 'Zagueiro Mandante' },
        },
      ]

      const res = deriveScoresFromEvents(events, 100, 200, 0, 0)
      expect(res.derivedFromEvents).toBe(true)
      expect(res.homeScore).toBe(0)
      expect(res.awayScore).toBe(1)
    })

    it('gol contra do visitante credita ponto para o mandante', () => {
      const events = [
        {
          type: 'Goal',
          detail: 'Own Goal',
          team: { id: 200, name: 'Time Visitante' },
          player: { name: 'Zagueiro Visitante' },
        },
      ]

      const res = deriveScoresFromEvents(events, 100, 200, 0, 0)
      expect(res.derivedFromEvents).toBe(true)
      expect(res.homeScore).toBe(1)
      expect(res.awayScore).toBe(0)
    })

    it('pênalti perdido não conta no placar nem como gol válido', () => {
      const events = [
        {
          type: 'Goal',
          detail: 'Missed Penalty',
          team: { id: 100, name: 'Time Mandante' },
          player: { name: 'Batedor' },
        },
        {
          type: 'Goal',
          detail: 'Penalty Missed',
          team: { id: 200, name: 'Time Visitante' },
          player: { name: 'Batedor Visitante' },
        },
      ]

      const res = deriveScoresFromEvents(events, 100, 200, 0, 0)
      expect(res.derivedFromEvents).toBe(false)
      expect(res.homeScore).toBe(0)
      expect(res.awayScore).toBe(0)
      expect(res.validGoalEventsCount).toBe(0)
    })

    it('quando não há eventos de gol válidos, preserva o placar bruto informado', () => {
      const res = deriveScoresFromEvents([], 100, 200, 3, 2)
      expect(res.derivedFromEvents).toBe(false)
      expect(res.homeScore).toBe(3)
      expect(res.awayScore).toBe(2)
    })

    it('integração com formatFixtureToLiveScore: sobrepõe placar divergente pela soma dos eventos válidos', () => {
      const fixture: ApiFootballFixture = {
        fixture: { id: 5555, status: { short: '2H', long: 'Second Half' } },
        teams: {
          home: { id: 10, name: 'Real Madrid' },
          away: { id: 20, name: 'Barcelona' },
        },
        goals: { home: 0, away: 0 }, // placar bruto incorreto na API
        events: [
          {
            type: 'Goal',
            detail: 'Normal Goal',
            player: { name: 'Vinicius Jr' },
            team: { id: 10, name: 'Real Madrid' },
          },
          {
            type: 'Goal',
            detail: 'Penalty',
            player: { name: 'Lewandowski' },
            team: { id: 20, name: 'Barcelona' },
          },
        ],
      }

      const formatted = formatFixtureToLiveScore(fixture, 'Real Madrid', 'Barcelona')
      // Placar A e B agora são 1 x 1 em vez de 0 x 0
      expect(formatted.placarA).toBe(1)
      expect(formatted.placarB).toBe(1)
    })
  })
})
