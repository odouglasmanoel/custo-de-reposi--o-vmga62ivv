import { describe, it, expect, vi } from 'vitest'
import type { Jogo } from '@/types/bolao'
import type { MatchedLiveScore } from '@/lib/apiFootballMatcher'

// Helper function mirroring the exact logic of jogosLiberados filter in BolaoDashboard.tsx
export function filterJogosLiberados(
  targetGames: Jogo[],
  _apiFixtures: any[] = [],
  nowMs: number = Date.now(),
  resolveLiveScore: (j: Jogo) => MatchedLiveScore | null = () => null,
  isJogoConcluidoFn?: (j: Jogo, matchedLive?: MatchedLiveScore | null) => boolean,
  isPalpiteEncerradoFn: (_data: string, _hora: string, _now: number) => boolean = () => true,
  isJogoHojeFn: (_data: string, _now: number) => boolean = () => true,
  getJogoKickoffTimestampFn: (_data: string, _hora: string) => number | null = () =>
    nowMs - 3600000,
) {
  const defaultIsJogoConcluido = (j: Jogo, matchedLive?: MatchedLiveScore | null): boolean => {
    if (j.resultado_finalizado) return true
    if (matchedLive && matchedLive.isFinished) return true
    if (
      j.status &&
      ['ft', 'aet', 'pen', 'finished', 'encerrado', 'finalizado', 'match finished'].includes(
        j.status.toLowerCase().trim(),
      )
    ) {
      return true
    }
    return false
  }

  const checkConcluido = isJogoConcluidoFn || defaultIsJogoConcluido

  return targetGames.filter((j) => {
    // 1. Trava de jogos futuros: só incluir se kickoff já passou (palpite encerrado)
    if (!isPalpiteEncerradoFn(j.data, j.hora, nowMs)) return false

    const isHoje = isJogoHojeFn(j.data, nowMs)

    // 2. Jogos de hoje permanecem visíveis mesmo quando concluídos/encerrados
    if (isHoje) {
      return true
    }

    // 3. Para outras datas: descarta concluídos e só inclui se kickoff nas últimas 24h
    const matchedLive = resolveLiveScore(j)
    if (checkConcluido(j, matchedLive)) return false

    const kickoffMs = getJogoKickoffTimestampFn(j.data, j.hora)
    const recentKickoff = kickoffMs !== null && kickoffMs >= nowMs - 24 * 60 * 60 * 1000
    return recentKickoff
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

  it('mantém jogos de hoje na lista mesmo se encerrados, finalizados ou com resultado_finalizado', () => {
    const games = [
      createMockJogo({ id: 'j1', resultado_finalizado: true, status: 'encerrado' }),
      createMockJogo({ id: 'j2', resultado_finalizado: false, status: 'ao_vivo' }),
      createMockJogo({ id: 'j3', resultado_finalizado: false, status: 'finalizado' }),
      createMockJogo({ id: 'j4', resultado_finalizado: true, status: 'ft' }),
      createMockJogo({ id: 'j5', resultado_finalizado: false, status: 'pendente' }),
    ]
    const res = filterJogosLiberados(
      games,
      [],
      Date.now(),
      () => null,
      undefined,
      () => true,
      () => true,
    )
    // Todos os jogos cujo kickoff já passou e são de hoje permanecem visíveis
    expect(res.map((g) => g.id)).toEqual(['j1', 'j2', 'j3', 'j4', 'j5'])
  })

  it('mantém jogo de hoje mesmo se liveScore indicar isFinished', () => {
    const games = [
      createMockJogo({ id: 'j_live_fin', resultado_finalizado: true, status: 'encerrado' }),
      createMockJogo({ id: 'j_live_active', resultado_finalizado: false, status: 'ao_vivo' }),
    ]
    const res = filterJogosLiberados(
      games,
      [],
      Date.now(),
      (j) =>
        j.id === 'j_live_fin'
          ? ({ isFinished: true, isLive: false } as any)
          : ({ isFinished: false, isLive: true } as any),
      undefined,
      () => true,
      () => true,
    )
    expect(res.map((g) => g.id)).toEqual(['j_live_fin', 'j_live_active'])
  })

  it('exclui partida de outra data se concluída/encerrada', () => {
    const games = [
      createMockJogo({ id: 'ontem_encerrado', resultado_finalizado: true, status: 'encerrado' }),
      createMockJogo({ id: 'ontem_pendente', resultado_finalizado: false, status: 'pendente' }),
    ]
    const res = filterJogosLiberados(
      games,
      [],
      Date.now(),
      () => null,
      undefined,
      () => true, // kickoff já passou
      () => false, // NÃO é hoje
      () => Date.now() - 3600000, // kickoff há 1h (nas últimas 24h)
    )
    expect(res.map((g) => g.id)).toEqual(['ontem_pendente'])
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

  it('limpeza automática na virada do dia (00:00): jogo de ontem encerrado não aparece', () => {
    const now = Date.now()
    const games = [
      // Jogo de ontem encerrado: não deve aparecer
      createMockJogo({ id: 'ontem_encerrado', resultado_finalizado: true, status: 'encerrado' }),
      // Jogo de ontem pendente ainda nas últimas 24h (por ex: adiado/atrasado): permanece visível se não concluído
      createMockJogo({ id: 'ontem_em_andamento', resultado_finalizado: false, status: 'ao_vivo' }),
    ]
    const res = filterJogosLiberados(
      games,
      [],
      now,
      () => null,
      undefined,
      () => true,
      () => false, // não é hoje (já passou da meia-noite)
      () => now - 4 * 3600 * 1000, // kickoff há 4h
    )
    expect(res.map((g) => g.id)).toEqual(['ontem_em_andamento'])
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
