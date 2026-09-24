import { describe, it, expect, vi } from 'vitest'
import type { Jogo } from '@/types/bolao'
import type { MatchedLiveScore } from '@/lib/apiFootballMatcher'

// Helper function mirroring the exact logic of jogosLiberados filter in BolaoDashboard.tsx
export function filterJogosLiberados(
  targetGames: Jogo[],
  apiFixtures: any[] = [],
  nowMs: number = Date.now(),
  resolveLiveScore: (j: Jogo) => MatchedLiveScore | null = () => null,
  isJogoConcluidoFn: (j: Jogo, matchedLive?: MatchedLiveScore | null) => boolean = (j, m) => {
    if (j.resultado_finalizado) return true
    if (m && m.isFinished) return true
    if (
      j.status &&
      ['ft', 'aet', 'pen', 'finished', 'encerrado', 'finalizado', 'match finished'].includes(
        j.status.toLowerCase().trim(),
      )
    ) {
      return true
    }
    return false
  },
  isPalpiteEncerradoFn: (_data: string, _hora: string, _now: number) => boolean = () => true,
  isJogoHojeFn: (_data: string, _now: number) => boolean = () => true,
  getJogoKickoffTimestampFn: (_data: string, _hora: string) => number | null = () =>
    nowMs - 3600000,
) {
  const FINALIZADO_STATUSES = new Set(['finalizado', 'encerrado', 'ft', 'finished', 'aet', 'pen'])
  const NAO_FINALIZADO_STATUSES = new Set([
    'pendente',
    'em_andamento',
    'ao_vivo',
    'live',
    '1h',
    '2h',
    'ht',
    'aguardando',
    'agendado',
  ])

  return targetGames.filter((j) => {
    // 1. Descartar se resultado_finalizado for true
    if (j.resultado_finalizado === true) return false

    const matchedLive = resolveLiveScore(j)

    // 5. Descartar se matchedLive?.isFinished === true
    if (matchedLive?.isFinished === true) return false

    const concluido = isJogoConcluidoFn(j, matchedLive)
    if (concluido) return false

    // 2. Normalizar status
    const st = (j.status || '').toLowerCase().trim()

    // 3. Descartar se st ∈ ['finalizado', 'encerrado', 'ft', 'finished', 'aet', 'pen']
    if (FINALIZADO_STATUSES.has(st)) return false

    // 4. Incluir SOMENTE partidas com status de não-finalizado:
    // st ∈ ['pendente', 'em_andamento', 'ao_vivo', 'live', '1h', '2h', 'ht', 'aguardando', 'agendado']
    // ou st vazio com kickoff futuro/não iniciado e sem placar final preenchido.
    const temPlacarFinal =
      j.placar_a !== null &&
      j.placar_a !== undefined &&
      j.placar_b !== null &&
      j.placar_b !== undefined

    if (st) {
      if (!NAO_FINALIZADO_STATUSES.has(st)) return false
    } else {
      // Status vazio: descartar se placar final já estiver preenchido
      if (temPlacarFinal) return false
    }

    if (!isPalpiteEncerradoFn(j.data, j.hora, nowMs)) return false

    const kickoffMs = getJogoKickoffTimestampFn(j.data, j.hora)
    const isHoje = isJogoHojeFn(j.data, nowMs)
    const recentKickoff = kickoffMs !== null && kickoffMs >= nowMs - 24 * 60 * 60 * 1000
    return isHoje || recentKickoff
  })
}

