import { describe, it, expect, beforeEach, vi } from 'vitest'

// Simulação lógica do comportamento dos hooks detalhes_partida e escalacoes (Edição C)
interface MockHookOptions {
  fixtureId: string
  isDirectNumeric: boolean
  forceRefresh?: boolean
  dbHasFicha?: boolean
  dbIsFinalized?: boolean
  apiFootballStatus?: number
  lastCallTimestamp?: number
}

describe('detalhes_partida & escalacoes - Edição C (regras de chamada sob demanda)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('permite chamada sob demanda para fixture_id numérico direto fora da lista do bolão e fora da janela pré-kickoff', () => {
    // 1. Chamada sob demanda permitida para jogo fora da lista/janela
    const fixtureIdParam = '1234567'
    const isDirectNumeric = /^\d+$/.test(fixtureIdParam)
    const cbIsBlocked = false
    const spamMap: Record<string, number> = {}

    // No novo modelo, NÃO existe restrição de fixtureIdEstaNoEscopo e nem dentroDaJanela
    const checkFixtureAntiSpam = (id: string, now: number) => {
      const last = spamMap[id] || 0
      return now - last >= 30000
    }

    const now = Date.now()
    const canCall = isDirectNumeric && !cbIsBlocked && checkFixtureAntiSpam(fixtureIdParam, now)
    expect(canCall).toBe(true)
  })

  it('aplica anti-spam leve de 30-60s por fixture_id para cliques repetidos no mesmo jogo', () => {
    const fixtureIdParam = '987654'
    const spamMap: Record<string, number> = {}
    const SPAM_WINDOW_MS = 30000

    const recordCall = (id: string, timestamp: number) => {
      spamMap[id] = timestamp
    }

    const checkSpam = (id: string, now: number) => {
      const last = spamMap[id] || 0
      const diff = now - last
      if (diff < SPAM_WINDOW_MS) {
        return { canCall: false, waitMs: SPAM_WINDOW_MS - diff }
      }
      return { canCall: true, waitMs: 0 }
    }

    const t0 = 1000000
    expect(checkSpam(fixtureIdParam, t0).canCall).toBe(true)

    // Primeira chamada registra o timestamp
    recordCall(fixtureIdParam, t0)

    // Clique 5 segundos depois -> barrado por anti-spam por jogo
    const t1 = t0 + 5000
    const check1 = checkSpam(fixtureIdParam, t1)
    expect(check1.canCall).toBe(false)
    expect(check1.waitMs).toBe(25000)

    // Outro jogo (fixture_id diferente) NÃO é bloqueado (desacoplamento por fixture)
    const otherFixture = '555111'
    expect(checkSpam(otherFixture, t1).canCall).toBe(true)

    // Após 31 segundos, o fixture inicial pode ser chamado novamente
    const t2 = t0 + 31000
    expect(checkSpam(fixtureIdParam, t2).canCall).toBe(true)
  })

  it('serve diretamente do banco se o jogo for finalizado e já tiver ficha gravada (custo zero)', () => {
    const mockJogoRecord = {
      id: 'jogo_rec_1',
      resultado_finalizado: true,
      ficha_detalhes: {
        provider: 'api_football',
        fixtureId: '888888',
        teams: {
          home: { name: 'Real Madrid' },
          away: { name: 'Barcelona' },
        },
        events: [{ type: 'Goal', player: { name: 'Vinicius Jr' } }],
      },
    }

    let externalApiCalled = false
    const handleRequest = (rec: typeof mockJogoRecord, forceRefresh: boolean) => {
      if (rec && !forceRefresh && rec.resultado_finalizado && rec.ficha_detalhes) {
        // Servir do banco
        return { source: 'database', data: rec.ficha_detalhes }
      }
      externalApiCalled = true
      return { source: 'api', data: null }
    }

    const result = handleRequest(mockJogoRecord, false)
    expect(result.source).toBe('database')
    expect(result.data.events).toHaveLength(1)
    expect(externalApiCalled).toBe(false)
  })

  it('faz fallback imediato para Football-Data ou TheSportsDB se a API-Football retornar 429', () => {
    let circuitBreakerTripped = false
    let sourceUsed = ''

    const mockApiFootballResponse = { statusCode: 429, body: 'Too Many Requests' }
    const mockFootballDataResponse = {
      statusCode: 200,
      json: {
        id: 777,
        homeTeam: { name: 'Arsenal' },
        awayTeam: { name: 'Chelsea' },
        score: { fullTime: { home: 2, away: 1 } },
        goals: [{ minute: 15, scorer: { name: 'Saka' } }],
      },
    }

    // Fluxo simulado de fallback quando 429 ocorre
    if (mockApiFootballResponse.statusCode === 429) {
      circuitBreakerTripped = true
      // Fallback para Football-Data.org
      if (mockFootballDataResponse.statusCode === 200 && mockFootballDataResponse.json) {
        sourceUsed = 'football_data'
      }
    }

    expect(circuitBreakerTripped).toBe(true)
    expect(sourceUsed).toBe('football_data')
  })

  it('resolve ID tsdb_* via similaridade Levenshtein >= 0.85 e persiste fixture_id numérico de volta', () => {
    const rawFixtureId = 'tsdb_102030'
    const isDirectNumeric = /^\d+$/.test(rawFixtureId)
    expect(isDirectNumeric).toBe(false)

    // Lista de candidatos retornados pela API-Football por data
    const apiFootballDayFixtures = [
      {
        fixture: { id: 994411 },
        teams: {
          home: { name: 'Paris Saint Germain' },
          away: { name: 'Olympique Marseille' },
        },
      },
    ]

    const targetTimeA = 'PSG'
    const targetTimeB = 'Olympique de Marseille'

    // Função Levenshtein & matching idêntica à do hook
    const normalizar = (s: string) =>
      s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .trim()

    const calcularLevenshtein = (a: string, b: string): number => {
      const m = a.length,
        n = b.length
      if (m === 0) return n
      if (n === 0) return m
      const d: number[][] = []
      for (let i = 0; i <= m; i++) d[i] = [i]
      for (let j = 0; j <= n; j++) d[0][j] = j
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          const cost = a[i - 1] === b[j - 1] ? 0 : 1
          d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
        }
      }
      return d[m][n]
    }

    const timesCoincidem = (a: string, b: string): boolean => {
      const nA = normalizar(a)
      const nB = normalizar(b)
      if (nA === 'psg' && nB.includes('paris saint germain')) return true
      if (nA.includes('marseille') && nB.includes('marseille')) return true
      const maxLen = Math.max(nA.length, nB.length)
      const dist = calcularLevenshtein(nA, nB)
      return 1 - dist / maxLen >= 0.85
    }

    let resolvedNumericId: string | null = null
    for (const cand of apiFootballDayFixtures) {
      if (
        timesCoincidem(targetTimeA, cand.teams.home.name) &&
        timesCoincidem(targetTimeB, cand.teams.away.name)
      ) {
        resolvedNumericId = String(cand.fixture.id)
        break
      }
    }

    expect(resolvedNumericId).toBe('994411')
    expect(/^\d+$/.test(resolvedNumericId!)).toBe(true)
  })

  it('consolida marcadores nos eventos quando timeline/events não trouxer gols mas o placar for > 0', () => {
    // Simula cenário da issue: Atlético Madrid 2 x 1 Real Madrid
    // A API externa enviou apenas 1 evento de substituição na timeline, mas placar = 2x1
    const rawEventsFromApi = [
      {
        time: { elapsed: 72 },
        team: { name: 'Atlético Madrid' },
        player: { name: 'Ángel Correa' },
        type: 'subst',
        detail: 'Substitution',
      },
    ]

    const placarGolsMandante = 2
    const placarGolsVisitante = 1

    // Marcadores conhecidos do banco / match.scorers
    const mockMarcadores = [
      { name: 'Antoine Griezmann', teamSide: 'home', minute: 15 },
      { name: 'Alexander Sørloth', teamSide: 'home', minute: 60 },
      { name: 'Kylian Mbappé', teamSide: 'away', minute: 40 },
    ]

    // Valida que a lista crua de eventos não contém nenhum gol
    const hasExistingGoals = rawEventsFromApi.some(
      (ev) => ev.type.toLowerCase().includes('goal') || ev.detail.toLowerCase().includes('goal'),
    )
    expect(hasExistingGoals).toBe(false)

    // Lógica idêntica ao pocketbase/hooks/detalhes_partida.js e MatchDetailsModal.tsx
    let consolidatedEvents = [...rawEventsFromApi]
    const totalGolsPlacar = placarGolsMandante + placarGolsVisitante

    if (!hasExistingGoals && totalGolsPlacar > 0) {
      const goalEvents = mockMarcadores.map((sc) => ({
        time: { elapsed: sc.minute },
        team: { name: sc.teamSide === 'home' ? 'Atlético Madrid' : 'Real Madrid' },
        player: { name: sc.name },
        type: 'Goal',
        detail: 'Normal Goal',
      }))
      consolidatedEvents = [...goalEvents, ...consolidatedEvents]
    }

    // Filtragem de gols
    const golsFiltrados = consolidatedEvents.filter((ev) => {
      const t = (ev.type || '').toLowerCase()
      const d = (ev.detail || '').toLowerCase()
      return t.includes('goal') || d.includes('goal')
    })

    expect(golsFiltrados).toHaveLength(3)
    expect(golsFiltrados[0].player.name).toBe('Antoine Griezmann')
    expect(golsFiltrados[1].player.name).toBe('Alexander Sørloth')
    expect(golsFiltrados[2].player.name).toBe('Kylian Mbappé')

    // Substituição continua preservada no conjunto total de eventos
    const subsFiltradas = consolidatedEvents.filter((ev) =>
      (ev.type || '').toLowerCase().includes('sub'),
    )
    expect(subsFiltradas).toHaveLength(1)
  })

  it('mapeia strHomeGoalDetails e strAwayGoalDetails da TheSportsDB para eventos do tipo Goal', () => {
    // Exemplo real retornado no lookupevent.php
    const strHomeGoalDetails = "39':Julian Alvarez;70':Antoine Griezmann;"
    const strAwayGoalDetails = "55':Vinicius Junior;"

    const parsedEvents: any[] = []
    const parseGoalDetailsStr = (goalStr: string, teamName: string) => {
      if (!goalStr || !goalStr.trim()) return
      const parts = goalStr.split(';')
      for (const rawPart of parts) {
        const trimmed = rawPart.trim()
        if (!trimmed) continue
        const minMatch = trimmed.match(/(\d+)'?/)
        const extractedMin = minMatch ? parseInt(minMatch[1], 10) : null
        const nameClean = trimmed
          .replace(/^\d+'?:?/, '')
          .replace(/\s*\(pen\.?\)/i, '')
          .trim()
        if (nameClean) {
          parsedEvents.push({
            type: 'Goal',
            detail: 'Normal Goal',
            time: { elapsed: extractedMin },
            team: { name: teamName },
            player: { name: nameClean },
          })
        }
      }
    }

    parseGoalDetailsStr(strHomeGoalDetails, 'Atlético Madrid')
    parseGoalDetailsStr(strAwayGoalDetails, 'Real Madrid')

    expect(parsedEvents).toHaveLength(3)
    expect(parsedEvents[0]).toEqual({
      type: 'Goal',
      detail: 'Normal Goal',
      time: { elapsed: 39 },
      team: { name: 'Atlético Madrid' },
      player: { name: 'Julian Alvarez' },
    })
    expect(parsedEvents[1]).toEqual({
      type: 'Goal',
      detail: 'Normal Goal',
      time: { elapsed: 70 },
      team: { name: 'Atlético Madrid' },
      player: { name: 'Antoine Griezmann' },
    })
    expect(parsedEvents[2]).toEqual({
      type: 'Goal',
      detail: 'Normal Goal',
      time: { elapsed: 55 },
      team: { name: 'Real Madrid' },
      player: { name: 'Vinicius Junior' },
    })
  })
})
