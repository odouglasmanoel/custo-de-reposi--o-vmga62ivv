import { describe, it, expect } from 'vitest'
import {
  formatDataBR,
  formatHoraBR,
  getJogoKickoffTimestamp,
  isPalpiteEncerrado,
  getHojeDataSaoPaulo,
  getTodayDateString,
  normalizeDataISO,
  isJogoHoje,
  isJogoHojeNaoIniciado,
} from './dateUtils'

describe('dateUtils - Jogos de Hoje e Fuso de Brasília', () => {
  it('identifica corretamente a data de hoje no fuso America/Sao_Paulo', () => {
    // 2026-06-15 12:00:00 UTC -> 2026-06-15 09:00:00 America/Sao_Paulo (UTC-3)
    const testNow = Date.UTC(2026, 5, 15, 12, 0, 0)
    expect(getHojeDataSaoPaulo(testNow)).toBe('2026-06-15')

    // 2026-06-16 01:00:00 UTC -> 2026-06-15 22:00:00 America/Sao_Paulo (ainda dia 15 em SP)
    const lateUtc = Date.UTC(2026, 5, 16, 1, 0, 0)
    expect(getHojeDataSaoPaulo(lateUtc)).toBe('2026-06-15')
    expect(getTodayDateString(lateUtc)).toBe('2026-06-15')
  })

  it('normaliza datas de diferentes formatos para YYYY-MM-DD', () => {
    expect(normalizeDataISO('15/06/2026')).toBe('2026-06-15')
    expect(normalizeDataISO('2026-06-15')).toBe('2026-06-15')
    expect(normalizeDataISO('2026-06-15T00:00:00.000Z')).toBe('2026-06-15')
  })

  it('determina com precisão se o jogo é hoje em America/Sao_Paulo', () => {
    const testNow = Date.UTC(2026, 5, 15, 15, 0, 0) // 12h00 em SP
    expect(isJogoHoje('15/06/2026', testNow)).toBe(true)
    expect(isJogoHoje('2026-06-15', testNow)).toBe(true)
    expect(isJogoHoje('16/06/2026', testNow)).toBe(false)
    expect(isJogoHoje('14/06/2026', testNow)).toBe(false)
  })

  it('verifica expiração do palpite a partir do horário de kickoff', () => {
    // Jogo em 15/06/2026 às 16h00 em Brasília
    const kickoff = getJogoKickoffTimestamp('15/06/2026', '16:00')
    expect(kickoff).not.toBeNull()

    // 15:59 em Brasília
    const beforeKickoff = Date.UTC(2026, 5, 15, 18, 59, 0)
    expect(isPalpiteEncerrado('15/06/2026', '16:00', beforeKickoff)).toBe(false)

    // 16:00 em Brasília
    const atKickoff = Date.UTC(2026, 5, 15, 19, 0, 0)
    expect(isPalpiteEncerrado('15/06/2026', '16:00', atKickoff)).toBe(true)

    // 16:05 em Brasília
    const afterKickoff = Date.UTC(2026, 5, 15, 19, 5, 0)
    expect(isPalpiteEncerrado('15/06/2026', '16:00', afterKickoff)).toBe(true)
  })

  it('determina corretamente isJogoHojeNaoIniciado para jogos do dia', () => {
    // 15/06/2026 às 19h00 em Brasília (UTC-3 => 22h00 UTC)
    // Se agora for 18h59 em Brasília (21h59 UTC)
    const beforeKickoff = Date.UTC(2026, 5, 15, 21, 59, 0)
    expect(isJogoHojeNaoIniciado('2026-06-15', '19h00', beforeKickoff)).toBe(true)

    // Se agora for 19h00 em Brasília (22h00 UTC)
    const atKickoff = Date.UTC(2026, 5, 15, 22, 0, 0)
    expect(isJogoHojeNaoIniciado('2026-06-15', '19h00', atKickoff)).toBe(false)

    // Se agora for 19h01 em Brasília (22h01 UTC)
    const afterKickoff = Date.UTC(2026, 5, 15, 22, 1, 0)
    expect(isJogoHojeNaoIniciado('2026-06-15', '19h00', afterKickoff)).toBe(false)

    // Jogo de outro dia (amanhã)
    expect(isJogoHojeNaoIniciado('2026-06-16', '19h00', beforeKickoff)).toBe(false)
  })
})
