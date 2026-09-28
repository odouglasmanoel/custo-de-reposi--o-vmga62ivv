import { describe, it, expect } from 'vitest'
import type { Jogo } from '@/types/bolao'
import type { MatchedLiveScore } from '@/lib/apiFootballMatcher'

// Helper que espelha exatamente a regra atualizada de liveGameIds de BolaoDashboard.tsx
export function computeLiveGameIds(
  targetGames: Jogo[],
  apiFixtures: any[] = [],
  nowMs: number = Date.now(),
  sobrescritasAdmin: Record<string, any> = {},
  isJogoHojeBrasiliaFn: (data: string, now: number) => boolean,
  isPalpiteEncerradoFn: (data: string, hora: string, now: number) => boolean,
  resolveLiveScoreForGameFn: (
    jogo: Jogo,
    fixtures: any[],
    threshold: number,
    dataISO: string,
  ) => MatchedLiveScore | null,
  normalizeDataISOFn: (data: string) => string,
): Set<string> {
  return new Set(
    targetGames
      .filter((j) => {
        if (j.resultado_finalizado) return false
        if (!isJogoHojeBrasiliaFn(j.data, nowMs)) return false
        if (!isPalpiteEncerradoFn(j.data, j.hora, nowMs)) return false

        if (sobrescritasAdmin[j.id]) return true
        if (j.status === 'ao_vivo') return true

        const jogoDataISO = normalizeDataISOFn(j.data)
        const matchedLive = resolveLiveScoreForGameFn(j, apiFixtures, 0.55, jogoDataISO)
        return Boolean(matchedLive?.isLive && !matchedLive?.isFinished)
      })
      .map((j) => j.id),
  )
}

describe('BolaoDashboard - Regras de liveGameIds e tag (+X ao vivo)', () => {
  const mockJogo = (overrides: Partial<Jogo>): Jogo => ({
    id: 'game_1',
    collectionId: 'col_jogos',
    collectionName: 'jogos',
    created: '2026-09-28',
    updated: '2026-09-28',
    bolao: 'bolao_1',
    time_a: 'Brasil',
    time_b: 'Argentina',
    data: '2026-09-28',
    hora: '16:00',
    resultado_finalizado: false,
    tem_penaltis: false,
    ...overrides,
  })

  it('NÃO inclui jogos de datas passadas mesmo se resultado_finalizado for false e palpite encerrado', () => {
    const games = [
      mockJogo({
        id: 'jogo_passado',
        data: '2026-09-20',
        resultado_finalizado: false,
        status: 'ao_vivo',
      }),
    ]

    const liveIds = computeLiveGameIds(
      games,
      [],
      Date.now(),
      {},
      (d) => d === '2026-09-28', // hoje é 28
      () => true, // kickoff já passou
      () => null,
      (d) => d,
    )

    expect(liveIds.has('jogo_passado')).toBe(false)
  })

  it('NÃO inclui jogos já marcados como resultado_finalizado = true', () => {
    const games = [
      mockJogo({
        id: 'jogo_finalizado_hoje',
        data: '2026-09-28',
        resultado_finalizado: true,
        status: 'finalizado',
      }),
    ]

    const liveIds = computeLiveGameIds(
      games,
      [],
      Date.now(),
      {},
      () => true,
      () => true,
      () => null,
      (d) => d,
    )

    expect(liveIds.has('jogo_finalizado_hoje')).toBe(false)
  })

  it('NÃO inclui jogos de hoje cujo kickoff ainda não chegou', () => {
    const games = [
      mockJogo({
        id: 'jogo_futuro_hoje',
        data: '2026-09-28',
        hora: '21:30',
        resultado_finalizado: false,
        status: 'pendente',
      }),
    ]

    const liveIds = computeLiveGameIds(
      games,
      [],
      Date.now(),
      {},
      () => true, // é hoje
      () => false, // kickoff NÃO chegou
      () => null,
      (d) => d,
    )

    expect(liveIds.has('jogo_futuro_hoje')).toBe(false)
  })

  it('NÃO inclui jogo de hoje se a API indicar que a partida já encerrou (isFinished: true)', () => {
    const games = [
      mockJogo({
        id: 'jogo_api_encerrada',
        data: '2026-09-28',
        resultado_finalizado: false,
        status: '',
      }),
    ]

    const liveIds = computeLiveGameIds(
      games,
      [],
      Date.now(),
      {},
      () => true,
      () => true,
      () => ({ isLive: false, isFinished: true }) as any,
      (d) => d,
    )

    expect(liveIds.has('jogo_api_encerrada')).toBe(false)
  })

  it('INCLUI jogo de hoje quando status for "ao_vivo" e kickoff já chegou', () => {
    const games = [
      mockJogo({
        id: 'jogo_ao_vivo_hoje',
        data: '2026-09-28',
        resultado_finalizado: false,
        status: 'ao_vivo',
      }),
    ]

    const liveIds = computeLiveGameIds(
      games,
      [],
      Date.now(),
      {},
      () => true,
      () => true,
      () => null,
      (d) => d,
    )

    expect(liveIds.has('jogo_ao_vivo_hoje')).toBe(true)
  })

  it('INCLUI jogo de hoje quando a API confirmar isLive: true e isFinished: false', () => {
    const games = [
      mockJogo({
        id: 'jogo_api_live',
        data: '2026-09-28',
        resultado_finalizado: false,
        status: '',
      }),
    ]

    const liveIds = computeLiveGameIds(
      games,
      [],
      Date.now(),
      {},
      () => true,
      () => true,
      () => ({ isLive: true, isFinished: false }) as any,
      (d) => d,
    )

    expect(liveIds.has('jogo_api_live')).toBe(true)
  })

  it('INCLUI jogo de hoje se houver sobrescrita manual ativa pelo Admin', () => {
    const games = [
      mockJogo({
        id: 'jogo_sobrescrito',
        data: '2026-09-28',
        resultado_finalizado: false,
        status: 'pendente',
      }),
    ]

    const liveIds = computeLiveGameIds(
      games,
      [],
      Date.now(),
      { jogo_sobrescrito: { placarA: 1, placarB: 0 } },
      () => true,
      () => true,
      () => null,
      (d) => d,
    )

    expect(liveIds.has('jogo_sobrescrito')).toBe(true)
  })
})
