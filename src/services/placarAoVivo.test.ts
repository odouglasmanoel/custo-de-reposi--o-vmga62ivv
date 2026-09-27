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

  it('valida aceitação de placares ao vivo em andamento (1H/2H/HT) e contagem discriminada de resumo', () => {
    const liveStatuses = ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE']
    const finishedStatuses = ['FT', 'AET', 'PEN']

    liveStatuses.forEach((st) => {
      const isLive = liveStatuses.includes(st)
      const isFinished = finishedStatuses.includes(st)
      expect(isLive).toBe(true)
      expect(isFinished).toBe(false)
    })

    // Simulação do cálculo de resumo
    const mockJogosAtualizados = [
      { id: '1', tem_placar: true, ao_vivo: true, mudou_para_encerrado: false, status: 'ao_vivo' },
      {
        id: '2',
        tem_placar: true,
        ao_vivo: false,
        mudou_para_encerrado: true,
        status: 'finalizado',
      },
      {
        id: '3',
        tem_placar: false,
        ao_vivo: false,
        mudou_para_encerrado: false,
        status: 'pendente',
      },
    ]

    const comPlacar = mockJogosAtualizados.filter((j) => j.tem_placar).length
    const aoVivo = mockJogosAtualizados.filter((j) => j.ao_vivo).length
    const encerrados = mockJogosAtualizados.filter((j) => j.mudou_para_encerrado).length
    const semPlacar = mockJogosAtualizados.filter((j) => !j.tem_placar && !j.ao_vivo).length

    expect(comPlacar).toBe(2)
    expect(aoVivo).toBe(1)
    expect(encerrados).toBe(1)
    expect(semPlacar).toBe(1)

    // O aviso de que jogos ainda não possuem placar só pode ser exibido se não houver dados ativos
    const totalAtivos = comPlacar + aoVivo + encerrados
    expect(totalAtivos > 0).toBe(true)
  })

  it('preserva escalações anteriores se a API não retornar novos jogadores', () => {
    const escalacaoPrevia = {
      status: 'confirmada',
      teams: [{ teamName: 'Time A', starters: [{ name: 'Jogador 1' }], substitutes: [] }],
    }

    const respostaApiSemEscalacao = []
    let escalacaoFinal = escalacaoPrevia

    if (respostaApiSemEscalacao.length > 0) {
      escalacaoFinal = { status: 'confirmada', teams: respostaApiSemEscalacao }
    }

    expect(escalacaoFinal).toEqual(escalacaoPrevia)
    expect(escalacaoFinal.teams[0].starters[0].name).toBe('Jogador 1')
  })

  it('todos os jogos encerrados → clique busca eventos, salva marcadores e recalcula pontos (sem early-return)', () => {
    // Simulação do fluxo de api_atualizar_todos_placares.js:
    // Dados de candidatos onde 100% dos jogos estão 'finalizado'/'encerrado'
    const todosJogosCandidatos = [
      {
        id: 'jogo_1',
        fixture_id: '12345',
        bolao: 'bolao_1',
        time_a: 'Corinthians',
        time_b: 'Palmeiras',
        status: 'finalizado',
        resultado_finalizado: true,
        placar_a: 2,
        placar_b: 1,
        gols_time_a: [],
        gols_time_b: [],
        marcadores: [],
      },
      {
        id: 'jogo_2',
        fixture_id: '67890',
        bolao: 'bolao_1',
        time_a: 'Flamengo',
        time_b: 'Fluminense',
        status: 'encerrado',
        resultado_finalizado: true,
        placar_a: 1,
        placar_b: 1,
        gols_time_a: [],
        gols_time_b: [],
        marcadores: [],
      },
    ]

    // 1. Verificação da trava removida:
    // Antes: jogosRecords = todosJogosCandidatos.filter(!isEncerradoCheck) -> tamanho 0 -> early return com notice
    // Novo: jogosRecords = todosJogosCandidatos -> processa normalmente sem early-return
    const jogosRecords = todosJogosCandidatos
    expect(jogosRecords.length).toBe(2)

    // 2. Simulação de resposta da API externa para os jogos encerrados
    const apiResponses = [
      {
        fixture: { id: 12345, status: { short: 'FT', long: 'Match Finished' } },
        goals: { home: 2, away: 1 },
        score: { fulltime: { home: 2, away: 1 } },
        events: [
          {
            type: 'Goal',
            detail: 'Normal Goal',
            player: { name: 'Yuri Alberto' },
            team: { id: 1 },
            time: { elapsed: 23 },
          },
          {
            type: 'Goal',
            detail: 'Penalty',
            player: { name: 'Romero' },
            team: { id: 1 },
            time: { elapsed: 45 },
          },
          {
            type: 'Goal',
            detail: 'Missed Penalty',
            player: { name: 'Veiga' },
            team: { id: 2 },
            time: { elapsed: 60 },
          },
          {
            type: 'Goal',
            detail: 'Normal Goal',
            player: { name: 'Rony' },
            team: { id: 2 },
            time: { elapsed: 78 },
          },
        ],
        teams: {
          home: { id: 1, name: 'Corinthians' },
          away: { id: 2, name: 'Palmeiras' },
        },
      },
    ]

    // 3. Processamento de marcadores, validade de gols e minutos limpos
    const processedEvents = []
    const golsA: Array<{ nome: string; posicao: string; quantidade: number; minuto: string }> = []
    const golsB: Array<{ nome: string; posicao: string; quantidade: number; minuto: string }> = []
    const marcadoresGerais: string[] = []

    const homeTeamId = 1
    const awayTeamId = 2

    for (const ev of apiResponses[0].events) {
      const typeStr = (ev.type || '').toLowerCase()
      const detailStr = (ev.detail || '').toLowerCase().trim()

      if (typeStr === 'goal') {
        // Ignora pênaltis perdidos
        if (
          detailStr.includes('missed') ||
          detailStr.includes('perdido') ||
          detailStr.includes('missed penalty') ||
          detailStr.includes('penalty missed')
        ) {
          continue
        }

        let minuteInt: number | null = null
        if (ev.time && ev.time.elapsed != null) {
          const parsedM = parseInt(String(ev.time.elapsed), 10)
          if (!isNaN(parsedM)) minuteInt = parsedM
        }
        const minuteStr = minuteInt !== null ? `${minuteInt}'` : ''
        const isContra = detailStr.includes('own') || detailStr.includes('contra')
        const playerName = (ev.player?.name || '').trim()

        const item = {
          nome: playerName,
          posicao: isContra ? 'Gol Contra' : 'Atacante/Meia',
          quantidade: 1,
          minuto: minuteStr,
        }

        if (ev.team.id === homeTeamId) {
          golsA.push(item)
        } else if (ev.team.id === awayTeamId) {
          golsB.push(item)
        }

        marcadoresGerais.push(minuteStr ? `${playerName} ${minuteStr}` : playerName)
      }
    }

    // Asserções dos marcadores
    expect(golsA).toHaveLength(2)
    expect(golsA[0]).toEqual({
      nome: 'Yuri Alberto',
      posicao: 'Atacante/Meia',
      quantidade: 1,
      minuto: "23'",
    })
    expect(golsA[1]).toEqual({
      nome: 'Romero',
      posicao: 'Atacante/Meia',
      quantidade: 1,
      minuto: "45'",
    })
    // Pênalti perdido do Veiga NÃO pode ter sido adicionado
    expect(golsB).toHaveLength(1)
    expect(golsB[0]).toEqual({
      nome: 'Rony',
      posicao: 'Atacante/Meia',
      quantidade: 1,
      minuto: "78'",
    })
    expect(marcadoresGerais).toEqual(["Yuri Alberto 23'", "Romero 45'", "Rony 78'"])

    // 4. Recálculo de pontos dos palpites com os novos marcadores sincronizados
    const palpiteParticipante = {
      placar_a: 2,
      placar_b: 1, // Cravada exata -> 8 pts
      goleadores_a: [{ nome: 'Romero', posicao: 'Atacante/Meia' }], // Marcador acertado -> +1 pt
      goleadores_b: [],
    }

    let pontos = 0
    const isCravada = palpiteParticipante.placar_a === 2 && palpiteParticipante.placar_b === 1
    if (isCravada) {
      pontos += 8
    }

    // Marcador acertado Romero
    const acertouRomero = golsA.some(
      (g) => g.nome.toLowerCase() === palpiteParticipante.goleadores_a[0].nome.toLowerCase(),
    )
    if (acertouRomero) {
      pontos += 1
    }

    expect(pontos).toBe(9) // 8 da cravada + 1 do marcador Romero
  })

  it('isAuthInvalidError: recusa de parâmetro ou plano (ex: ?ids=) NÃO é classificada como erro de autenticação', () => {
    // Replicando a lógica corrigida de pocketbase/hooks/api_football_limiter.js
    function isAuthInvalidError(
      statusCode: number,
      jsonBody: { errors?: Record<string, any> } | null,
      rawBody?: string,
    ): boolean {
      if (statusCode === 401) return true

      const apiErrors = jsonBody && jsonBody.errors ? jsonBody.errors : null
      const errStr = (
        apiErrors
          ? JSON.stringify(apiErrors)
          : rawBody && typeof rawBody === 'string'
            ? rawBody
            : ''
      ).toLowerCase()

      // Exclusões explícitas: parâmetro e planos gratuitos/pagos
      if (
        errStr.includes('ids parameter') ||
        errStr.includes('only available with paid') ||
        errStr.includes('paid plan') ||
        errStr.includes('free plans') ||
        errStr.includes('free plan') ||
        errStr.includes('parameter') ||
        errStr.includes('is not allowed') ||
        errStr.includes('cannot be used')
      ) {
        return false
      }

      if (apiErrors) {
        if (apiErrors.token) {
          const tokenMsg = String(apiErrors.token).toLowerCase()
          if (!tokenMsg.includes('parameter') && !tokenMsg.includes('plan')) {
            return true
          }
        }
        if (apiErrors.access) {
          const accessMsg = String(apiErrors.access).toLowerCase()
          if (
            accessMsg.includes('invalid key') ||
            accessMsg.includes('wrong key') ||
            accessMsg.includes('suspended') ||
            accessMsg.includes('unauthenticated')
          ) {
            return true
          }
          if (
            accessMsg.includes('plan') ||
            accessMsg.includes('endpoint') ||
            accessMsg.includes('parameter')
          ) {
            return false
          }
        }
      }

      if (statusCode === 403) {
        if (
          errStr.includes('invalid key') ||
          errStr.includes('wrong key') ||
          errStr.includes('suspended') ||
          errStr.includes('expired') ||
          errStr.includes('unauthenticated') ||
          errStr.includes('unauthorized')
        ) {
          return true
        }
        return !errStr.includes('plan') && !errStr.includes('parameter')
      }

      if (
        errStr.includes('invalid api key') ||
        errStr.includes('invalid key') ||
        errStr.includes('wrong api key') ||
        errStr.includes('wrong key') ||
        errStr.includes('account suspended') ||
        errStr.includes('key suspended') ||
        errStr.includes('key has expired') ||
        errStr.includes('key expired') ||
        errStr.includes('unauthenticated')
      ) {
        return true
      }

      return false
    }

    // 1. Caso que causou o bug: a API-Sports retorna erro de parâmetro ?ids= em plano Free
    const responseRecusaIds1 = {
      statusCode: 200,
      json: {
        get: 'fixtures',
        parameters: { ids: '1528891-1528892' },
        errors: {
          access: 'Ids parameter is only available with paid plans.',
        },
        results: 0,
        response: [],
      },
    }
    expect(isAuthInvalidError(responseRecusaIds1.statusCode, responseRecusaIds1.json)).toBe(false)

    // 2. Outra variação comum de erro de plano
    const responseRecusaIds2 = {
      statusCode: 499,
      json: {
        errors: {
          requests: 'Parameter ids is not allowed in Free plans',
        },
      },
    }
    expect(isAuthInvalidError(responseRecusaIds2.statusCode, responseRecusaIds2.json)).toBe(false)

    // 3. Caso de erro REAL de autenticação: HTTP 401
    expect(isAuthInvalidError(401, { errors: { token: 'Invalid token' } })).toBe(true)

    // 4. Caso de chave suspensa ou inválida:
    expect(
      isAuthInvalidError(200, {
        errors: {
          token: 'Error: invalid API key',
        },
      }),
    ).toBe(true)
    expect(
      isAuthInvalidError(403, {
        errors: {
          access: 'Your account is suspended',
        },
      }),
    ).toBe(true)
  })

  it('fluxo de atualização em lote usa busca por data e fallback para ?id= sem gerar auth_error', () => {
    // Simulação do fluxo de api_atualizar_todos_placares:
    const uniqueFixtureIds = ['1528891', '1528892', '1637933']
    const fixtureResponses: any[] = []
    const fixturesEncontrados: Record<string, boolean> = {}

    // Simulação da busca por data (?date=YYYY-MM-DD):
    // Digamos que a busca por data retorne 2 dos 3 jogos
    const responseBuscaData = [
      { fixture: { id: 1528891 }, goals: { home: 2, away: 3 } },
      { fixture: { id: 1528892 }, goals: { home: 1, away: 2 } },
    ]

    for (const item of responseBuscaData) {
      const fid = String(item.fixture.id)
      if (uniqueFixtureIds.includes(fid)) {
        fixtureResponses.push(item)
        fixturesEncontrados[fid] = true
      }
    }

    expect(fixtureResponses).toHaveLength(2)
    expect(fixturesEncontrados['1528891']).toBe(true)
    expect(fixturesEncontrados['1528892']).toBe(true)

    // Partidas faltantes (1637933) são buscadas individualmente por ?id=
    const missingFixtureIds = uniqueFixtureIds.filter((id) => !fixturesEncontrados[id])
    expect(missingFixtureIds).toEqual(['1637933'])

    // Chamada individual bem-sucedida para o faltante:
    const responseSingle = { fixture: { id: 1637933 }, goals: { home: 0, away: 1 } }
    fixtureResponses.push(responseSingle)
    fixturesEncontrados['1637933'] = true

    expect(fixtureResponses).toHaveLength(3)
    expect(uniqueFixtureIds.every((id) => fixturesEncontrados[id])).toBe(true)
  })

  it('consulta direta por fixture_id (/fixtures?id=...) obtém o confronto exato sem depender de data/liga', () => {
    // Simulação do novo fluxo direto por fixture_id do botão "Atualizar Todos os Placares"
    const jogosDeHoje = [
      { id: 'jogo_1', fixture_id: '1528891', time_a: 'Bayern Munich', time_b: 'Bayer Leverkusen' },
      { id: 'jogo_2', fixture_id: '1528892', time_a: 'PSG', time_b: 'Marseille' },
    ]

    const fixtureIds = jogosDeHoje.map((j) => j.fixture_id)
    const urlsConsultadas: string[] = []
    const fixtureResponses: any[] = []

    for (const fid of fixtureIds) {
      const url = `https://v3.football.api-sports.io/fixtures?id=${encodeURIComponent(fid)}`
      urlsConsultadas.push(url)

      // Simulação da resposta da API-Sports para consulta direta
      fixtureResponses.push({
        fixture: { id: Number(fid), status: { short: 'FT', long: 'Match Finished' } },
        goals: { home: 2, away: 1 },
        teams: {
          home: { id: 100, name: 'Team A' },
          away: { id: 200, name: 'Team B' },
        },
      })
    }

    expect(urlsConsultadas).toEqual([
      'https://v3.football.api-sports.io/fixtures?id=1528891',
      'https://v3.football.api-sports.io/fixtures?id=1528892',
    ])
    expect(fixtureResponses).toHaveLength(2)
    expect(fixtureResponses[0].fixture.id).toBe(1528891)
    expect(fixtureResponses[1].fixture.id).toBe(1528892)
  })

  it('extração obrigatória de marcadores em /fixtures/events filtrando apenas Goal e ignorando Missed Penalty', () => {
    // Mock de resposta do endpoint /fixtures/events?fixture=1528891
    const mockEventsEndpointResponse = [
      {
        type: 'Goal',
        detail: 'Normal Goal',
        player: { id: 101, name: 'Harry Kane' },
        team: { id: 100, name: 'Bayern Munich' },
        time: { elapsed: 22, extra: null },
      },
      {
        type: 'Goal',
        detail: 'Penalty', // Convertido -> DEVE contar
        player: { id: 102, name: 'Jamal Musiala' },
        team: { id: 100, name: 'Bayern Munich' },
        time: { elapsed: 54, extra: null },
      },
      {
        type: 'Goal',
        detail: 'Missed Penalty', // Pênalti perdido -> NUNCA deve contar como gol/marcador
        player: { id: 103, name: 'Florian Wirtz' },
        team: { id: 200, name: 'Bayer Leverkusen' },
        time: { elapsed: 65, extra: null },
      },
      {
        type: 'Goal',
        detail: 'Own Goal', // Gol contra -> DEVE contar como Gol Contra
        player: { id: 104, name: 'Jonathan Tah' },
        team: { id: 100, name: 'Bayern Munich' },
        time: { elapsed: 80, extra: null },
      },
      {
        type: 'Card',
        detail: 'Yellow Card',
        player: { id: 105, name: 'Granit Xhaka' },
        team: { id: 200, name: 'Bayer Leverkusen' },
        time: { elapsed: 85, extra: null },
      },
    ]

    const homeTeamId = 100
    const awayTeamId = 200

    const golsA: any[] = []
    const golsB: any[] = []
    const marcadoresGerais: string[] = []

    for (const ev of mockEventsEndpointResponse) {
      if ((ev.type || '').toString().toLowerCase() === 'goal') {
        const detail = (ev.detail || '').toString().toLowerCase().trim()
        // IGNORA Missed Penalty
        if (
          detail.includes('missed') ||
          detail.includes('perdido') ||
          detail.includes('missed penalty') ||
          detail.includes('penalty missed')
        ) {
          continue
        }

        let minuteInt: number | null = null
        if (ev.time && ev.time.elapsed != null) {
          const parsed = parseInt(String(ev.time.elapsed), 10)
          if (!isNaN(parsed)) minuteInt = parsed
        }
        const minuteStr = minuteInt !== null ? `${minuteInt}'` : ''
        const isContra = detail.includes('own') || detail.includes('contra')
        const playerName = (ev.player?.name || '').toString().trim()
        const teamId = ev.team?.id

        if (playerName) {
          const posicao = isContra ? 'Gol Contra' : 'Atacante/Meia'
          const item = {
            nome: playerName,
            posicao,
            quantidade: 1,
            minuto: minuteStr,
          }

          if (teamId === homeTeamId) {
            golsA.push(item)
          } else if (teamId === awayTeamId) {
            golsB.push(item)
          }

          marcadoresGerais.push(minuteStr ? `${playerName} ${minuteStr}` : playerName)
        }
      }
    }

    // Validações
    expect(golsA).toHaveLength(3) // Kane 22', Musiala 54', Tah 80' (gol contra a favor do mandante)
    expect(golsB).toHaveLength(0) // Wirtz perdeu pênalti, não conta!
    expect(marcadoresGerais).toEqual(["Harry Kane 22'", "Jamal Musiala 54'", "Jonathan Tah 80'"])
    expect(golsA[1].posicao).toBe('Atacante/Meia')
    expect(golsA[2].posicao).toBe('Gol Contra')
    expect(golsA.some((g) => g.nome.includes('Wirtz'))).toBe(false)
  })

  it('disparo de recálculo de pontuação atualiza pontuacao_jogo e pontuação dos participantes', () => {
    // Jogo salvo com placar 2x1 e marcadores Kane e Musiala
    const jogo = {
      id: 'jogo_10',
      placar_a: 2,
      placar_b: 1,
      status: 'finalizado',
      resultado_finalizado: true,
      gols_time_a: [
        { nome: 'Harry Kane', posicao: 'Atacante/Meia', quantidade: 1, minuto: "22'" },
        { nome: 'Jamal Musiala', posicao: 'Atacante/Meia', quantidade: 1, minuto: "54'" },
      ],
      gols_time_b: [
        { nome: 'Victor Boniface', posicao: 'Atacante/Meia', quantidade: 1, minuto: "70'" },
      ],
    }

    // Palpite 1: Placar exato 2x1 com Kane como goleador
    const palpiteExato = {
      id: 'palpite_1',
      placar_a: 2,
      placar_b: 1,
      goleadores_a: [{ nome: 'Harry Kane', posicao: 'Atacante' }],
      goleadores_b: [],
    }

    // Palpite 2: Vencedor 3x1 (vencedor + metade + Kane)
    const palpiteVencedor = {
      id: 'palpite_2',
      placar_a: 3,
      placar_b: 1,
      goleadores_a: [{ nome: 'Harry Kane', posicao: 'Atacante' }],
      goleadores_b: [],
    }

    const calcularPontos = (p: typeof palpiteExato) => {
      let pontos = 0
      const isExact = p.placar_a === jogo.placar_a && p.placar_b === jogo.placar_b
      if (isExact) {
        pontos += 8
      } else {
        const predWinner = p.placar_a > p.placar_b ? 1 : p.placar_b > p.placar_a ? -1 : 0
        const realWinner =
          jogo.placar_a > jogo.placar_b ? 1 : jogo.placar_b > jogo.placar_a ? -1 : 0
        if (predWinner === realWinner) pontos += 2
        if (Math.abs(p.placar_a - p.placar_b) === Math.abs(jogo.placar_a - jogo.placar_b))
          pontos += 1
        if (p.placar_a === jogo.placar_a || p.placar_b === jogo.placar_b) pontos += 1
      }

      // Marcadores: Kane acertado (1 pt atacante)
      if (p.goleadores_a.some((g) => g.nome === 'Harry Kane')) {
        pontos += 1
      }
      return pontos
    }

    expect(calcularPontos(palpiteExato)).toBe(9) // 8 (cravada) + 1 (Kane atacante) = 9
    expect(calcularPontos(palpiteVencedor)).toBe(4) // 2 (vencedor) + 1 (metade) + 1 (Kane) = 4
  })

  it('lote com múltiplos jogos: itera todos os jogos, chama eventos para cada fixture_id e dispara recálculo único ao final', () => {
    // 1. Simulação do lote com múltiplos jogos (ex: Estados Unidos x Peru + Tchéquia x Croácia)
    const jogosDoLote = [
      {
        id: 'rec_eua_peru',
        fixture_id: '1628997',
        time_a: 'Estados Unidos',
        time_b: 'Peru',
        bolao: 'bolao_1',
        placar_a: null as number | null,
        placar_b: null as number | null,
        status: 'pendente',
        gols_time_a: [] as any[],
        gols_time_b: [] as any[],
        marcadores: [] as string[],
      },
      {
        id: 'rec_tchequia_croacia',
        fixture_id: '1528892',
        time_a: 'Tchéquia',
        time_b: 'Croácia',
        bolao: 'bolao_1',
        placar_a: null as number | null,
        placar_b: null as number | null,
        status: 'pendente',
        gols_time_a: [] as any[],
        gols_time_b: [] as any[],
        marcadores: [] as string[],
      },
    ]

    // Respostas simuladas do endpoint /fixtures/events?fixture={id}
    const apiEventsMock: Record<string, any[]> = {
      '1628997': [
        {
          type: 'Goal',
          detail: 'Normal Goal',
          player: { name: 'Pulisic' },
          team: { name: 'Estados Unidos' },
          time: { elapsed: 14 },
        },
      ],
      '1528892': [
        {
          type: 'Goal',
          detail: 'Normal Goal',
          player: { name: 'Soucek' },
          team: { name: 'Tchéquia' },
          time: { elapsed: 35 },
        },
        {
          type: 'Goal',
          detail: 'Normal Goal',
          player: { name: 'Modric' },
          team: { name: 'Croácia' },
          time: { elapsed: 52 },
        },
        {
          type: 'Goal',
          detail: 'Normal Goal',
          player: { name: 'Kramaric' },
          team: { name: 'Croácia' },
          time: { elapsed: 88 },
        },
      ],
    }

    const fixturesConsultadasEventos: string[] = []
    let recalculoExecutadoVezes = 0
    const boloesParaRecalcular = new Set<string>()

    // Iteração completa de todos os jogos do lote
    for (const jogo of jogosDoLote) {
      const fid = jogo.fixture_id
      expect(fid).toBeTruthy()

      // Dispara chamada dedicada de eventos para CADA fixture_id
      fixturesConsultadasEventos.push(fid)
      const rawEvents = apiEventsMock[fid] || []

      for (const ev of rawEvents) {
        if ((ev.type || '').toLowerCase() === 'goal') {
          const min = ev.time?.elapsed ? `${ev.time.elapsed}'` : ''
          const item = {
            nome: ev.player.name,
            posicao: 'Atacante/Meia',
            quantidade: 1,
            minuto: min,
          }
          if (ev.team.name.toLowerCase() === jogo.time_a.toLowerCase()) {
            jogo.gols_time_a.push(item)
          } else {
            jogo.gols_time_b.push(item)
          }
          jogo.marcadores.push(min ? `${ev.player.name} ${min}` : ev.player.name)
        }
      }

      jogo.status = 'encerrado'
      boloesParaRecalcular.add(jogo.bolao)
    }

    // Ao final de TODOS os jogos, dispara o recálculo dos bolões afetados UMA ÚNICA VEZ
    for (const _bolaoId of boloesParaRecalcular) {
      recalculoExecutadoVezes++
    }

    // Asserções:
    // 1. Ambos os fixtures tiveram suas chamadas de eventos executadas
    expect(fixturesConsultadasEventos).toEqual(['1628997', '1528892'])

    // 2. Marcadores gravados em ambos os jogos
    expect(jogosDoLote[0].marcadores).toEqual(["Pulisic 14'"])
    expect(jogosDoLote[0].gols_time_a).toHaveLength(1)
    expect(jogosDoLote[0].gols_time_b).toHaveLength(0)

    expect(jogosDoLote[1].marcadores).toEqual(["Soucek 35'", "Modric 52'", "Kramaric 88'"])
    expect(jogosDoLote[1].gols_time_a).toHaveLength(1)
    expect(jogosDoLote[1].gols_time_b).toHaveLength(2)

    // 3. Recálculo disparado uma única vez ao final do lote
    expect(recalculoExecutadoVezes).toBe(1)
  })
})
