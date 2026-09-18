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
  compareJogosCadastrados,
  sortJogosCadastrados,
  compareJogosCrescente,
  sortJogosCrescente,
  compareJogosDecrescente,
  sortJogosDecrescente,
  formatDataHoraSaoPaulo,
  satisfiesEnqueteMinTimeMargin,
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

  describe('formatDataHoraSaoPaulo (Conversão de APIs para America/Sao_Paulo UTC-3)', () => {
    it('converte corretamente ISO UTC de partida para data e hora em Brasília', () => {
      // 2026-06-15T21:30:00Z em UTC -> 18:30 em Brasília (UTC-3)
      const res1 = formatDataHoraSaoPaulo('2026-06-15T21:30:00Z')
      expect(res1.data).toBe('2026-06-15')
      expect(res1.horario).toBe('18:30')

      // 2026-06-16T01:00:00Z em UTC -> 22:00 do dia 15 em Brasília
      const res2 = formatDataHoraSaoPaulo('2026-06-16T01:00:00Z')
      expect(res2.data).toBe('2026-06-15')
      expect(res2.horario).toBe('22:00')

      // Date simples com hora em formato string
      const res3 = formatDataHoraSaoPaulo('2026-06-15', '16:00')
      expect(res3.data).toBe('2026-06-15')
      expect(res3.horario).toBe('16:00')
    })
  })

  describe('satisfiesEnqueteMinTimeMargin (Filtro de Margem Mínima de +3 Horas)', () => {
    // Momento da criação da enquete: 15/06/2026 às 12h00 em Brasília (15h00 UTC)
    const agoraCriacaoEnquete = Date.UTC(2026, 5, 15, 15, 0, 0)

    it('rejeita partidas que começam em menos de 3 horas', () => {
      // Começa às 14h00 em Brasília (faltam 2 horas) -> Rejeita
      expect(satisfiesEnqueteMinTimeMargin('2026-06-15', '14:00', agoraCriacaoEnquete, 3)).toBe(
        false,
      )

      // Começa às 14h59 em Brasília (faltam 2h59min) -> Rejeita
      expect(satisfiesEnqueteMinTimeMargin('2026-06-15', '14:59', agoraCriacaoEnquete, 3)).toBe(
        false,
      )

      // Já começou (11h00 em Brasília) -> Rejeita
      expect(satisfiesEnqueteMinTimeMargin('2026-06-15', '11:00', agoraCriacaoEnquete, 3)).toBe(
        false,
      )
    })

    it('aceita partidas que começam com exatamente ou mais de 3 horas de antecedência', () => {
      // Começa às 15h00 em Brasília (exatas 3 horas a partir das 12h00) -> Aceita
      expect(satisfiesEnqueteMinTimeMargin('2026-06-15', '15:00', agoraCriacaoEnquete, 3)).toBe(
        true,
      )

      // Começa às 16h00 em Brasília (4 horas a partir das 12h00) -> Aceita
      expect(satisfiesEnqueteMinTimeMargin('2026-06-15', '16:00', agoraCriacaoEnquete, 3)).toBe(
        true,
      )

      // Partida do dia seguinte -> Aceita
      expect(satisfiesEnqueteMinTimeMargin('2026-06-16', '16:00', agoraCriacaoEnquete, 3)).toBe(
        true,
      )
    })
  })

  describe('compareJogosCadastrados / sortJogosCadastrados', () => {
    it('ordena jogos pendentes primeiro, data decrescente e horário crescente', () => {
      const jogosTeste = [
        { id: '1', data: '2026-06-10', hora: '21:30', resultado_finalizado: true },
        { id: '2', data: '2026-06-12', hora: '20:00', resultado_finalizado: false },
        { id: '3', data: '2026-06-12', hora: '16:00', resultado_finalizado: false },
        { id: '4', data: '2026-06-15', hora: '18:00', resultado_finalizado: false },
        { id: '5', data: '2026-06-11', hora: '16:00', resultado_finalizado: true },
        { id: '6', data: '2026-06-10', hora: '16:00', resultado_finalizado: true },
      ]

      const sorted = sortJogosCadastrados(jogosTeste)

      // 1. Jogos pendentes vêm primeiro: ids 4, 3, 2
      // Na data mais recente (2026-06-15): id 4
      // Na data seguinte (2026-06-12): id 3 (16:00) antes de id 2 (20:00)
      expect(sorted[0].id).toBe('4')
      expect(sorted[1].id).toBe('3')
      expect(sorted[2].id).toBe('2')

      // 2. Jogos finalizados vêm depois:
      // Data mais recente dos finalizados: 2026-06-11 (id 5)
      expect(sorted[3].id).toBe('5')
      // Na data 2026-06-10: id 6 (16:00) antes de id 1 (21:30)
      expect(sorted[4].id).toBe('6')
      expect(sorted[5].id).toBe('1')
    })
  })

  describe('compareJogosCrescente / sortJogosCrescente', () => {
    it('ordena jogos pendentes primeiro, com datas e horários em ordem crescente (mais próximos de acontecer no topo)', () => {
      const jogosTeste = [
        { id: '1', data: '2026-06-15', hora: '18:00', resultado_finalizado: false },
        { id: '2', data: '2026-06-12', hora: '20:00', resultado_finalizado: false },
        { id: '3', data: '2026-06-12', hora: '16:00', resultado_finalizado: false },
        { id: '4', data: '2026-06-10', hora: '21:30', resultado_finalizado: true },
        { id: '5', data: '2026-06-11', hora: '16:00', resultado_finalizado: true },
        { id: '6', data: '2026-06-10', hora: '16:00', resultado_finalizado: true },
      ]

      const sorted = sortJogosCrescente(jogosTeste)

      // 1. Jogos pendentes vêm primeiro, em ordem crescente de data e horário:
      // Mais próximo: 2026-06-12 às 16:00 (id 3)
      expect(sorted[0].id).toBe('3')
      // Segundo mais próximo: 2026-06-12 às 20:00 (id 2)
      expect(sorted[1].id).toBe('2')
      // Terceiro: 2026-06-15 às 18:00 (id 1)
      expect(sorted[2].id).toBe('1')

      // 2. Jogos finalizados vêm depois, também em ordem crescente:
      // 2026-06-10 às 16:00 (id 6)
      expect(sorted[3].id).toBe('6')
      // 2026-06-10 às 21:30 (id 4)
      expect(sorted[4].id).toBe('4')
      // 2026-06-11 às 16:00 (id 5)
      expect(sorted[5].id).toBe('5')
    })
  })

  describe('compareJogosDecrescente / sortJogosDecrescente', () => {
    it('ordena jogos pendentes primeiro, com datas e horários em ordem decrescente (mais recentes/distantes no topo)', () => {
      const jogosTeste = [
        { id: '1', data: '2026-06-12', hora: '16:00', resultado_finalizado: false },
        { id: '2', data: '2026-06-15', hora: '18:00', resultado_finalizado: false },
        { id: '3', data: '2026-06-12', hora: '20:00', resultado_finalizado: false },
        { id: '4', data: '2026-06-10', hora: '16:00', resultado_finalizado: true },
        { id: '5', data: '2026-06-11', hora: '16:00', resultado_finalizado: true },
        { id: '6', data: '2026-06-10', hora: '21:30', resultado_finalizado: true },
      ]

      const sorted = sortJogosDecrescente(jogosTeste)

      // 1. Jogos pendentes vêm primeiro, em ordem decrescente de data e horário:
      // Mais distante/futuro: 2026-06-15 às 18:00 (id 2)
      expect(sorted[0].id).toBe('2')
      // Na data 2026-06-12: mais tarde primeiro (20:00 -> id 3) antes de (16:00 -> id 1)
      expect(sorted[1].id).toBe('3')
      expect(sorted[2].id).toBe('1')

      // 2. Jogos finalizados vêm depois, também em ordem decrescente:
      // Mais recente: 2026-06-11 às 16:00 (id 5)
      expect(sorted[3].id).toBe('5')
      // Na data 2026-06-10: mais tarde primeiro (21:30 -> id 6) antes de (16:00 -> id 4)
      expect(sorted[4].id).toBe('6')
      expect(sorted[5].id).toBe('4')
    })
  })
})
