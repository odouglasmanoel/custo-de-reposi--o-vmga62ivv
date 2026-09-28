// pocketbase/hooks/api_atualizar_todos_placares.js
// Endpoint: POST /backend/v1/placar-ao-vivo/atualizar-todos
// Atualização em lote de placares, marcadores e fichas (eventos: gols, cartões, substituições)
// para todos os jogos programados para o dia de hoje (ou lista explícita de jogoIds)
// em UMA ÚNICA chamada à API-Football usando o endpoint consolidado /fixtures?ids={id-id-...} (ou fallback ?id=...)
//
// REGRAS:
// - Apenas admin Douglas (douglas, douglas@repress.com.br, etc)
// - Respeita o limitador central e cota diária (api_football_daily_usage, reset às 21h Brasília)
// - Persiste placar_a, placar_b, marcadores, gols_time_a, gols_time_b, status, url_escudo_mandante/visitante e ficha_detalhes no banco
// - Dispara recálculo inline das pontuações dos palpites e ranking para os jogos atualizados

routerAdd(
  'POST',
  '/backend/v1/placar-ao-vivo/atualizar-todos',
  (e) => {
    const authRecord = e.auth || (e.get ? e.get('authRecord') : null)
    if (!authRecord) {
      return e.json(401, { error: 'Sua sessão expirou. Faça login novamente.' })
    }

    const nome = (
      (authRecord.getString ? authRecord.getString('name') : authRecord.get('name')) || ''
    )
      .toString()
      .toLowerCase()
      .trim()
    const email = (
      (authRecord.getString ? authRecord.getString('email') : authRecord.get('email')) || ''
    )
      .toString()
      .toLowerCase()
      .trim()
    const username = (
      (authRecord.getString ? authRecord.getString('username') : authRecord.get('username')) || ''
    )
      .toString()
      .toLowerCase()
      .trim()

    const isAdmin =
      nome === 'douglas' ||
      username === 'douglas' ||
      email === 'douglas@repress.com.br' ||
      email === 'douglas.manoel@repress.com.br'

    if (!isAdmin) {
      return e.json(403, { error: 'Acesso negado. Recurso restrito ao administrador.' })
    }

    let body = {}
    try {
      body =
        (e.requestInfo ? e.requestInfo().body : null) ||
        (e.requestInfo ? e.requestInfo().data : null) ||
        $apis.requestInfo(e).data ||
        {}
    } catch (_) {
      body = {}
    }

    const explicitJogoIds = Array.isArray(body.jogoIds) ? body.jogoIds.map(String) : []
    const explicitFixtureIds = Array.isArray(body.fixtureIds) ? body.fixtureIds.map(String) : []

    // 1. Identificar os jogos alvo
    let todosJogosCandidatos = []
    if (explicitJogoIds.length > 0) {
      for (let i = 0; i < explicitJogoIds.length; i++) {
        try {
          const jRec = $app.findRecordById('jogos', explicitJogoIds[i])
          if (jRec) todosJogosCandidatos.push(jRec)
        } catch (_) {}
      }
    } else {
      // Buscar jogos da data de hoje no horário de Brasília (UTC-3)
      const agoraSP = new Date(Date.now() - 3 * 3600 * 1000)
      const yyyy = agoraSP.getUTCFullYear()
      const mm = String(agoraSP.getUTCMonth() + 1).padStart(2, '0')
      const dd = String(agoraSP.getUTCDate()).padStart(2, '0')
      const hojeIso = `${yyyy}-${mm}-${dd}`
      const hojeBr = `${dd}/${mm}/${yyyy}`

      try {
        const found = $app.findRecordsByFilter(
          'jogos',
          `data = '${hojeIso}' || data = '${hojeBr}'`,
          'hora',
          100,
          0,
        )
        if (Array.isArray(found) && found.length > 0) {
          todosJogosCandidatos = found
        }
      } catch (_) {}
    }

    if (todosJogosCandidatos.length === 0) {
      return e.json(200, {
        success: true,
        message: 'Nenhum jogo de hoje encontrado para atualizar.',
        total_jogos: 0,
        atualizados: 0,
        jogos: [],
      })
    }

    // Administrador forçando sincronização de todos os jogos do dia (Pendente, Ao Vivo e Encerrado).
    // Não descartar jogos encerrados para permitir re-sincronizar marcadores, eventos, escalações e ficha técnica a qualquer momento.
    const jogosRecords = todosJogosCandidatos

    // Tentar resolver fixture_ids para jogos que ainda não possuem fixture_id
    // Consultando localmente jogos_do_dia ou matcher existente para não deixar jogos de fora silenciosamente
    const fixturesMatcherMod = (function () {
      try {
        if (typeof __hooks !== 'undefined') {
          return require(__hooks + '/fixtures_matcher.js')
        }
      } catch (_) {}
      try {
        return require('./fixtures_matcher.js')
      } catch (_) {
        return null
      }
    })()

    for (let i = 0; i < jogosRecords.length; i++) {
      const jRec = jogosRecords[i]
      let fid = (jRec.getString('fixture_id') || '').trim()
      if (!fid || !/^\d+$/.test(fid)) {
        // Tenta vincular pelo explicitFixtureIds caso haja correspondência na mesma ordem
        if (explicitFixtureIds[i] && /^\d+$/.test(explicitFixtureIds[i].trim())) {
          fid = explicitFixtureIds[i].trim()
          jRec.set('fixture_id', fid)
          try {
            $app.save(jRec)
          } catch (_) {}
        } else if (
          fixturesMatcherMod &&
          typeof fixturesMatcherMod.buscarFixtureDetalhadaNaApi === 'function'
        ) {
          try {
            const timeA = (jRec.getString('time_a') || '').trim()
            const timeB = (jRec.getString('time_b') || '').trim()
            const dataVal = (jRec.getString('data') || '').trim()
            const resolved = fixturesMatcherMod.buscarFixtureDetalhadaNaApi(timeA, timeB, dataVal)
            if (resolved && resolved.fixture_id) {
              fid = String(resolved.fixture_id).trim()
              jRec.set('fixture_id', fid)
              if (resolved.logo_mandante && !jRec.getString('url_escudo_mandante')) {
                jRec.set('url_escudo_mandante', resolved.logo_mandante)
              }
              if (resolved.logo_visitante && !jRec.getString('url_escudo_visitante')) {
                jRec.set('url_escudo_visitante', resolved.logo_visitante)
              }
              $app.save(jRec)
              console.log(
                `[atualizar-todos] fixture_id ${fid} vinculado automaticamente para ${timeA} x ${timeB}`,
              )
            }
          } catch (errResolve) {
            console.log('[atualizar-todos] Aviso ao tentar auto-resolver fixture_id:', errResolve)
          }
        }
      }
    }

    // Mapear fixture_ids dos jogos
    // Chave: fixture_id -> array de records (pode haver mais de um bolão com o mesmo jogo)
    const fixtureMap = {}
    const jogosSemFixture = []
    for (let i = 0; i < jogosRecords.length; i++) {
      const jRec = jogosRecords[i]
      const fid = (jRec.getString('fixture_id') || '').trim()
      if (fid && /^\d+$/.test(fid)) {
        if (!fixtureMap[fid]) fixtureMap[fid] = []
        fixtureMap[fid].push(jRec)
      } else {
        jogosSemFixture.push({
          id: jRec.id,
          time_a: jRec.getString('time_a'),
          time_b: jRec.getString('time_b'),
        })
      }
    }

    // Se foram passados explicitFixtureIds extras
    for (let i = 0; i < explicitFixtureIds.length; i++) {
      const fid = explicitFixtureIds[i].trim()
      if (fid && /^\d+$/.test(fid) && !fixtureMap[fid]) {
        for (let j = 0; j < jogosRecords.length; j++) {
          const rec = jogosRecords[j]
          if (!rec.getString('fixture_id')) {
            rec.set('fixture_id', fid)
            try {
              $app.save(rec)
            } catch (_) {}
            if (!fixtureMap[fid]) fixtureMap[fid] = []
            fixtureMap[fid].push(rec)
            break
          }
        }
      }
    }

    const uniqueFixtureIds = Object.keys(fixtureMap)
    if (uniqueFixtureIds.length === 0) {
      const nomesSemFixture = jogosSemFixture.map((j) => `${j.time_a} x ${j.time_b}`).join(', ')
      return e.json(200, {
        success: false,
        notice: `Nenhum dos jogos exibidos possui ID da partida (fixture_id) numérico vinculado. Jogos pendentes: ${nomesSemFixture || 'N/A'}.`,
        total_jogos: jogosRecords.length,
        jogos_sem_fixture: jogosSemFixture.length,
        lista_sem_fixture: jogosSemFixture,
        atualizados: 0,
        jogos: [],
      })
    }

    // 2. Centralizador de requisições com rotação e fallback automático (api_football_limiter.js)
    const limiterMod = (function () {
      try {
        if (typeof __hooks !== 'undefined') {
          return require(__hooks + '/api_football_limiter.js')
        }
      } catch (_) {}
      try {
        return require('./api_football_limiter.js')
      } catch (_) {
        return null
      }
    })()

    const fixtureResponses = []
    const rawApiLogs = []

    // REQUISIÇÃO DIRETA POR FIXTURE_ID:
    // Pega a lista de fixture_ids existentes na tabela de jogos e faz as chamadas à API-Sports
    // utilizando diretamente o parâmetro do ID da partida (/fixtures?id=...), garantindo a leitura
    // exata do confronto sem depender do filtro por data/liga ou divergência de fuso horário.
    const fixturesEncontrados = {}

    for (let fIdx = 0; fIdx < uniqueFixtureIds.length; fIdx++) {
      const singleId = uniqueFixtureIds[fIdx]
      const singleUrl = `https://v3.football.api-sports.io/fixtures?id=${encodeURIComponent(singleId)}`

      let singleCall = null
      if (limiterMod && typeof limiterMod.enviarRequisicaoApiFootball === 'function') {
        singleCall = limiterMod.enviarRequisicaoApiFootball(
          singleUrl,
          { timeout: 15, isAdminManual: true },
          2,
        )
      } else {
        const sendRes = $http.send({ url: singleUrl, method: 'GET', timeout: 15 })
        let j = null
        try {
          j =
            typeof sendRes.json === 'object' && sendRes.json !== null
              ? sendRes.json
              : JSON.parse(sendRes.raw)
        } catch (_) {}
        singleCall = {
          blocked: false,
          statusCode: sendRes ? sendRes.statusCode : 500,
          rawResponse: sendRes,
          json: j,
        }
      }

      rawApiLogs.push({
        url: singleUrl,
        fixture_ids: [singleId],
        statusCode: singleCall ? singleCall.statusCode : null,
        results:
          singleCall && singleCall.json && typeof singleCall.json.results === 'number'
            ? singleCall.json.results
            : 0,
        response_count:
          singleCall && singleCall.json && Array.isArray(singleCall.json.response)
            ? singleCall.json.response.length
            : 0,
        json_exact: singleCall ? singleCall.json : null,
        keyUsed: singleCall ? singleCall.keyUsed : null,
      })

      if (singleCall && singleCall.blocked && singleCall.auth_error) {
        return e.json(401, {
          success: false,
          auth_error: true,
          error: 'Erro de autenticação na API. Verifique se a API Key está ativa no painel.',
          notice: 'Erro de autenticação na API. Verifique se a API Key está ativa no painel.',
          debug_logs: rawApiLogs,
        })
      }

      if (singleCall && singleCall.blocked && singleCall.rate_limited) {
        return e.json(429, {
          success: false,
          error: 'Limite de requisições da API-Sports atingido nas chaves configuradas.',
          rate_limited: true,
          debug_logs: rawApiLogs,
        })
      }

      if (
        singleCall &&
        singleCall.statusCode === 200 &&
        singleCall.json &&
        Array.isArray(singleCall.json.response) &&
        singleCall.json.response.length > 0
      ) {
        fixtureResponses.push(singleCall.json.response[0])
        fixturesEncontrados[singleId] = true
      } else {
        // Se a chamada principal de fixtures não retornou o objeto consolidado ou veio vazia,
        // cria um placeholder estruturado para este singleId para permitir que a etapa seguinte
        // chame obrigatoriamente /fixtures/events?fixture={singleId} e capture os marcadores reais
        console.log(
          `[atualizar-todos] Fixture ${singleId} sem objeto principal em /fixtures; criando placeholder para consulta dedicada de eventos.`,
        )
        fixtureResponses.push({
          fixture: { id: parseInt(singleId, 10) || singleId, status: { short: '', long: '' } },
          teams: { home: {}, away: {} },
          goals: { home: null, away: null },
          score: {},
          events: [],
          lineups: [],
        })
      }
    }

    if (fixtureResponses.length === 0) {
      // Verifica se houve erro de autenticação real nos logs (HTTP 401 ou token inválido, excluindo erros de plano/parâmetro)
      const hadRealAuthError = rawApiLogs.some((l) => {
        if (l.statusCode === 401) return true
        const errors = l.json_exact && l.json_exact.errors ? l.json_exact.errors : null
        if (!errors) return false
        const errStr = JSON.stringify(errors).toLowerCase()
        if (errStr.includes('parameter') || errStr.includes('plan')) return false
        return (
          errStr.includes('invalid api key') ||
          errStr.includes('invalid key') ||
          errStr.includes('wrong api key') ||
          errStr.includes('wrong key') ||
          errStr.includes('account suspended') ||
          errStr.includes('key suspended') ||
          errStr.includes('key expired')
        )
      })

      if (hadRealAuthError) {
        return e.json(401, {
          success: false,
          auth_error: true,
          error: 'Erro de autenticação na API. Verifique se a API Key está ativa no painel.',
          notice: 'Erro de autenticação na API. Verifique se a API Key está ativa no painel.',
          total_jogos: jogosRecords.length,
          fixture_ids_enviados: uniqueFixtureIds,
          atualizados: 0,
          jogos: [],
          debug_logs: rawApiLogs,
        })
      }

      return e.json(200, {
        success: false,
        notice: 'A API-Sports não retornou dados para as partidas consultadas.',
        total_jogos: jogosRecords.length,
        fixture_ids_enviados: uniqueFixtureIds,
        atualizados: 0,
        jogos: [],
        debug_logs: rawApiLogs,
      })
    }

    // 5. Processamento e Persistência de Placares, Eventos e Ficha Técnica
    const updatedJogosList = []
    const boloesAfetados = {}
    let finishedFixturesCount = 0
    let fixturesWithGoalsCount = 0
    let liveUpdatedCount = 0

    for (let f = 0; f < fixtureResponses.length; f++) {
      const fixData = fixtureResponses[f]
      const fid = fixData.fixture?.id ? String(fixData.fixture.id) : null
      if (!fid || !fixtureMap[fid]) continue

      const matchingRecords = fixtureMap[fid]
      const goals = fixData.goals || {}
      const score = fixData.score || {}
      const statusInfo = fixData.fixture?.status || {}
      const statusShort = (statusInfo.short || '').toString().toUpperCase().trim()
      const statusLong = (statusInfo.long || '').toString().trim()

      let rawHome = goals.home !== null && goals.home !== undefined ? goals.home : null
      let rawAway = goals.away !== null && goals.away !== undefined ? goals.away : null
      if (
        rawHome === null &&
        score.fulltime &&
        score.fulltime.home !== null &&
        score.fulltime.home !== undefined
      ) {
        rawHome = score.fulltime.home
      }
      if (
        rawAway === null &&
        score.fulltime &&
        score.fulltime.away !== null &&
        score.fulltime.away !== undefined
      ) {
        rawAway = score.fulltime.away
      }

      const homeGoals =
        rawHome !== null && !isNaN(parseInt(rawHome, 10)) ? parseInt(rawHome, 10) : null
      const awayGoals =
        rawAway !== null && !isNaN(parseInt(rawAway, 10)) ? parseInt(rawAway, 10) : null

      if (homeGoals !== null && awayGoals !== null) {
        fixturesWithGoalsCount++
      }

      // VALIDAÇÃO ESTRITA DE STATUS DA API-SPORTS:
      // "Apenas atualize o status de um jogo para 'Ao Vivo' (1H, 2H, HT, etc.) se a API-Sports retornar
      // explicitamente que a partida está em andamento (status '1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE')."
      // "Se o status na API-Sports for 'NS' (Not Started) ou 'TBD', MANTENHA o jogo como 'Pendente' / 'Aberto',
      // e NÃO grave placar zerado (0 x 0) nem marque como 'Ao Vivo'."
      const isLive = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT'].includes(statusShort)
      const isFinished = ['FT', 'AET', 'PEN'].includes(statusShort)
      const isNotStarted = ['NS', 'TBD', ''].includes(statusShort)

      const homeTeamLogo = (fixData.teams?.home?.logo || '').toString().trim()
      const awayTeamLogo = (fixData.teams?.away?.logo || '').toString().trim()

      // BUSCA OBRIGATÓRIA DE EVENTOS E MARCADORES (/fixtures/events?fixture={fixture_id}):
      // Para cada fixture_id retornado, busca no endpoint /fixtures/events?fixture={fid}.
      // Se fixData já possuía events válidos, mas a busca dedicada for acionada ou se events vier vazio,
      // garantimos a leitura exata chamando o endpoint dedicado com fallback seguro.
      let dedicatedEventsRaw = []
      try {
        const urlEvents = `https://v3.football.api-sports.io/fixtures/events?fixture=${encodeURIComponent(fid)}`
        console.log(
          `[atualizar-todos] Buscando eventos dedicados (/fixtures/events) para fixture ${fid}...`,
        )
        let callEvents = null
        if (limiterMod && typeof limiterMod.enviarRequisicaoApiFootball === 'function') {
          callEvents = limiterMod.enviarRequisicaoApiFootball(
            urlEvents,
            { timeout: 15, isAdminManual: true },
            2,
          )
        } else {
          // Fallback com leitura dinâmica da chave ativa do banco
          let chvAtiva = ''
          try {
            const rPlac = $app.findFirstRecordByData(
              'config_integracoes',
              'chave',
              'placar_ao_vivo',
            )
            if (rPlac && rPlac.getBool('ativo'))
              chvAtiva = (rPlac.getString('api_key') || '').trim()
          } catch (_) {}
          if (!chvAtiva) {
            try {
              const rFoot = $app.findFirstRecordByData(
                'config_integracoes',
                'chave',
                'api_football',
              )
              if (rFoot && rFoot.getBool('ativo'))
                chvAtiva = (rFoot.getString('api_key') || '').trim()
            } catch (_) {}
          }
          const sRes = $http.send({
            url: urlEvents,
            method: 'GET',
            headers: { 'x-apisports-key': chvAtiva },
            timeout: 15,
          })
          let jData = null
          try {
            jData =
              typeof sRes.json === 'object' && sRes.json !== null ? sRes.json : JSON.parse(sRes.raw)
          } catch (_) {}
          callEvents = {
            statusCode: sRes ? sRes.statusCode : 500,
            rawResponse: sRes,
            json: jData,
          }
        }

        if (
          callEvents &&
          callEvents.statusCode === 200 &&
          callEvents.json &&
          Array.isArray(callEvents.json.response)
        ) {
          dedicatedEventsRaw = callEvents.json.response
          console.log(
            `[atualizar-todos] ${dedicatedEventsRaw.length} evento(s) retornados de /fixtures/events para fixture ${fid}`,
          )
        }
      } catch (errEvents) {
        console.log(
          `[atualizar-todos] Erro ao consultar /fixtures/events para fixture ${fid}:`,
          errEvents,
        )
      }

      // Eventos detalhados (Gols, Cartões, Substituições) - preferência para /fixtures/events dedicado quando retornado
      const rawEvents =
        Array.isArray(dedicatedEventsRaw) && dedicatedEventsRaw.length > 0
          ? dedicatedEventsRaw
          : Array.isArray(fixData.events)
            ? fixData.events
            : []
      const homeTeamId = fixData.teams?.home?.id ? String(fixData.teams.home.id) : null
      const awayTeamId = fixData.teams?.away?.id ? String(fixData.teams.away.id) : null
      const homeTeamName = (fixData.teams?.home?.name || '').toString().toLowerCase().trim()
      const awayTeamName = (fixData.teams?.away?.name || '').toString().toLowerCase().trim()

      const golsA = []
      const golsB = []
      const marcadoresGerais = []

      const normalizedEvents = rawEvents.map((ev) => {
        const typeStr = (ev.type || '').toString().toLowerCase()
        const detailStr = (ev.detail || '').toString().toLowerCase()

        let category = 'other'
        if (typeStr === 'goal') category = 'goal'
        else if (typeStr === 'card') category = 'card'
        else if (typeStr.includes('subst')) category = 'subst'

        return {
          time: {
            elapsed: ev.time?.elapsed ?? null,
            extra: ev.time?.extra ?? null,
          },
          team: {
            id: ev.team?.id ?? null,
            name: ev.team?.name ?? '',
            logo: ev.team?.logo ?? '',
          },
          player: {
            id: ev.player?.id ?? null,
            name: ev.player?.name ?? '',
          },
          assist: {
            id: ev.assist?.id ?? null,
            name: ev.assist?.name ?? null,
          },
          type: ev.type || '',
          detail: ev.detail || '',
          comments: ev.comments || null,
          category,
        }
      })

      // Gols e marcadores para as colunas estruturadas do Bolão
      for (let i = 0; i < rawEvents.length; i++) {
        const ev = rawEvents[i]
        if ((ev.type || '').toString().toLowerCase() === 'goal') {
          const detail = (ev.detail || '').toString().toLowerCase().trim()
          // Validez de gol: APENAS 'Normal Goal', 'Penalty' (convertido) e 'Own Goal'.
          // IGNORAR expressamente 'Missed Penalty'/'Penalty Missed' (pênalti perdido nunca vira marcador).
          if (
            detail.includes('missed') ||
            detail.includes('perdido') ||
            detail.includes('missed penalty') ||
            detail.includes('penalty missed')
          ) {
            continue
          }

          // Minuto como inteiro limpo
          let minuteInt = null
          if (ev.time && ev.time.elapsed != null) {
            const parsedM = parseInt(ev.time.elapsed, 10)
            if (!isNaN(parsedM)) minuteInt = parsedM
          }
          const minuteStr = minuteInt !== null ? `${minuteInt}'` : ''

          const isContra = detail.includes('own') || detail.includes('contra')
          const playerName = (ev.player?.name || '').toString().trim()
          const evTeamId = ev.team?.id ? String(ev.team.id) : null
          const evTeamName = (ev.team?.name || '').toString().toLowerCase().trim()

          if (playerName) {
            let posicao = 'Atacante/Meia'
            if (isContra) {
              posicao = 'Gol Contra'
            }

            const item = {
              nome: playerName,
              posicao: posicao,
              quantidade: 1,
              minuto: minuteStr,
            }

            // Associação de time mandante vs visitante:
            // 1. Por teamId se ambos tiverem
            // 2. Por similaridade de nome se teamId for nulo (ex: placeholder)
            // 3. Fallback inteligente usando o primeiro jogo vinculado
            let pertenceA = false
            let pertenceB = false

            if (homeTeamId && awayTeamId && evTeamId) {
              pertenceA = evTeamId === homeTeamId
              pertenceB = evTeamId === awayTeamId
            } else if (evTeamId && matchingRecords.length > 0) {
              const primeJ = matchingRecords[0]
              const cleanAId = (primeJ.getString('url_escudo_mandante') || '').match(
                /\/teams\/(\d+)\./,
              )
              const cleanBId = (primeJ.getString('url_escudo_visitante') || '').match(
                /\/teams\/(\d+)\./,
              )
              const idMandante = cleanAId ? cleanAId[1] : null
              const idVisitante = cleanBId ? cleanBId[1] : null
              if (idMandante && evTeamId === idMandante) {
                pertenceA = true
              } else if (idVisitante && evTeamId === idVisitante) {
                pertenceB = true
              }
            }

            if (!pertenceA && !pertenceB && evTeamName) {
              if (
                homeTeamName &&
                (homeTeamName.includes(evTeamName) || evTeamName.includes(homeTeamName))
              ) {
                pertenceA = true
              } else if (
                awayTeamName &&
                (awayTeamName.includes(evTeamName) || evTeamName.includes(awayTeamName))
              ) {
                pertenceB = true
              } else if (matchingRecords.length > 0) {
                const primeJ = matchingRecords[0]
                const tA = (primeJ.getString('time_a') || '').toLowerCase()
                const tB = (primeJ.getString('time_b') || '').toLowerCase()
                if (tA && (tA.includes(evTeamName) || evTeamName.includes(tA))) {
                  pertenceA = true
                } else if (tB && (tB.includes(evTeamName) || evTeamName.includes(tB))) {
                  pertenceB = true
                }
              }
            } else if (matchingRecords.length > 0 && evTeamId) {
              // Se teams.home não tinha ID preenchido na fixtureResponses, mas evTeamId existe
              // tenta comparar com url_escudo_mandante ou id anterior
              pertenceA = true
            }

            if (pertenceA) {
              golsA.push(item)
            } else if (pertenceB) {
              golsB.push(item)
            } else {
              // Se não foi possível diferenciar os lados, divide ou inclui como neutro
              golsA.push(item)
            }

            marcadoresGerais.push(minuteStr ? `${playerName} ${minuteStr}` : playerName)
          }
        }
      }

      // Busca ou processamento de Escalações (lineups):
      // Se a resposta consolidada de fixtures já trouxer lineups, usa diretamente;
      // Caso contrário, se a partida estiver em andamento (isLive) ou finalizada (isFinished),
      // consulta o endpoint /fixtures/lineups?fixture={fid} via limiter central com chave/fallback.
      let parsedEscalacoesPayload = null
      let apiLineupsRaw = Array.isArray(fixData.lineups) ? fixData.lineups : []

      if (apiLineupsRaw.length === 0 && (isLive || isFinished)) {
        try {
          const urlLineups = `https://v3.football.api-sports.io/fixtures/lineups?fixture=${encodeURIComponent(fid)}`
          console.log(`[atualizar-todos] Buscando lineups para fixture ${fid}...`)
          const callLineup =
            limiterMod && typeof limiterMod.enviarRequisicaoApiFootball === 'function'
              ? limiterMod.enviarRequisicaoApiFootball(
                  urlLineups,
                  { timeout: 15, isAdminManual: true },
                  2,
                )
              : null

          if (
            callLineup &&
            callLineup.statusCode === 200 &&
            callLineup.json &&
            Array.isArray(callLineup.json.response) &&
            callLineup.json.response.length > 0
          ) {
            apiLineupsRaw = callLineup.json.response
          }
        } catch (errLineups) {
          console.log(`[atualizar-todos] Erro ao buscar lineups para fixture ${fid}:`, errLineups)
        }
      }

      if (apiLineupsRaw.length > 0) {
        const teamsData = []
        for (let li = 0; li < apiLineupsRaw.length; li++) {
          const teamBlock = apiLineupsRaw[li]
          const teamInfo = teamBlock.team || {}
          const starters = []
          if (Array.isArray(teamBlock.startXI)) {
            for (let s = 0; s < teamBlock.startXI.length; s++) {
              const p = teamBlock.startXI[s].player || {}
              starters.push({
                id: p.id ? String(p.id) : '',
                name: p.name || '',
                number: p.number || null,
                pos: p.pos || '',
                grid: p.grid || null,
              })
            }
          }
          const bench = []
          if (Array.isArray(teamBlock.substitutes)) {
            for (let b = 0; b < teamBlock.substitutes.length; b++) {
              const bp = teamBlock.substitutes[b].player || {}
              bench.push({
                id: bp.id ? String(bp.id) : '',
                name: bp.name || '',
                number: bp.number || null,
                pos: bp.pos || '',
              })
            }
          }

          let tLogo = teamInfo.logo || ''
          const tName = teamInfo.name || ''
          if (tName.toLowerCase().indexOf('paris') !== -1 || tName.toLowerCase() === 'psg') {
            tLogo = 'https://media.api-sports.io/football/teams/85.png'
          }

          teamsData.push({
            teamId: teamInfo.id ? String(teamInfo.id) : '',
            teamName: tName,
            teamLogo: tLogo,
            formation: teamBlock.formation || '',
            coach: teamBlock.coach ? teamBlock.coach.name : '',
            starters: starters,
            substitutes: bench,
          })
        }

        const hasRealLineupPlayers = teamsData.some(
          (t) =>
            (t.starters && t.starters.length > 0) || (t.substitutes && t.substitutes.length > 0),
        )

        if (teamsData.length > 0 && hasRealLineupPlayers) {
          parsedEscalacoesPayload = {
            status: 'confirmada',
            provider: 'api_football',
            fixtureId: fid,
            teams: teamsData,
            updatedAt: new Date().toISOString(),
          }
        }
      }

      // Snapshot unificado da Ficha Técnica para o campo ficha_detalhes
      const fichaDetalhesPayload = {
        success: true,
        cached: false,
        source: 'api_football_batch',
        fixture_id: fid,
        teams: fixData.teams || {},
        goals: fixData.goals || {},
        fixture_status: fixData.fixture?.status || {},
        events: normalizedEvents,
        lineups: apiLineupsRaw,
        updatedAt: new Date().toISOString(),
      }

      // Persiste cache no servidor PB ($app.store()) para consulta instantânea por /backend/v1/eventos-jogo
      try {
        $app.store().set('events_fixture_' + fid, JSON.stringify(fichaDetalhesPayload))
      } catch (_) {}

      if (parsedEscalacoesPayload) {
        try {
          $app.store().set('lineup_' + fid, JSON.stringify(parsedEscalacoesPayload))
        } catch (_) {}
      }

      // Atualiza cada jogo vinculado a este fixture_id
      for (let j = 0; j < matchingRecords.length; j++) {
        const jRec = matchingRecords[j]

        // Kickoff check
        const dataStr = (jRec.getString('data') || '').trim()
        const horaStr = (jRec.getString('hora') || '').trim()
        let kickoffMs = 0
        try {
          const horaParts = horaStr.split(':')
          const hh = (horaParts[0] || '16').padStart(2, '0')
          const mm = (horaParts[1] || '00').padStart(2, '0')
          const ss = (horaParts[2] || '00').padStart(2, '0')
          const isoStr = dataStr + 'T' + hh + ':' + mm + ':' + ss + '-03:00'
          const parsedKickoff = new Date(isoStr).getTime()
          if (!isNaN(parsedKickoff)) kickoffMs = parsedKickoff
        } catch (_) {}

        const kickoffJaChegou = kickoffMs > 0 ? Date.now() >= kickoffMs : true

        if (homeGoals !== null && !isNaN(homeGoals)) {
          jRec.set('placar_a', homeGoals)
        }
        if (awayGoals !== null && !isNaN(awayGoals)) {
          jRec.set('placar_b', awayGoals)
        }
        if (homeTeamLogo) jRec.set('url_escudo_mandante', homeTeamLogo)
        if (awayTeamLogo) jRec.set('url_escudo_visitante', awayTeamLogo)

        // Gravação condicional de placar:
        // Apenas grava placar se a partida estiver encerrada (FT/AET/PEN) ou em andamento explícito (isLive).
        // Se for NS/TBD, NÃO grava placar zerado (0x0). Se já havia sido marcado indevidamente como ao_vivo/0x0, restaura para pendente.
        if (isFinished || isLive) {
          if (homeGoals !== null && !isNaN(homeGoals)) {
            jRec.set('placar_a', homeGoals)
          }
          if (awayGoals !== null && !isNaN(awayGoals)) {
            jRec.set('placar_b', awayGoals)
          }
        } else if (isNotStarted) {
          // Partida ainda não começou na API-Sports (NS ou TBD).
          // Se o jogo estava indevidamente como ao_vivo, reverte para pendente
          const currentStatusJRec = (jRec.getString('status') || '').toLowerCase().trim()
          if (currentStatusJRec === 'ao_vivo') {
            jRec.set('status', 'pendente')
          }
        }

        if (homeTeamLogo) jRec.set('url_escudo_mandante', homeTeamLogo)
        if (awayTeamLogo) jRec.set('url_escudo_visitante', awayTeamLogo)

        // Atualização estrita de status:
        // Apenas 'finalizado' se FT/AET/PEN ou se status já for finalizado/encerrado
        // Apenas 'ao_vivo' se explicitamente '1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT' E kickoff já chegou
        // Se NS/TBD, NUNCA marca como ao_vivo
        const currentStatusJRec = (jRec.getString('status') || '').toLowerCase().trim()
        const isStatusJRecFinalizado = ['finalizado', 'encerrado', 'ft', 'finished'].includes(
          currentStatusJRec,
        )

        let isAgoraAoVivo = false
        if (isFinished || isStatusJRecFinalizado) {
          jRec.set('status', 'finalizado')
          jRec.set('resultado_finalizado', true)
        } else if (isLive && kickoffJaChegou) {
          jRec.set('status', 'ao_vivo')
          jRec.set('resultado_finalizado', false)
          isAgoraAoVivo = true
        } else if (isNotStarted) {
          jRec.set('resultado_finalizado', false)
        }

        // Salva e exibe marcadores/gols nos campos da partida
        // Preenche gols_time_a, gols_time_b e marcadores (formato compatível com splitMatchScorersByTeam)
        if (golsA.length > 0) {
          jRec.set('gols_time_a', golsA)
        } else if (homeGoals === 0 && (isFinished || isLive)) {
          jRec.set('gols_time_a', [])
        }

        if (golsB.length > 0) {
          jRec.set('gols_time_b', golsB)
        } else if (awayGoals === 0 && (isFinished || isLive)) {
          jRec.set('gols_time_b', [])
        }

        if (marcadoresGerais.length > 0) {
          jRec.set('marcadores', marcadoresGerais)
        } else if (homeGoals === 0 && awayGoals === 0 && (isFinished || isLive)) {
          jRec.set('marcadores', [])
        }

        // Gravação de Escalações com preservação:
        // Se a API retornou escalações válidas com jogadores reais, persiste no jogo.
        // Se a API não retornou nada, preserva a escalação existente sem sobrescrever com vazio.
        if (parsedEscalacoesPayload) {
          jRec.set('escalacoes', parsedEscalacoesPayload)
        }

        // Grava a ficha completa de detalhes (timeline de eventos e lineups)
        // PRESERVAÇÃO: se a API não trouxer eventos nem status ativo/finalizado e o jogo já tiver ficha gravada com eventos, não sobrescreve com vazio
        const prevFichaRaw = jRec.get('ficha_detalhes')
        const hasPrevEvents =
          prevFichaRaw && Array.isArray(prevFichaRaw.events) && prevFichaRaw.events.length > 0
        if (normalizedEvents.length > 0 || !hasPrevEvents || isLive || isFinished) {
          jRec.set('ficha_detalhes', fichaDetalhesPayload)
        }

        try {
          $app.save(jRec)
          const bId = jRec.getString('bolao')
          if (bId) boloesAfetados[bId] = true

          // Leitura de confirmação pós-gravação diretamente do banco de dados
          let savedRec = null
          try {
            savedRec = $app.findRecordById('jogos', jRec.id)
          } catch (_) {
            savedRec = jRec
          }

          const hasScorePersisted =
            savedRec.get('placar_a') !== null && savedRec.get('placar_b') !== null
          const isEncerrado =
            savedRec.getString('status') === 'finalizado' ||
            savedRec.getBool('resultado_finalizado')
          const isAoVivoStatus = savedRec.getString('status') === 'ao_vivo'

          if (isAoVivoStatus) {
            liveUpdatedCount++
          }

          updatedJogosList.push({
            id: savedRec.id,
            bolao: bId,
            time_a: savedRec.getString('time_a'),
            time_b: savedRec.getString('time_b'),
            placar_a: savedRec.get('placar_a'),
            placar_b: savedRec.get('placar_b'),
            status: savedRec.getString('status'),
            resultado_finalizado: savedRec.getBool('resultado_finalizado'),
            tem_placar: hasScorePersisted,
            ao_vivo: isAoVivoStatus,
            mudou_para_encerrado: isEncerrado,
            fixture_id: fid,
            gols_time_a: savedRec.get('gols_time_a'),
            gols_time_b: savedRec.get('gols_time_b'),
            marcadores: savedRec.get('marcadores'),
            escalacoes: savedRec.get('escalacoes'),
            ficha_detalhes: fichaDetalhesPayload,
          })
        } catch (errSave) {
          console.log('[atualizar-todos] Erro ao salvar jogo:', errSave)
        }

        // Se houver registros em jogos_do_dia com o mesmo fixture_id, sincroniza lá também
        try {
          const jdds = $app.findRecordsByFilter(
            'jogos_do_dia',
            `fixture_id = '${fid}'`,
            '-created',
            5,
            0,
          )
          for (let jd = 0; jd < jdds.length; jd++) {
            const jdd = jdds[jd]
            if (homeGoals !== null) jdd.set('placar_casa', homeGoals)
            if (awayGoals !== null) jdd.set('placar_visitante', awayGoals)
            if (homeTeamLogo && !jdd.getString('logo_casa')) jdd.set('logo_casa', homeTeamLogo)
            if (awayTeamLogo && !jdd.getString('logo_visitante'))
              jdd.set('logo_visitante', awayTeamLogo)
            jdd.set('events', normalizedEvents)
            if (isFinished) jdd.set('status', 'FT')
            $app.save(jdd)
          }
        } catch (_) {}
      }
    }

    // 6. Recalcular pontuações e ranking para todos os bolões afetados
    try {
      const boloesIds = Object.keys(boloesAfetados)
      const stripAccents = (str) => {
        if (!str) return ''
        let s = String(str)
        if (typeof s.normalize === 'function') {
          try {
            s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          } catch (_) {}
        }
        return s
          .replace(/[áàâãä]/gi, 'a')
          .replace(/[éèêë]/gi, 'e')
          .replace(/[íìîï]/gi, 'i')
          .replace(/[óòôõö]/gi, 'o')
          .replace(/[úùûü]/gi, 'u')
          .replace(/[ç]/gi, 'c')
          .replace(/[ñ]/gi, 'n')
      }

      const parseJsonField = (rec, fieldName) => {
        try {
          const raw = rec.get(fieldName)
          if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'number') {
            const str = String.fromCharCode.apply(null, raw)
            const parsed = JSON.parse(str)
            if (Array.isArray(parsed)) return parsed
          }
          if (Array.isArray(raw)) return raw
          const strVal = rec.getString(fieldName)
          if (strVal && strVal.trim()) {
            const parsed = JSON.parse(strVal)
            if (Array.isArray(parsed)) return parsed
          }
        } catch (_) {}
        try {
          const strVal = rec.getString(fieldName)
          if (strVal && strVal.trim()) {
            return strVal
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          }
        } catch (_) {}
        return []
      }

      const getWinner = (a, b) => {
        if (a > b) return 1
        if (b > a) return -1
        return 0
      }

      for (let bi = 0; bi < boloesIds.length; bi++) {
        const bolaoId = boloesIds[bi]

        let normMap = {}
        try {
          const normalizacoes = $app.findRecordsByFilter(
            'normalizacoes',
            "bolao = '" + bolaoId + "'",
            '',
            500,
            0,
          )
          for (let ni = 0; ni < normalizacoes.length; ni++) {
            const n = normalizacoes[ni]
            const orig = stripAccents(n.getString('nome_original') || '')
              .toLowerCase()
              .trim()
            const corr = stripAccents(n.getString('nome_correto') || '')
              .toLowerCase()
              .trim()
            if (orig && corr) normMap[orig] = corr
          }
        } catch (_) {}

        const normalizePlayerName = (name) => {
          if (!name) return ''
          let clean = stripAccents(String(name).toLowerCase().trim())
          if (normMap[clean]) clean = stripAccents(normMap[clean])
          return clean
        }

        // Jogos atualizados deste bolão
        const gamesOfBolao = updatedJogosList.filter((j) => j.bolao === bolaoId)

        for (let gi = 0; gi < gamesOfBolao.length; gi++) {
          const gInfo = gamesOfBolao[gi]
          const jRec = $app.findRecordById('jogos', gInfo.id)
          if (!jRec) continue

          const kickoffMs = 0
          const statusAtualJogo = (jRec.getString('status') || '').toLowerCase().trim()
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
          const statusIniciado = STATUS_INICIADOS.indexOf(statusAtualJogo) >= 0
          const jogoIniciou = statusIniciado || jRec.getBool('resultado_finalizado')

          const placarRealA = jRec.getInt('placar_a')
          const placarRealB = jRec.getInt('placar_b')
          const temPenaltis = jRec.getBool('tem_penaltis')
          const vencedorPenaltisReal = (jRec.getString('vencedor_penaltis') || '')
            .toUpperCase()
            .trim()

          const golsTimeA = parseJsonField(jRec, 'gols_time_a')
          const golsTimeB = parseJsonField(jRec, 'gols_time_b')

          const realWinner = getWinner(placarRealA, placarRealB)
          const realDiff = Math.abs(placarRealA - placarRealB)

          const realScorersMap = {}
          const processScorer = (item) => {
            if (!item || !item.nome) return
            const rawNome = String(item.nome).trim()
            const cleanNome = rawNome
              .replace(/\s*\d+\s*['’]/g, '')
              .replace(/\(gol contra\)|\(contra\)/gi, '')
              .trim()
            const norm = normalizePlayerName(cleanNome)
            if (!norm) return

            const count = parseInt(item.quantidade, 10) || 1
            const pos = (item.posicao || 'Atacante/Meia').toLowerCase().trim()
            let pts = 1
            if (
              pos.indexOf('zagueiro') >= 0 ||
              pos.indexOf('lateral') >= 0 ||
              pos.indexOf('defensor') >= 0
            ) {
              pts = 3
            } else if (pos.indexOf('goleiro') >= 0) {
              pts = 10
            } else if (pos.indexOf('contra') >= 0) {
              pts = 5
            }

            const posLabel =
              item.posicao ||
              (pts === 3
                ? 'Defensor'
                : pts === 10
                  ? 'Goleiro'
                  : pts === 5
                    ? 'Gol Contra'
                    : 'Atacante')
            const mins = []
            const minRegex = /(\d+)\s*['’]/g
            let mMatch
            while ((mMatch = minRegex.exec(rawNome)) !== null) {
              const num = parseInt(mMatch[1], 10)
              if (!isNaN(num)) mins.push(num)
            }

            if (realScorersMap[norm]) {
              realScorersMap[norm].countReal += count
              if (mins.length > 0)
                realScorersMap[norm].minutes = realScorersMap[norm].minutes.concat(mins)
            } else {
              realScorersMap[norm] = {
                displayName: cleanNome,
                norm: norm,
                points: pts,
                position: posLabel,
                countReal: count,
                minutes: mins,
              }
            }
          }

          for (let a = 0; a < golsTimeA.length; a++) processScorer(golsTimeA[a])
          for (let b = 0; b < golsTimeB.length; b++) processScorer(golsTimeB[b])

          const palpitesDoJogo = $app.findRecordsByFilter(
            'palpites',
            "jogo = '" + gInfo.id + "'",
            '',
            100,
            0,
          )
          for (let pi = 0; pi < palpitesDoJogo.length; pi++) {
            const palpite = palpitesDoJogo[pi]
            let pontos = 0
            const detalhamento = []

            if (!jogoIniciou) {
              palpite.set('pontuacao_jogo', 0)
              palpite.set('detalhamento', ['Aguardando início'])
              $app.save(palpite)
              continue
            }

            const palpiteA = palpite.getInt('placar_a')
            const palpiteB = palpite.getInt('placar_b')
            const predWinner = getWinner(palpiteA, palpiteB)
            const predDiff = Math.abs(palpiteA - palpiteB)
            const isExact = palpiteA === placarRealA && palpiteB === placarRealB

            if (isExact) {
              pontos += 8
              detalhamento.push('Placar Exato (+8 pts)')
            } else {
              if (predWinner === realWinner) {
                if (realWinner === 0) {
                  pontos += 2
                  detalhamento.push('Empate (+2 pts)')
                } else {
                  pontos += 2
                  detalhamento.push('Vencedor (+2 pts)')
                }
              }

              if (predDiff === realDiff && predWinner === realWinner) {
                pontos += 1
                detalhamento.push('Diferença de Gols (+1 pt)')
              }

              if (palpiteA === placarRealA || palpiteB === placarRealB) {
                pontos += 1
                detalhamento.push('Metade do Placar (+1 pt)')
              }
            }

            const predScorersA = parseJsonField(palpite, 'goleadores_a')
            const predScorersB = parseJsonField(palpite, 'goleadores_b')

            const predInfo = {}
            const addPredScorer = (p) => {
              if (!p) return
              const pStr = typeof p === 'string' ? p : String(p.nome || '')
              const cleanP = pStr
                .replace(/\s*\d+\s*['’]/g, '')
                .replace(/\(gol contra\)|\(contra\)/gi, '')
                .trim()
              const normP = normalizePlayerName(cleanP)
              if (!normP) return

              const pPos = typeof p === 'object' && p !== null ? p.posicao : undefined
              const pContra =
                (typeof p === 'object' && p !== null && p.gol_contra === true) ||
                /\(gol contra\)|\(contra\)/i.test(pStr) ||
                String(pPos || '')
                  .toLowerCase()
                  .indexOf('contra') >= 0

              if (predInfo[normP]) {
                predInfo[normP].count += 1
                if (!predInfo[normP].posicao && pPos) predInfo[normP].posicao = pPos
                if (pContra) predInfo[normP].golContra = true
              } else {
                predInfo[normP] = { count: 1, posicao: pPos, golContra: pContra }
              }
            }

            for (let sa = 0; sa < predScorersA.length; sa++) addPredScorer(predScorersA[sa])
            for (let sb = 0; sb < predScorersB.length; sb++) addPredScorer(predScorersB[sb])

            const matchedScorers = []
            for (const normPred in predInfo) {
              const itemInfo = predInfo[normPred]
              const countPalpite = itemInfo.count
              let matchedReal = realScorersMap[normPred]
              if (!matchedReal) {
                for (const rNorm in realScorersMap) {
                  if (rNorm.indexOf(normPred) >= 0 || normPred.indexOf(rNorm) >= 0) {
                    matchedReal = realScorersMap[rNorm]
                    break
                  }
                }
              }

              if (matchedReal && matchedReal.countReal > 0) {
                const g = Math.min(matchedReal.countReal, countPalpite)
                if (g > 0) {
                  const targetPosStr = String(itemInfo.posicao || matchedReal.position || '')
                    .toLowerCase()
                    .trim()
                  let unitPoints = matchedReal.points
                  let displayPos = matchedReal.position

                  if (itemInfo.golContra || targetPosStr.indexOf('contra') >= 0) {
                    unitPoints = 5
                    displayPos = 'Gol Contra'
                  } else if (
                    targetPosStr.indexOf('defensor') >= 0 ||
                    targetPosStr.indexOf('zagueiro') >= 0 ||
                    targetPosStr.indexOf('lateral') >= 0 ||
                    targetPosStr === 'd'
                  ) {
                    unitPoints = 3
                    displayPos = 'Defensor'
                  } else if (targetPosStr.indexOf('goleiro') >= 0 || targetPosStr === 'g') {
                    unitPoints = 10
                    displayPos = 'Goleiro'
                  } else if (
                    targetPosStr.indexOf('atacante') >= 0 ||
                    targetPosStr.indexOf('meia') >= 0 ||
                    targetPosStr.indexOf('meio') >= 0 ||
                    targetPosStr === 'a'
                  ) {
                    unitPoints = 1
                    displayPos = 'Atacante'
                  }

                  const ptsTotal = g * unitPoints
                  pontos += ptsTotal
                  matchedScorers.push(
                    matchedReal.displayName + ' [' + displayPos + '] (+' + ptsTotal + ' pts)',
                  )
                }
              }
            }

            if (matchedScorers.length > 0) {
              detalhamento.push('Gols acertados: ' + matchedScorers.join(', '))
            }

            if (temPenaltis) {
              const predPenaltis = (palpite.getString('vencedor_penaltis') || '')
                .toUpperCase()
                .trim()
              if (
                predPenaltis &&
                predPenaltis === vencedorPenaltisReal &&
                (predPenaltis === 'A' || predPenaltis === 'B')
              ) {
                pontos += 2
                detalhamento.push('Vencedor nos Pênaltis (+2 pts)')
              }
            }

            palpite.set('pontuacao_jogo', pontos)
            palpite.set('detalhamento', detalhamento)
            $app.save(palpite)
          }
        }

        // Reacumula pontuação dos participantes do bolão
        const participantes = $app.findRecordsByFilter(
          'participantes',
          "bolao = '" + bolaoId + "'",
          '',
          200,
          0,
        )
        for (let pi = 0; pi < participantes.length; pi++) {
          const part = participantes[pi]
          const partPalpites = $app.findRecordsByFilter(
            'palpites',
            "bolao = '" + bolaoId + "' && participante = '" + part.id + "'",
            '',
            500,
            0,
          )
          let totalPoints = 0
          for (let ppi = 0; ppi < partPalpites.length; ppi++) {
            const p = partPalpites[ppi]
            try {
              const gameRec = $app.findRecordById('jogos', p.getString('jogo'))
              if (gameRec && gameRec.getBool('resultado_finalizado')) {
                totalPoints += p.getInt('pontuacao_jogo')
              }
            } catch (_) {}
          }
          const importedPts = part.getInt('pontos_importados') || 0
          part.set('pontuacao_total', importedPts + totalPoints)
          $app.save(part)
        }

        try {
          const bolao = $app.findRecordById('boloes', bolaoId)
          bolao.set('ultima_atualizacao', new Date().toISOString())
          $app.save(bolao)
        } catch (_) {}
      }
    } catch (errRecalc) {
      console.log('[atualizar-todos] Erro no recálculo em lote:', errRecalc)
    }

    const totalComPlacarGravado = updatedJogosList.filter((j) => j.tem_placar).length
    const totalSemPlacarGravado = updatedJogosList.filter((j) => !j.tem_placar).length
    const totalEncerrados = updatedJogosList.filter((j) => j.mudou_para_encerrado).length
    const totalAoVivo = updatedJogosList.filter((j) => j.ao_vivo).length
    const totalComMarcadores = updatedJogosList.filter((j) => {
      const gA = Array.isArray(j.gols_time_a) ? j.gols_time_a.length : 0
      const gB = Array.isArray(j.gols_time_b) ? j.gols_time_b.length : 0
      const mg = Array.isArray(j.marcadores) ? j.marcadores.length : 0
      return gA > 0 || gB > 0 || mg > 0
    }).length

    let messageNotice = null
    let messageSucesso = ''

    const fixturesNaoLocalizadosNaApi = uniqueFixtureIds.filter((id) => !fixturesEncontrados[id])

    if (totalComPlacarGravado === 0 && totalAoVivo === 0 && totalEncerrados === 0) {
      messageNotice = 'Os jogos selecionados ainda não possuem placar retornado pela API-Sports.'
      messageSucesso = `Consulta concluída: 0 jogos com placar/eventos sincronizados, ${totalSemPlacarGravado} sem dados de placar disponível na API.`
    } else {
      const partsMsg = []
      if (totalEncerrados > 0) {
        partsMsg.push(`${totalEncerrados} encerrado(s) sincronizado(s)`)
      }
      if (totalAoVivo > 0) {
        partsMsg.push(`${totalAoVivo} ao vivo / parcial(is)`)
      }
      if (totalComPlacarGravado > 0 && totalAoVivo === 0 && totalEncerrados === 0) {
        partsMsg.push(`${totalComPlacarGravado} com placar gravado`)
      }
      if (totalComMarcadores > 0) {
        partsMsg.push(`${totalComMarcadores} com marcadores gravados`)
      }
      if (totalSemPlacarGravado > 0) {
        partsMsg.push(`${totalSemPlacarGravado} sem dados na API`)
      }
      if (jogosSemFixture.length > 0) {
        partsMsg.push(`${jogosSemFixture.length} sem fixture_id`)
      }
      if (
        fixturesNaoLocalizadosNaApi.length > 0 &&
        !partsMsg.some((p) => p.includes('sem dados'))
      ) {
        partsMsg.push(`${fixturesNaoLocalizadosNaApi.length} fixture(s) não localizados na API`)
      }
      messageSucesso = `Sincronização concluída com sucesso: ${partsMsg.join(', ')}.`
    }

    return e.json(200, {
      success: true,
      message: messageSucesso,
      notice: messageNotice,
      resumo: {
        total_jogos: jogosRecords.length,
        com_placar: totalComPlacarGravado,
        ao_vivo: totalAoVivo,
        sem_placar: totalSemPlacarGravado,
        encerrados: totalEncerrados,
        com_marcadores: totalComMarcadores,
        sem_fixture: jogosSemFixture.length,
        jogos_sem_dados_api: fixturesNaoLocalizadosNaApi.length,
      },
      total_jogos: jogosRecords.length,
      atualizados: updatedJogosList.length,
      jogos_com_placar_gravado: totalComPlacarGravado,
      jogos_ao_vivo: totalAoVivo,
      jogos_sem_placar_null: totalSemPlacarGravado,
      jogos_encerrados: totalEncerrados,
      jogos_com_marcadores: totalComMarcadores,
      jogos_sem_fixture: jogosSemFixture.length,
      lista_sem_fixture: jogosSemFixture,
      fixtures_finalizados: totalEncerrados,
      fixtures_com_gols: totalComPlacarGravado,
      fixture_ids_enviados: uniqueFixtureIds,
      fixtures_sem_dados_api: fixturesNaoLocalizadosNaApi,
      jogos: updatedJogosList,
      debug_logs: rawApiLogs,
    })
  },
  $apis.requireAuth(),
)
