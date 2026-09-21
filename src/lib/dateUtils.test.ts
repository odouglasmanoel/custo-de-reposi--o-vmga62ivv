import { describe, it, expect } from 'vitest'
import {
  formatDataBR,
  formatHoraBR,
  getJogoKickoffTimestamp,
  getJogoSortTimestamp,
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
  formatEnqueteTituloDinamico,
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
    it('ordena todos os jogos de forma unificada (finalizados e pendentes juntos) em ordem crescente', () => {
      const jogosTeste = [
        { id: '1', data: '2026-06-15', hora: '18:00', resultado_finalizado: false },
        { id: '2', data: '2026-06-12', hora: '20:00', resultado_finalizado: false },
        { id: '3', data: '2026-06-12', hora: '16:00', resultado_finalizado: false },
        { id: '4', data: '2026-06-10', hora: '21:30', resultado_finalizado: true },
        { id: '5', data: '2026-06-11', hora: '16:00', resultado_finalizado: true },
        { id: '6', data: '2026-06-10', hora: '16:00', resultado_finalizado: true },
      ]

      const sorted = sortJogosCrescente(jogosTeste)

      // Ordem cronológica estrita crescente:
      // 1. 2026-06-10 16:00 (id 6)
      expect(sorted[0].id).toBe('6')
      // 2. 2026-06-10 21:30 (id 4)
      expect(sorted[1].id).toBe('4')
      // 3. 2026-06-11 16:00 (id 5)
      expect(sorted[2].id).toBe('5')
      // 4. 2026-06-12 16:00 (id 3)
      expect(sorted[3].id).toBe('3')
      // 5. 2026-06-12 20:00 (id 2)
      expect(sorted[4].id).toBe('2')
      // 6. 2026-06-15 18:00 (id 1)
      expect(sorted[5].id).toBe('1')
    })

    it('ordena jogos finalizados com horários "19h00" e "21h30" (formato com h) corretamente na ordem crescente', () => {
      const jogosComH = [
        {
          id: 'flamengo_delvalle',
          time: 'Flamengo x Del Valle',
          data: '2026-09-17',
          hora: '21h30',
          resultado_finalizado: true,
        },
        {
          id: 'corinthians_estudiantes',
          time: 'Corinthians x Estudiantes',
          data: '2026-09-16',
          hora: '21h30',
          resultado_finalizado: true,
        },
        {
          id: 'ldu_palmeiras',
          time: 'LDU x Palmeiras',
          data: '2026-09-16',
          hora: '19h00',
          resultado_finalizado: true,
        },
        {
          id: 'atletico_santos',
          time: 'Atlético-MG x Santos',
          data: '2026-09-17',
          hora: '19h00',
          resultado_finalizado: true,
        },
      ]

      const sorted = sortJogosCrescente(jogosComH)
      expect(sorted.map((j) => j.id)).toEqual([
        'ldu_palmeiras', // 16/09 às 19h00
        'corinthians_estudiantes', // 16/09 às 21h30
        'atletico_santos', // 17/09 às 19h00
        'flamengo_delvalle', // 17/09 às 21h30
      ])
    })
  })

  describe('compareJogosDecrescente / sortJogosDecrescente', () => {
    it('ordena todos os jogos de forma unificada (finalizados e pendentes juntos) em ordem decrescente', () => {
      const jogosTeste = [
        { id: '1', data: '2026-06-12', hora: '16:00', resultado_finalizado: false },
        { id: '2', data: '2026-06-15', hora: '18:00', resultado_finalizado: false },
        { id: '3', data: '2026-06-12', hora: '20:00', resultado_finalizado: false },
        { id: '4', data: '2026-06-10', hora: '16:00', resultado_finalizado: true },
        { id: '5', data: '2026-06-11', hora: '16:00', resultado_finalizado: true },
        { id: '6', data: '2026-06-10', hora: '21:30', resultado_finalizado: true },
      ]

      const sorted = sortJogosDecrescente(jogosTeste)

      // Ordem cronológica estrita decrescente:
      // 1. 2026-06-15 18:00 (id 2)
      expect(sorted[0].id).toBe('2')
      // 2. 2026-06-12 20:00 (id 3)
      expect(sorted[1].id).toBe('3')
      // 3. 2026-06-12 16:00 (id 1)
      expect(sorted[2].id).toBe('1')
      // 4. 2026-06-11 16:00 (id 5)
      expect(sorted[3].id).toBe('5')
      // 5. 2026-06-10 21:30 (id 6)
      expect(sorted[4].id).toBe('6')
      // 6. 2026-06-10 16:00 (id 4)
      expect(sorted[5].id).toBe('4')
    })

    it('ordena jogos finalizados com horários "19h00" e "21h30" (formato com h) corretamente na ordem decrescente', () => {
      const jogosComH = [
        {
          id: 'ldu_palmeiras',
          time: 'LDU x Palmeiras',
          data: '2026-09-16',
          hora: '19h00',
          resultado_finalizado: true,
        },
        {
          id: 'corinthians_estudiantes',
          time: 'Corinthians x Estudiantes',
          data: '2026-09-16',
          hora: '21h30',
          resultado_finalizado: true,
        },
        {
          id: 'atletico_santos',
          time: 'Atlético-MG x Santos',
          data: '2026-09-17',
          hora: '19h00',
          resultado_finalizado: true,
        },
        {
          id: 'flamengo_delvalle',
          time: 'Flamengo x Del Valle',
          data: '2026-09-17',
          hora: '21h30',
          resultado_finalizado: true,
        },
      ]

      const sorted = sortJogosDecrescente(jogosComH)
      expect(sorted.map((j) => j.id)).toEqual([
        'flamengo_delvalle', // 17/09 às 21h30
        'atletico_santos', // 17/09 às 19h00
        'corinthians_estudiantes', // 16/09 às 21h30
        'ldu_palmeiras', // 16/09 às 19h00
      ])
    })

    it('posiciona corretamente jogos futuros no modo decrescente (ex: 17/09/2026 antes de 16/09/2026)', () => {
      const jogosTeste = [
        { id: 'flamengo_idv', data: '2026-09-17', hora: '21:30', resultado_finalizado: false },
        { id: 'jogo_16_01', data: '2026-09-16', hora: '19:00', resultado_finalizado: false },
        { id: 'jogo_16_02', data: '2026-09-16', hora: '21:30', resultado_finalizado: false },
      ]

      const sorted = sortJogosDecrescente(jogosTeste)
      expect(sorted[0].id).toBe('flamengo_idv')
      expect(sorted[1].id).toBe('jogo_16_02')
      expect(sorted[2].id).toBe('jogo_16_01')
    })

    it('ordena decrescente exatamente conforme exemplo do usuário: 20/09 16h00 antes de 20/09 15h45, antes de 19/09 18h00, antes de 16/09 16h00', () => {
      const jogosExemplo = [
        { id: 'j_16_16h', data: '2026-09-16', hora: '16:00', resultado_finalizado: true },
        { id: 'j_20_15h45', data: '2026-09-20', hora: '15:45', resultado_finalizado: true },
        { id: 'j_19_18h', data: '2026-09-19', hora: '18:00', resultado_finalizado: true },
        { id: 'j_20_16h00', data: '2026-09-20', hora: '16:00', resultado_finalizado: true },
      ]

      const ordenados = sortJogosDecrescente(jogosExemplo)
      expect(ordenados.map((j) => j.id)).toEqual([
        'j_20_16h00', // 20/09 16:00
        'j_20_15h45', // 20/09 15:45
        'j_19_18h', // 19/09 18:00
        'j_16_16h', // 16/09 16:00
      ])
    })

    it('reordena jogos corretamente alternando entre asc (crescente) e desc (decrescente)', () => {
      const getGameTimestampMs = (jogo: { data: string; hora: string }): number => {
        const dataISO = normalizeDataISO(jogo.data)
        const hora = (jogo.hora || '12:00').trim().substring(0, 5)
        const ts = new Date(`${dataISO}T${hora}:00`).getTime()
        return isNaN(ts) ? 0 : ts
      }

      const sortJogosByOrder = (
        lista: Array<{ id: string; data: string; hora: string; resultado_finalizado?: boolean }>,
        order: 'asc' | 'desc',
      ) => {
        return [...lista].sort((a, b) => {
          const tsA = getGameTimestampMs(a)
          const tsB = getGameTimestampMs(b)
          return order === 'asc' ? tsA - tsB : tsB - tsA
        })
      }

      const lista = [
        { id: 'jogo_10_06', data: '2026-06-10', hora: '16:00', resultado_finalizado: false },
        { id: 'jogo_15_06', data: '2026-06-15', hora: '20:00', resultado_finalizado: false },
        { id: 'jogo_12_06', data: '2026-06-12', hora: '18:00', resultado_finalizado: false },
      ]

      const asc = sortJogosByOrder(lista, 'asc')
      expect(asc.map((j) => j.id)).toEqual(['jogo_10_06', 'jogo_12_06', 'jogo_15_06'])

      const desc = sortJogosByOrder(lista, 'desc')
      expect(desc.map((j) => j.id)).toEqual(['jogo_15_06', 'jogo_12_06', 'jogo_10_06'])
    })

    it('ordena jogos da visualização "Exibindo todos os jogos" e "Apenas Pendentes" com a regra canônica de timestamp', () => {
      const getMatchSortTimestamp = (jogo: { data: string; hora: string }): number => {
        let isoDate = jogo.data
        if (isoDate.includes('/')) {
          const [d, m, y] = isoDate.split('/')
          isoDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
        } else {
          const normalized = normalizeDataISO(isoDate)
          if (normalized) isoDate = normalized
        }
        const hora = (jogo.hora || '00:00').slice(0, 5)
        const ts = new Date(`${isoDate}T${hora}:00`).getTime()
        return isNaN(ts) ? 0 : ts
      }

      const ordenarJogos = (
        listaJogos: Array<{
          id: string
          data: string
          hora: string
          resultado_finalizado?: boolean
        }>,
        ordem: 'crescente' | 'decrescente',
      ) => {
        return [...listaJogos].sort((a, b) => {
          const tsA = getMatchSortTimestamp(a)
          const tsB = getMatchSortTimestamp(b)
          if (ordem === 'decrescente') {
            return tsB - tsA
          } else {
            return tsA - tsB
          }
        })
      }

      // Caso 1: Decrescente em "Exibindo todos os jogos" (21/09/2026 -> 19/09/2026 -> 17/09/2026 -> 16/09/2026)
      const listaTodos = [
        { id: 'j_16', data: '16/09/2026', hora: '19:00', resultado_finalizado: true },
        { id: 'j_21', data: '21/09/2026', hora: '21:30', resultado_finalizado: false },
        { id: 'j_17', data: '17/09/2026', hora: '20:00', resultado_finalizado: true },
        { id: 'j_19', data: '19/09/2026', hora: '16:00', resultado_finalizado: false },
      ]

      const descTodos = ordenarJogos(listaTodos, 'decrescente')
      expect(descTodos.map((j) => j.id)).toEqual(['j_21', 'j_19', 'j_17', 'j_16'])

      // Caso 2: Crescente em "Exibindo todos os jogos" (16/09/2026 -> 17/09/2026 -> 19/09/2026 -> 21/09/2026)
      const ascTodos = ordenarJogos(listaTodos, 'crescente')
      expect(ascTodos.map((j) => j.id)).toEqual(['j_16', 'j_17', 'j_19', 'j_21'])

      // Caso 3: Pendentes no modo decrescente (21/09/2026 21h30 vem antes de 19/09/2026 16h00)
      const listaPendentes = [
        { id: 'pend_19_16h', data: '2026-09-19', hora: '16:00', resultado_finalizado: false },
        { id: 'pend_21_21h30', data: '2026-09-21', hora: '21:30', resultado_finalizado: false },
      ]
      const descPendentes = ordenarJogos(listaPendentes, 'decrescente')
      expect(descPendentes.map((j) => j.id)).toEqual(['pend_21_21h30', 'pend_19_16h'])

      // Caso 4: Mesmo dia com horários diferentes
      const listaMesmoDia = [
        { id: 'jogo_tarde', data: '2026-09-20', hora: '16:00', resultado_finalizado: false },
        { id: 'jogo_noite', data: '2026-09-20', hora: '21:30', resultado_finalizado: false },
        { id: 'jogo_manha', data: '2026-09-20', hora: '11:00', resultado_finalizado: false },
      ]
      const descMesmoDia = ordenarJogos(listaMesmoDia, 'decrescente')
      expect(descMesmoDia.map((j) => j.id)).toEqual(['jogo_noite', 'jogo_tarde', 'jogo_manha'])

      const ascMesmoDia = ordenarJogos(listaMesmoDia, 'crescente')
      expect(ascMesmoDia.map((j) => j.id)).toEqual(['jogo_manha', 'jogo_tarde', 'jogo_noite'])
    })
  })

  describe('formatEnqueteTituloDinamico (Nomenclatura Dinâmica da Enquete)', () => {
    it('calcula o título a partir da menor e maior data dos jogos no fuso de SP', () => {
      const jogos = [
        { data: '2026-09-24', horario: '15:45' },
        { data: '2026-09-23', horario: '17:00' },
        { data: '2026-09-26', horario: '15:45' },
        { data: '2026-09-25', horario: '20:00' },
      ]

      const tituloSemStatus = formatEnqueteTituloDinamico({
        titulo: 'Enquete Copa Coni',
        jogos,
        data_inicio: '2026-09-22',
        data_fim: '2026-10-06',
        status: 'aberta',
      })

      expect(tituloSemStatus).toBe('Enquete Copa Coni — 23/09/2026 a 26/09/2026')

      const tituloComStatus = formatEnqueteTituloDinamico({
        titulo: 'Enquete Copa Coni',
        jogos,
        data_inicio: '2026-09-22',
        data_fim: '2026-10-06',
        status: 'aberta',
        incluirStatus: true,
      })

      expect(tituloComStatus).toBe('Enquete Copa Coni — 23/09/2026 a 26/09/2026 (Aberta)')
    })

    it('formata o status corretamente entre Aberta, Encerrada e Cadastrada', () => {
      const jogos = [
        { data: '2026-09-23', horario: '17:00' },
        { data: '2026-09-26', horario: '15:45' },
      ]

      expect(
        formatEnqueteTituloDinamico({
          status: 'cadastrada',
          jogos,
          incluirStatus: true,
        }),
      ).toBe('Enquete Copa Coni — 23/09/2026 a 26/09/2026 (Cadastrada)')

      expect(
        formatEnqueteTituloDinamico({
          status: 'encerrada',
          jogos,
          incluirStatus: true,
        }),
      ).toBe('Enquete Copa Coni — 23/09/2026 a 26/09/2026 (Encerrada)')

      expect(
        formatEnqueteTituloDinamico({
          status: 'aberta',
          jogos,
          incluirStatus: true,
        }),
      ).toBe('Enquete Copa Coni — 23/09/2026 a 26/09/2026 (Aberta)')
    })

    it('fallback seguro: quando a enquete não possui jogos cadastrados usa data_inicio a data_fim sem quebrar', () => {
      const semJogos = formatEnqueteTituloDinamico({
        titulo: 'Enquete Copa Coni',
        data_inicio: '2026-09-22',
        data_fim: '2026-10-06',
        status: 'aberta',
        jogos: [],
        incluirStatus: true,
      })

      expect(semJogos).toBe('Enquete Copa Coni — 22/09/2026 a 06/10/2026 (Aberta)')
    })

    it('suporta formatos de data heterogêneos (ISO UTC, DD/MM/YYYY, Date object) e campo hora/horario', () => {
      const jogosHeterogeneos = [
        { data: '23/09/2026', hora: '19:00' },
        { data: '2026-09-26T18:45:00.000Z', horario: '15:45' },
        { data: new Date('2026-09-24T12:00:00.000Z'), horario: '12:00' },
      ]

      const resultado = formatEnqueteTituloDinamico({
        titulo: 'Enquete Copa Coni',
        jogos: jogosHeterogeneos,
        data_inicio: '2026-09-20',
        data_fim: '2026-09-30',
        status: 'aberta',
      })

      expect(resultado).toBe('Enquete Copa Coni — 23/09/2026 a 26/09/2026')
    })

    it('preserva nomes de copas/competições customizadas no prefixo do título', () => {
      const jogos = [
        { data: '2026-09-23', horario: '17:00' },
        { data: '2026-09-26', horario: '15:45' },
      ]

      const resultado = formatEnqueteTituloDinamico({
        titulo: 'Enquete Champions Coni — 01/01/2026 a 02/01/2026',
        jogos,
        status: 'aberta',
        incluirStatus: true,
      })

      expect(resultado).toBe('Enquete Champions Coni — 23/09/2026 a 26/09/2026 (Aberta)')
    })

    it('se houver apenas um único jogo cadastrado, exibe data única ou mesmo início e fim', () => {
      const jogoUnico = [{ data: '2026-09-23', horario: '17:00' }]
      const resultado = formatEnqueteTituloDinamico({
        titulo: 'Enquete Copa Coni',
        jogos: jogoUnico,
      })

      expect(resultado).toBe('Enquete Copa Coni — 23/09/2026 a 23/09/2026')
    })
  })
})
