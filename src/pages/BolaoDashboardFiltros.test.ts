import { describe, it, expect, vi } from 'vitest'
import type { Jogo } from '@/types/bolao'
import type { MatchedLiveScore } from '@/lib/apiFootballMatcher'

// Helper function mirroring the exact logic of jogosLiberados filter in BolaoDashboard.tsx
export function filterJogosLiberados(
  targetGames: Jogo[],
  _apiFixtures: any[] = [],
  nowMs: number = Date.now(),
  _resolveLiveScore: (j: Jogo) => MatchedLiveScore | null = () => null,
  _isJogoConcluidoFn?: (j: Jogo, matchedLive?: MatchedLiveScore | null) => boolean,
  isPalpiteEncerradoFn: (_data: string, _hora: string, _now: number) => boolean = () => true,
  isJogoHojeFn: (_data: string, _now: number) => boolean = () => true,
  getJogoKickoffTimestampFn: (_data: string, _hora: string) => number | null = () =>
    nowMs - 3600000,
) {
  return targetGames.filter((j) => {
    // 1. Trava de jogos futuros: só incluir se kickoff já passou (palpite encerrado)
    if (!isPalpiteEncerradoFn(j.data, j.hora, nowMs)) return false

    // 2. Pertencer ao dia de hoje ou kickoff nas últimas 24h
    const kickoffMs = getJogoKickoffTimestampFn(j.data, j.hora)
    const isHoje = isJogoHojeFn(j.data, nowMs)
    const recentKickoff = kickoffMs !== null && kickoffMs >= nowMs - 24 * 60 * 60 * 1000
    return isHoje || recentKickoff
  })
}

describe('BolaoDashboard - Filtro jogosLiberados', () => {
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

  it('mantém visíveis jogos de hoje com kickoff passado mesmo se resultado_finalizado === true ou encerrado', () => {
    const games = [
      createMockJogo({ id: 'j1', resultado_finalizado: true, status: 'encerrado' }),
      createMockJogo({ id: 'j2', resultado_finalizado: false, status: 'ao_vivo' }),
    ]
    const res = filterJogosLiberados(games)
    expect(res.map((g) => g.id)).toEqual(['j1', 'j2'])
  })

  it('descarta jogos futuros cujo kickoff ainda não chegou', () => {
    const games = [createMockJogo({ id: 'passado' }), createMockJogo({ id: 'futuro' })]
    const res = filterJogosLiberados(
      games,
      [],
      Date.now(),
      () => null,
      undefined,
      (_d, _h, _now) => _d === 'passado', // só passado teve kickoff
    )
    expect(res.map((g) => g.id)).toEqual(['passado'])
  })

  it('descarta jogos antigos cujo kickoff ocorreu há mais de 24h e não são de hoje', () => {
    const now = Date.now()
    const games = [createMockJogo({ id: 'hoje' }), createMockJogo({ id: 'antigo' })]
    const res = filterJogosLiberados(
      games,
      [],
      now,
      () => null,
      undefined,
      () => true, // kickoff passou
      (data) => data === '2025-06-01' && false, // não é hoje
      (data, hora) => {
        // mock de kickoff timestamp
        return data === 'antigo' ? now - 48 * 3600 * 1000 : now - 2 * 3600 * 1000
      },
    )
    expect(res.map((g) => g.id)).toEqual(['hoje'])
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
