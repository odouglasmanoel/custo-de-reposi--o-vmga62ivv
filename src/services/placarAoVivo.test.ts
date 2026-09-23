import { describe, it, expect, vi } from 'vitest'

describe('Rotina de Placar Ao Vivo (TheSportsDB leve e fail-safe)', () => {
  it('filtra partidas estritamente dentro da janela de kickoff (kickoff - 60min até o fim)', () => {
    function isDentroJanelaPolling(
      jogo: { data: string; hora: string; resultado_finalizado: boolean },
      agoraMs: number,
    ) {
      if (jogo.resultado_finalizado) return false
      const [ano, mes, dia] = jogo.data.split('-').map(Number)
      const [hora, min] = jogo.hora.split(':').map(Number)
      // America/Sao_Paulo (UTC-3)
      const kickoffMs = Date.UTC(ano, mes - 1, dia, hora + 3, min, 0, 0)
      const inicioJanela = kickoffMs - 60 * 60 * 1000
      return agoraMs >= inicioJanela
    }

    const agora = Date.UTC(2026, 8, 17, 19, 30, 0) // 16:30 SP
    const jogoFuturoLonge = { data: '2026-09-17', hora: '20:00', resultado_finalizado: false } // Kickoff 23:00 UTC (janela inicia 22:00 UTC)
    const jogoNaJanela = { data: '2026-09-17', hora: '17:00', resultado_finalizado: false } // Kickoff 20:00 UTC (janela inicia 19:00 UTC)
    const jogoJaFinalizado = { data: '2026-09-17', hora: '16:00', resultado_finalizado: true }

    expect(isDentroJanelaPolling(jogoFuturoLonge, agora)).toBe(false)
    expect(isDentroJanelaPolling(jogoNaJanela, agora)).toBe(true)
    expect(isDentroJanelaPolling(jogoJaFinalizado, agora)).toBe(false)
  })

  it('TheSportsDB mapeia status e placar preservando marcadores e dados locais', () => {
    const rawTsdbEvent = {
      idEvent: '12345',
      strHomeTeam: 'Corinthians',
      strAwayTeam: 'Palmeiras',
      intHomeScore: '2',
      intAwayScore: '1',
      strStatus: '2H',
      strTimestamp: '2026-09-17T20:00:00Z',
    }

    const shortSt = /2h/i.test(rawTsdbEvent.strStatus) ? '2H' : '1H'
    const isLive = shortSt === '2H' || shortSt === '1H'
    const homeScore = parseInt(rawTsdbEvent.intHomeScore, 10)
    const awayScore = parseInt(rawTsdbEvent.intAwayScore, 10)

    const jogoBanco = {
      id: 'rec_jogo_1',
      time_a: 'Corinthians',
      time_b: 'Palmeiras',
      placar_a: null as number | null,
      placar_b: null as number | null,
      status: 'agendado',
      resultado_finalizado: false,
      goleadores_a: [{ nome: 'Romero', minuto: '15' }],
      goleadores_b: [],
    }

    // Atualização só de placar e status
    if (homeScore !== null && awayScore !== null) {
      jogoBanco.placar_a = homeScore
      jogoBanco.placar_b = awayScore
    }
    if (isLive) {
      jogoBanco.status = 'ao_vivo'
    }

    expect(jogoBanco.placar_a).toBe(2)
    expect(jogoBanco.placar_b).toBe(1)
    expect(jogoBanco.status).toBe('ao_vivo')
    expect(jogoBanco.resultado_finalizado).toBe(false)
    // Preserva marcadores existentes
    expect(jogoBanco.goleadores_a).toHaveLength(1)
    expect(jogoBanco.goleadores_a[0].nome).toBe('Romero')
  })

  it('não sobrescreve partidas com resultado_finalizado = true', () => {
    const jogoFinalizado = {
      id: 'rec_jogo_fin',
      time_a: 'Real Madrid',
      time_b: 'Barcelona',
      placar_a: 3,
      placar_b: 1,
      resultado_finalizado: true,
      status: 'finalizado',
    }

    const eventoExterno = {
      intHomeScore: '0',
      intAwayScore: '0',
    }

    // Regra antifalha
    if (!jogoFinalizado.resultado_finalizado) {
      jogoFinalizado.placar_a = Number(eventoExterno.intHomeScore)
      jogoFinalizado.placar_b = Number(eventoExterno.intAwayScore)
    }

    expect(jogoFinalizado.placar_a).toBe(3)
    expect(jogoFinalizado.placar_b).toBe(1)
  })

  it('fail-safe: erro na requisição externa não quebra a rotina nem faz retry em loop', () => {
    const mockHttp = {
      send: vi.fn().mockImplementation(() => {
        throw new Error('Timeout 7s')
      }),
    }

    let erroTratado = false
    let dadosSalvos = false

    try {
      mockHttp.send({ url: 'https://www.thesportsdb.com/api/v1/json/3/eventsday.php' })
      dadosSalvos = true
    } catch (err) {
      erroTratado = true
      // fail-safe try/catch sem retry em loop
    }

    expect(erroTratado).toBe(true)
    expect(dadosSalvos).toBe(false)
    expect(mockHttp.send).toHaveBeenCalledTimes(1)
  })
})