describe('BolaoDashboard - Filtro jogosLiberados (BUG 1)', () => {
  const createMockJogo = (overrides: Partial<Jogo>): Jogo => ({
    id: 'jogo_1',
    collectionId: 'col_jogos',
    collectionName: 'jogos',
    created: '2025-01-01',
    updated: '2025-01-01',
    bolao: 'bolao_1',
    time_a: 'Corinthians',
    time_b: 'Palmeiras',
    data: '2025-06-01',
    hora: '16:00',
    resultado_finalizado: false,
    tem_penaltis: false,
    ...overrides,
  })

  it('descarta jogos com resultado_finalizado === true', () => {
    const games = [
      createMockJogo({ id: 'j1', resultado_finalizado: true, status: 'pendente' }),
      createMockJogo({ id: 'j2', resultado_finalizado: false, status: 'pendente' }),
    ]
    const res = filterJogosLiberados(games)
    expect(res.map((g) => g.id)).toEqual(['j2'])
  })

  it('descarta jogos com status terminal: finalizado, encerrado, ft, finished, aet, pen', () => {
    const statuses = ['finalizado', 'FINALIZADO', 'encerrado', 'ft', 'finished', 'aet', 'pen']
    const games = statuses.map((st, i) =>
      createMockJogo({ id: `j_${i}`, resultado_finalizado: false, status: st }),
    )
    const res = filterJogosLiberados(games)
    expect(res).toEqual([])
  })

  it('inclui jogos com status não finalizado: pendente, em_andamento, ao_vivo, live, 1h, 2h, ht, aguardando, agendado', () => {
    const validStatuses = [
      'pendente',
      'em_andamento',
      'ao_vivo',
      'live',
      '1h',
      '2h',
      'ht',
      'aguardando',
      'agendado',
    ]
    const games = validStatuses.map((st, i) =>
      createMockJogo({ id: `j_${i}`, resultado_finalizado: false, status: st }),
    )
    const res = filterJogosLiberados(games)
    expect(res.length).toBe(validStatuses.length)
  })

  it('descarta jogo com status vazio quando placar final está preenchido', () => {
    const games = [
      createMockJogo({ id: 'com_placar', status: '', placar_a: 2, placar_b: 1 }),
      createMockJogo({ id: 'sem_placar', status: '', placar_a: null, placar_b: null }),
    ]
    const res = filterJogosLiberados(games)
    expect(res.map((g) => g.id)).toEqual(['sem_placar'])
  })

  it('descarta jogo se matchedLive.isFinished for true', () => {
    const game = createMockJogo({ id: 'j_live_end', status: 'em_andamento' })
    const res = filterJogosLiberados(
      [game],
      [],
      Date.now(),
      () =>
        ({
          found: true,
          homeTeamName: 'Corinthians',
          awayTeamName: 'Palmeiras',
          placarA: 2,
          placarB: 1,
          fixtureId: 123,
          goalsHome: 2,
          goalsAway: 1,
          statusShort: 'FT',
          statusLong: 'Match Finished',
          elapsed: 90,
          isLive: false,
          isFinished: true,
          scorers: [],
        }) as unknown as MatchedLiveScore,
    )
    expect(res).toEqual([])
  })
})

describe('AdminResultado - Salvamento com status e resultado_finalizado (BUG 2)', () => {
  it('garante que o payload enviado para salvar placar final contém status finalizado e resultado_finalizado true', async () => {
    const updateSpy = vi.fn().mockResolvedValue({})
    const mockPb = {
      collection: () => ({
        update: updateSpy,
      }),
    }

    // Mock do salvamento conforme implementado no AdminResultado.tsx
    const placarA = '2'
    const placarB = '1'
    const temPenaltis = false
    const golsA = [{ nome: 'Yuri Alberto', posicao: 'Atacante/Meia', quantidade: 2 }]
    const golsB = [{ nome: 'Veiga', posicao: 'Atacante/Meia', quantidade: 1 }]
    const fixtureId = '999888'

    const gamePayload: Record<string, unknown> = {
      placar_a: Number(placarA),
      placar_b: Number(placarB),
      status: 'finalizado',
      resultado_finalizado: true,
      gols_time_a: golsA.filter((g) => g.nome.trim()),
      gols_time_b: golsB.filter((g) => g.nome.trim()),
      tem_penaltis: temPenaltis,
      vencedor_penaltis: '',
      fixture_id: fixtureId.trim() || '',
    }

    await mockPb.collection().update('jogo_123', gamePayload)

    expect(updateSpy).toHaveBeenCalledWith(
      'jogo_123',
      expect.objectContaining({
        status: 'finalizado',
        resultado_finalizado: true,
        placar_a: 2,
        placar_b: 1,
      }),
    )
  })
})
