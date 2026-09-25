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
    let jogosRecords = []
    if (explicitJogoIds.length > 0) {
      for (let i = 0; i < explicitJogoIds.length; i++) {
        try {
          const jRec = $app.findRecordById('jogos', explicitJogoIds[i])
          if (jRec) jogosRecords.push(jRec)
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
          jogosRecords = found
        }
      } catch (_) {}
    }

    if (jogosRecords.length === 0) {
      return e.json(200, {
        success: true,
        message: 'Nenhum jogo de hoje encontrado para atualizar.',
        total_jogos: 0,
        atualizados: 0,
        jogos: [],
      })
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
        jogosSemFixture.push(jRec.id)
      }
    }

    // Se foram passados explicitFixtureIds mas o jogo ainda não tinha salvo
    for (let i = 0; i < explicitFixtureIds.length; i++) {
      const fid = explicitFixtureIds[i].trim()
      if (fid && /^\d+$/.test(fid) && !fixtureMap[fid]) {
        // Tenta achar na lista
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
      return e.json(200, {
        success: false,
        notice: 'Nenhum dos jogos exibidos possui ID da partida (fixture_id) numérico vinculado.',
        total_jogos: jogosRecords.length,
        jogos_sem_fixture: jogosSemFixture.length,
        atualizados: 0,
        jogos: [],
      })
    }

    // 2. Checagem do limitador de cota diária (API-Football)
    const dNow = new Date()
    const hojeUtc = `${dNow.getUTCFullYear()}-${String(dNow.getUTCMonth() + 1).padStart(2, '0')}-${String(dNow.getUTCDate()).padStart(2, '0')}`
    const USAGE_RECORD_CHAVE = 'api_football_daily_usage'
    const DAILY_LIMIT = 80

    let recUsage = null
    let usageData = {
      date_utc: hojeUtc,
      count: 0,
      max_limit: DAILY_LIMIT,
      trava_desativada: false,
      blocked: false,
      last_reset_utc: new Date().toISOString(),
      last_request_utc: null,
    }

    try {
      recUsage = $app.findFirstRecordByFilter(
        'config_integracoes',
        `chave = '${USAGE_RECORD_CHAVE}'`,
      )
      if (recUsage && recUsage.get('api_key')) {
        const parsed = JSON.parse(recUsage.get('api_key'))
        if (parsed && typeof parsed === 'object') {
          usageData = Object.assign(usageData, parsed)
        }
      }
    } catch (_) {
      recUsage = null
    }

    // Reset diário às 00:00 UTC
    if (usageData.date_utc !== hojeUtc) {
      usageData.date_utc = hojeUtc
      usageData.count = 0
      usageData.blocked = false
      if (!usageData.max_limit || Number(usageData.max_limit) < DAILY_LIMIT) {
        usageData.max_limit = DAILY_LIMIT
      }
      usageData.last_reset_utc = new Date().toISOString()
      if (recUsage) {
        recUsage.set('api_key', JSON.stringify(usageData))
        $app.save(recUsage)
      }
    }

    const currentCount = Number(usageData.count) || 0
    const maxLimit = Number(usageData.max_limit) || DAILY_LIMIT
    const travaDesativada = Boolean(usageData.trava_desativada)

    if (!travaDesativada && (usageData.blocked || currentCount >= maxLimit)) {
      return e.json(429, {
        error:
          'Limite diário de requisições da API-Sports atingido (80/dia). A cota é reiniciada às 21h (horário de Brasília). Placares locais preservados.',
        rate_limited: true,
        count: currentCount,
        max_limit: maxLimit,
      })
    }

    // 3. Obtenção da API Key da API-Football
    let apiKey = ''
    try {
      const recPlacar = $app.findFirstRecordByFilter(
        'config_integracoes',
        "chave = 'placar_ao_vivo' && provedor = 'api_football' && ativo = true",
      )
      if (recPlacar) {
        apiKey = (recPlacar.getString('api_key') || recPlacar.get('api_key') || '')
          .toString()
          .trim()
      }
    } catch (_) {}

    if (!apiKey) {
      try {
        const recPlacarDirect = $app.findFirstRecordByData(
          'config_integracoes',
          'chave',
          'placar_ao_vivo',
        )
        if (recPlacarDirect && recPlacarDirect.getBool('ativo')) {
          apiKey = (recPlacarDirect.getString('api_key') || recPlacarDirect.get('api_key') || '')
            .toString()
            .trim()
        }
      } catch (_) {}
    }

    if (!apiKey) {
      try {
        const configs = $app.findRecordsByFilter(
          'config_integracoes',
          "provedor = 'api_football' && ativo = true",
          '-updated',
          20,
          0,
        )
        for (let ci = 0; ci < configs.length; ci++) {
          const cfg = configs[ci]
          const chv = (cfg.getString('chave') || '').trim()
          if (
            chv === 'sobrescrita_jogos' ||
            chv === 'api_validada' ||
            chv === 'api_football_daily_usage'
          ) {
            continue
          }
          const candidateKey = (cfg.getString('api_key') || cfg.get('api_key') || '')
            .toString()
            .trim()
          if (candidateKey && !candidateKey.startsWith('{') && !candidateKey.startsWith('[')) {
            apiKey = candidateKey
            break
          }
        }
      } catch (_) {}
    }

    if (!apiKey) {
      return e.json(400, {
        error: 'Chave da API-Football não configurada em config_integracoes (placar_ao_vivo).',
      })
    }

    // 4. Chamada à API-Sports via /fixtures?ids={id-id-...} (ou fallback ?id= caso o plano rejeite ?ids=)
    const isRapid = apiKey.length > 40
    const fixtureResponses = []
    const rawApiLogs = []

    const headers = isRapid
      ? { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }
      : { 'x-apisports-key': apiKey }

    const registrarConsumo = () => {
      try {
        usageData.count = (Number(usageData.count) || 0) + 1
        usageData.last_request_utc = new Date().toISOString()
        if (recUsage) {
          recUsage.set('api_key', JSON.stringify(usageData))
          $app.save(recUsage)
        } else {
          const colIntegracoes = $app.findCollectionByNameOrId('config_integracoes')
          const novo = new Record(colIntegracoes)
          novo.set('chave', USAGE_RECORD_CHAVE)
          novo.set('provedor', 'api_football')
          novo.set('ativo', true)
          novo.set('api_key', JSON.stringify(usageData))
          $app.save(novo)
        }
      } catch (_) {}
    }

    const chunks = []
    for (let i = 0; i < uniqueFixtureIds.length; i += 20) {
      chunks.push(uniqueFixtureIds.slice(i, i + 20))
    }

    for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
      const chunkIds = chunks[cIdx]
      let url = ''
      if (chunkIds.length === 1) {
        url = isRapid
          ? `https://api-football-v1.p.rapidapi.com/v3/fixtures?id=${encodeURIComponent(chunkIds[0])}`
          : `https://v3.football.api-sports.io/fixtures?id=${encodeURIComponent(chunkIds[0])}`
      } else {
        const idsJoined = chunkIds.join('-')
        url = isRapid
          ? `https://api-football-v1.p.rapidapi.com/v3/fixtures?ids=${encodeURIComponent(idsJoined)}`
          : `https://v3.football.api-sports.io/fixtures?ids=${encodeURIComponent(idsJoined)}`
      }

      console.log(
        `[atualizar-todos] [API-Sports Req ${cIdx + 1}/${chunks.length}] URL: ${url} | Fixture IDs: ${chunkIds.join(', ')}`,
      )

      let resHttp = null
      try {
        resHttp = $http.send({
          url,
          method: 'GET',
          headers,
          timeout: 15,
        })
        registrarConsumo()
      } catch (errSend) {
        console.log('[atualizar-todos] Erro ao enviar requisição HTTP:', errSend)
        rawApiLogs.push({
          url,
          fixture_ids: chunkIds,
          error: String(errSend),
        })
        continue
      }

      if (!resHttp || resHttp.statusCode !== 200) {
        console.log(
          '[atualizar-todos] Resposta com status não-200:',
          resHttp ? resHttp.statusCode : 'nulo',
        )
        rawApiLogs.push({
          url,
          fixture_ids: chunkIds,
          statusCode: resHttp ? resHttp.statusCode : null,
          raw: resHttp ? (resHttp.raw || '').slice(0, 500) : null,
        })
        continue
      }

      let json = null
      try {
        json =
          typeof resHttp.json === 'object' && resHttp.json !== null
            ? resHttp.json
            : JSON.parse(resHttp.raw)
      } catch (_) {
        json = null
      }

      try {
        console.log(
          `[atualizar-todos] [API-Sports Res ${cIdx + 1}/${chunks.length}] JSON exato:`,
          JSON.stringify(json),
        )
      } catch (_) {}

      rawApiLogs.push({
        url,
        fixture_ids: chunkIds,
        statusCode: resHttp.statusCode,
        results: json && typeof json.results === 'number' ? json.results : 0,
        response_count: json && Array.isArray(json.response) ? json.response.length : 0,
        json_exact: json,
      })

      if (json && json.errors && Object.keys(json.errors).length > 0) {
        const errStr = JSON.stringify(json.errors)
        if (errStr.includes('rate') || errStr.includes('Requests')) {
          usageData.blocked = true
          if (recUsage) {
            recUsage.set('api_key', JSON.stringify(usageData))
            $app.save(recUsage)
          }
          return e.json(429, {
            error:
              'Limite de requisições da API-Sports atingido. A cota reinicia às 21h (Brasília).',
            rate_limited: true,
            debug_logs: rawApiLogs,
          })
        }

        // Se o plano gratuito da API-Sports rejeitou o parâmetro ?ids= ("Free plans do not have access to the Ids parameter.")
        // Executa fallback individual por fixture_id (?id=...) respeitando a cota diária
        if (errStr.includes('Ids parameter') || errStr.includes('Free plans')) {
          console.log(
            '[atualizar-todos] API recusou ?ids= para o plano atual. Executando fallback para ?id=...',
          )
          for (let fIdx = 0; fIdx < chunkIds.length; fIdx++) {
            const singleId = chunkIds[fIdx]
            const currentC = Number(usageData.count) || 0
            if (!travaDesativada && currentC >= maxLimit) {
              console.log('[atualizar-todos] Cota atingida durante fallback por ID individual.')
              break
            }

            const singleUrl = isRapid
              ? `https://api-football-v1.p.rapidapi.com/v3/fixtures?id=${encodeURIComponent(singleId)}`
              : `https://v3.football.api-sports.io/fixtures?id=${encodeURIComponent(singleId)}`

            try {
              console.log(
                `[atualizar-todos] [Fallback ?id=] URL: ${singleUrl} | Fixture ID: ${singleId}`,
              )
              const resSingle = $http.send({
                url: singleUrl,
                method: 'GET',
                headers,
                timeout: 15,
              })
              registrarConsumo()

              if (resSingle && resSingle.statusCode === 200) {
                const jsonSingle = JSON.parse(resSingle.raw)
                try {
                  console.log(
                    `[atualizar-todos] [Fallback ?id=${singleId}] JSON exato:`,
                    JSON.stringify(jsonSingle),
                  )
                } catch (_) {}
                if (
                  jsonSingle &&
                  Array.isArray(jsonSingle.response) &&
                  jsonSingle.response.length > 0
                ) {
                  fixtureResponses.push(jsonSingle.response[0])
                }
                rawApiLogs.push({
                  url: singleUrl,
                  fixture_ids: [singleId],
                  statusCode: resSingle.statusCode,
                  results:
                    jsonSingle && typeof jsonSingle.results === 'number' ? jsonSingle.results : 0,
                  response_count:
                    jsonSingle && Array.isArray(jsonSingle.response)
                      ? jsonSingle.response.length
                      : 0,
                  json_exact: jsonSingle,
                })
              }
            } catch (errFallback) {
              console.log(`[atualizar-todos] Erro no fallback ?id=${singleId}:`, errFallback)
            }
          }
          continue
        }
      }

      if (json && Array.isArray(json.response)) {
        for (let r = 0; r < json.response.length; r++) {
          fixtureResponses.push(json.response[r])
        }
      }
    }

    if (fixtureResponses.length === 0) {
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

      const isLive = ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT'].includes(statusShort)
      const isFinished = ['FT', 'AET', 'PEN'].includes(statusShort)

      const homeTeamLogo = (fixData.teams?.home?.logo || '').toString().trim()
      const awayTeamLogo = (fixData.teams?.away?.logo || '').toString().trim()

      // Eventos detalhados (Gols, Cartões, Substituições)
      const rawEvents = Array.isArray(fixData.events) ? fixData.events : []
      const homeTeamId = fixData.teams?.home?.id
      const awayTeamId = fixData.teams?.away?.id

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
          const detail = (ev.detail || '').toString().toLowerCase()
          if (detail.includes('missed') || detail.includes('perdido')) {
            continue
          }
          const isContra = detail.includes('own') || detail.includes('contra')
          const playerName = (ev.player?.name || '').toString().trim()
          const minute = ev.time?.elapsed ? String(ev.time.elapsed) : ''
          const teamId = ev.team?.id

          if (playerName) {
            let posicao = 'Atacante/Meia'
            if (isContra) {
              posicao = 'Gol Contra'
            }

            const item = {
              nome: playerName,
              posicao: posicao,
              quantidade: 1,
              minuto: minute ? `${minute}'` : '',
            }

            if (teamId === homeTeamId) {
              golsA.push(item)
            } else if (teamId === awayTeamId) {
              golsB.push(item)
            }

            marcadoresGerais.push(minute ? `${playerName} ${minute}'` : playerName)
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
        updatedAt: new Date().toISOString(),
      }

      // Persiste cache no servidor PB ($app.store()) para consulta instantânea por /backend/v1/eventos-jogo
      try {
        $app.store().set('events_fixture_' + fid, JSON.stringify(fichaDetalhesPayload))
      } catch (_) {}

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

        // Regra 1: Se o jogo já tiver sido encerrado na API (FT / AET / PEN),
        // altera automaticamente o status para Encerrado (status: 'finalizado'),
        // gravando resultado_finalizado = true no banco de dados.
        if (isFinished) {
          jRec.set('status', 'finalizado')
          jRec.set('resultado_finalizado', true)
        } else if (kickoffJaChegou && isLive) {
          jRec.set('status', 'ao_vivo')
        }

        if (golsA.length > 0) jRec.set('gols_time_a', golsA)
        if (golsB.length > 0) jRec.set('gols_time_b', golsB)
        if (marcadoresGerais.length > 0) jRec.set('marcadores', marcadoresGerais)

        // Grava a ficha completa de detalhes (timeline de eventos)
        jRec.set('ficha_detalhes', fichaDetalhesPayload)

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
            mudou_para_encerrado: isEncerrado,
            fixture_id: fid,
            gols_time_a: savedRec.get('gols_time_a'),
            gols_time_b: savedRec.get('gols_time_b'),
            marcadores: savedRec.get('marcadores'),
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

    let messageNotice = null
    let messageSucesso = ''

    if (totalComPlacarGravado === 0) {
      messageNotice =
        'A API retornou a consulta, mas o placar oficial dos jogos ainda não foi disponibilizado na API-Sports.'
      messageSucesso = `Consulta concluída: 0 jogos com placar gravado, ${totalSemPlacarGravado} sem placar disponível, ${totalEncerrados} encerrado(s).`
    } else {
      messageSucesso = `Placares atualizados com sucesso: ${totalComPlacarGravado} jogo(s) com placar gravado, ${totalSemPlacarGravado} sem placar, ${totalEncerrados} encerrado(s).`
    }

    return e.json(200, {
      success: true,
      message: messageSucesso,
      notice: messageNotice,
      resumo: {
        total_jogos: jogosRecords.length,
        com_placar: totalComPlacarGravado,
        sem_placar: totalSemPlacarGravado,
        encerrados: totalEncerrados,
      },
      total_jogos: jogosRecords.length,
      atualizados: updatedJogosList.length,
      jogos_com_placar_gravado: totalComPlacarGravado,
      jogos_sem_placar_null: totalSemPlacarGravado,
      jogos_encerrados: totalEncerrados,
      fixtures_finalizados: totalEncerrados,
      fixtures_com_gols: totalComPlacarGravado,
      fixture_ids_enviados: uniqueFixtureIds,
      jogos: updatedJogosList,
      debug_logs: rawApiLogs,
    })
  },
  $apis.requireAuth(),
)
