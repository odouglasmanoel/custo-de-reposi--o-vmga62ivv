import { describe, it, expect } from 'vitest'
import { getJogoKickoffTimestamp } from '@/lib/dateUtils'
import { calculateLiveMatchScoreBreakdown } from '@/lib/scoreBadgeUtils'
import type { Jogo, Palpite } from '@/types/bolao'

// Helper que espelha as regras exatas de jogoIniciou utilizadas no frontend e backend
export function checkJogoIniciou(jogo: Partial<Jogo>, nowMs: number = Date.now()): boolean {
  const STATUS_INICIADOS = [
    'em_andamento',
    'ao_vivo',
    '1h',
    '2h',
    'ht',
    'finalizado',
    'encerrado',
    'ft',
    'finished',
  ]
  const st = (jogo.status || '').toLowerCase().trim()
  const statusIniciado = STATUS_INICIADOS.includes(st)
  const kickoffMs = getJogoKickoffTimestamp(jogo.data, jogo.hora)
  return (
    (kickoffMs != null && nowMs >= kickoffMs) ||
    statusIniciado ||
    Boolean(jogo.resultado_finalizado)
  )
}

// Helper de simulação do motor de pontuação ao vivo no dashboard
export function resolvePalpiteLiveScore(
  jogo: Partial<Jogo>,
  bet: Palpite,
  nowMs: number = Date.now(),
) {
  const jogoIniciou = checkJogoIniciou(jogo, nowMs)
  if (!jogoIniciou && !jogo.resultado_finalizado) {
    return {
      pontos: 0,
      badges: [],
      resumoTexto: '',
      resumoItens: [],
      hasScore: false,
    }
  }

  const placarA = jogo.placar_a != null ? Number(jogo.placar_a) : 0
  const placarB = jogo.placar_b != null ? Number(jogo.placar_b) : 0

  const breakdown = calculateLiveMatchScoreBreakdown(
    bet,
    placarA,
    placarB,
    [],
    jogo.tem_penaltis,
    jogo.vencedor_penaltis,
  )

  return {
    ...breakdown,
    hasScore: true,
  }
}

describe('Motor de Pontuação - Regra de Jogos Futuros vs Em Andamento', () => {
  it('jogo futuro com palpite 0x0 e placar default 0x0 DEVE retornar 0 pontos e hasScore=false (Aguardando início)', () => {
    const jogoFuturo: Partial<Jogo> = {
      id: 'jogo-futuro-1',
      data: '2026-07-20',
      hora: '16:00',
      status: 'agendado',
      resultado_finalizado: false,
      placar_a: 0, // default do banco
      placar_b: 0, // default do banco
    }

    const palpiteExatoFuturo: Palpite = {
      id: 'bet-1',
      bolao: 'bolao-1',
      jogo: 'jogo-futuro-1',
      participante: 'part-1',
      placar_a: 0,
      placar_b: 0,
      pontuacao_jogo: 0,
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }

    // Horário atual bem antes do kickoff (ex: 2026-07-15)
    const nowMs = new Date('2026-07-15T12:00:00-03:00').getTime()

    expect(checkJogoIniciou(jogoFuturo, nowMs)).toBe(false)

    const result = resolvePalpiteLiveScore(jogoFuturo, palpiteExatoFuturo, nowMs)
    expect(result.hasScore).toBe(false)
    expect(result.pontos).toBe(0)
    expect(result.badges).toHaveLength(0)
  })

  it('jogo em andamento (status ao_vivo) com placar real 0x0 DEVE pontuar normalmente (+8 pontos acerto exato)', () => {
    const jogoAoVivo: Partial<Jogo> = {
      id: 'jogo-live-1',
      data: '2026-07-20',
      hora: '16:00',
      status: 'ao_vivo',
      resultado_finalizado: false,
      placar_a: 0,
      placar_b: 0,
    }

    const palpiteExato: Palpite = {
      id: 'bet-2',
      bolao: 'bolao-1',
      jogo: 'jogo-live-1',
      participante: 'part-1',
      placar_a: 0,
      placar_b: 0,
      pontuacao_jogo: 0,
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }

    const nowMs = new Date('2026-07-20T16:15:00-03:00').getTime()

    expect(checkJogoIniciou(jogoAoVivo, nowMs)).toBe(true)

    const result = resolvePalpiteLiveScore(jogoAoVivo, palpiteExato, nowMs)
    expect(result.hasScore).toBe(true)
    expect(result.pontos).toBe(8) // Placar exato no jogo ao vivo
  })

  it('jogo com kickoff passado (dataHoraAtual >= dataHoraJogo) DEVE ser considerado iniciado e pontuar', () => {
    const jogoPassado: Partial<Jogo> = {
      id: 'jogo-passado-1',
      data: '2026-06-15',
      hora: '16:00',
      status: 'pendente',
      resultado_finalizado: false,
      placar_a: 1,
      placar_b: 0,
    }

    const palpiteVencedor: Palpite = {
      id: 'bet-3',
      bolao: 'bolao-1',
      jogo: 'jogo-passado-1',
      participante: 'part-1',
      placar_a: 2,
      placar_b: 0,
      pontuacao_jogo: 0,
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }

    // 1 hora após o início do jogo
    const nowMs = new Date('2026-06-15T17:00:00-03:00').getTime()

    expect(checkJogoIniciou(jogoPassado, nowMs)).toBe(true)

    const result = resolvePalpiteLiveScore(jogoPassado, palpiteVencedor, nowMs)
    expect(result.hasScore).toBe(true)
    expect(result.pontos).toBeGreaterThan(0) // Acertou vencedor (+2) e metade do placar (+1)
  })

  it('jogo finalizado no banco pontua independentemente do horário', () => {
    const jogoFinalizado: Partial<Jogo> = {
      id: 'jogo-finalizado-1',
      data: '2026-07-20',
      hora: '16:00',
      status: 'finalizado',
      resultado_finalizado: true,
      placar_a: 2,
      placar_b: 1,
    }

    const palpiteExato: Palpite = {
      id: 'bet-4',
      bolao: 'bolao-1',
      jogo: 'jogo-finalizado-1',
      participante: 'part-1',
      placar_a: 2,
      placar_b: 1,
      pontuacao_jogo: 8,
      created: '',
      updated: '',
      collectionId: '',
      collectionName: '',
    }

    const nowMs = new Date('2026-07-15T12:00:00-03:00').getTime()
    expect(checkJogoIniciou(jogoFinalizado, nowMs)).toBe(true)

    const result = resolvePalpiteLiveScore(jogoFinalizado, palpiteExato, nowMs)
    expect(result.hasScore).toBe(true)
    expect(result.pontos).toBe(8)
  })
})
