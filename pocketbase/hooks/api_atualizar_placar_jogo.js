// pocketbase/hooks/api_atualizar_placar_jogo.js
// Endpoint: POST /backend/v1/placar-ao-vivo/atualizar-jogo
// Atualização pontual do placar ao vivo e marcadores da partida via API-Sports
// Exclusivo para admin Douglas (douglas, douglas@repress.com.br, douglas.manoel@repress.com.br)
// Sem require dinâmico (tudo inline para respeitar o JSVM do PocketBase)

routerAdd(
  'POST',
  '/backend/v1/placar-ao-vivo/atualizar-jogo',
  (e) => {
    // No PocketBase JSVM routerAdd, o contexto do evento 'e' possui e.auth populado quando o middleware $apis.requireAuth() está ativo
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
    const jogoId = (body.jogoId || body.jogo_id || body.id || '').toString().trim()
    const apiFixtureId = (body.api_fixture_id || body.fixture_id || '').toString().trim()

    if (!jogoId) {
      return e.json(400, { error: 'ID do jogo é obrigatório.' })
    }

    let jogoRecord
    try {
      jogoRecord = $app.findRecordById('jogos', jogoId)
    } catch (_) {
      return e.json(404, { error: 'Jogo não encontrado no sistema.' })
    }

    const fixtureIdParaUso = apiFixtureId || (jogoRecord.get('fixture_id') || '').toString().trim()

    if (!fixtureIdParaUso) {
      return e.json(400, {
        error:
          'Este jogo não possui ID da partida (fixture_id) vinculado. Vincule o ID antes de atualizar.',
      })
    }

    // Rate limiter check inline sem require dinâmico (respeita registro com count/max_limit/blocked)
    const dNow = new Date()
    const yyyy = dNow.getUTCFullYear()
    const mm = String(dNow.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(dNow.getUTCDate()).padStart(2, '0')
    const hojeUtc = `${yyyy}-${mm}-${dd}`
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

    // Reset diário às 00:00 UTC se mudou a data
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
          'Limite diário de requisições da API-Sports atingido (80/dia). A cota é reiniciada às 21h (horário de Brasília). Placar mantido em segurança.',
        rate_limited: true,
        count: currentCount,
        max_limit: maxLimit,
      })
    }

    // Buscar chave da API-Sports
    // 1) Registro principal: chave = "placar_ao_vivo" && provedor = "api_football" && ativo = true
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

    // Fallback caso não encontre por filtro ou api_key esteja em branco:
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

    // Consulta fixture por ID via limiter central com rotação e fallback
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

    let fixtureData = null
    try {
      const url = `https://v3.football.api-sports.io/fixtures?id=${encodeURIComponent(fixtureIdParaUso)}`
      console.log(`[atualizar-jogo] [API-Sports] URL: ${url} | Fixture ID: ${fixtureIdParaUso}`)

      let respCall = null
      if (limiterMod && typeof limiterMod.enviarRequisicaoApiFootball === 'function') {
        respCall = limiterMod.enviarRequisicaoApiFootball(
          url,
          { timeout: 15, isAdminManual: true },
          2,
        )
      } else {
        const sendRes = $http.send({ url, method: 'GET', timeout: 15 })
        let j = null
        try {
          j =
            typeof sendRes.json === 'object' && sendRes.json !== null
              ? sendRes.json
              : JSON.parse(sendRes.raw)
        } catch (_) {}
        respCall = {
          blocked: false,
          statusCode: sendRes ? sendRes.statusCode : 500,
          rawResponse: sendRes,
          json: j,
        }
      }

      if (respCall.blocked && respCall.auth_error) {
        return e.json(401, {
          success: false,
          auth_error: true,
          error: 'Erro de autenticação na API. Verifique se a API Key está ativa no painel.',
        })
      }

      if (respCall.blocked && respCall.rate_limited) {
        return e.json(429, {
          success: false,
          error: 'Limite de requisições da API-Sports atingido nas chaves configuradas.',
        })
      }

      if (respCall.statusCode === 401 || respCall.statusCode === 403) {
        return e.json(401, {
          success: false,
          auth_error: true,
          error: 'Erro de autenticação na API. Verifique se a API Key está ativa no painel.',
        })
      }

      if (respCall.statusCode !== 200) {
        return e.json(502, {
          error: `A API-Sports retornou status ${respCall.statusCode}. Tente novamente mais tarde.`,
        })
      }

      const json = respCall.json
      if (json && json.errors && Object.keys(json.errors).length > 0) {
        const errStr = JSON.stringify(json.errors).toLowerCase()
        const isParamOrPlanError =
          errStr.includes('parameter') ||
          errStr.includes('plan') ||
          errStr.includes('ids parameter')
        if (
          !isParamOrPlanError &&
          (errStr.includes('invalid api key') ||
            errStr.includes('invalid key') ||
            errStr.includes('wrong api key') ||
            errStr.includes('wrong key') ||
            errStr.includes('account suspended') ||
            errStr.includes('key suspended') ||
            errStr.includes('key expired'))
        ) {
          return e.json(401, {
            success: false,
            auth_error: true,
            error: 'Erro de autenticação na API. Verifique se a API Key está ativa no painel.',
          })
        }
        return e.json(502, { error: `Erro da API-Sports: ${JSON.stringify(json.errors)}` })
      }

      if (!json || !Array.isArray(json.response) || json.response.length === 0) {
        // Se a chamada principal de /fixtures retornou vazio (status 200/204),
        // NÃO é erro de autenticação nem significa que a fixture inexiste:
        // usa placeholder estruturado para que a busca dedicada de /fixtures/events processe os eventos!
        console.log(
          `[atualizar-jogo] Fixture ${fixtureIdParaUso} sem objeto principal em /fixtures; criando placeholder para eventos dedicados.`,
        )
        fixtureData = {
          fixture: {
            id: parseInt(fixtureIdParaUso, 10) || fixtureIdParaUso,
            status: { short: '', long: '' },
          },
          teams: { home: {}, away: {} },
          goals: { home: null, away: null },
          score: {},
          events: [],
          lineups: [],
          is_placeholder: true,
        }
      } else {
        fixtureData = json.response[0]
      }
    } catch (err) {
      return e.json(500, {
        error: 'Falha na comunicação com a API-Sports: ' + (err.message || String(err)),
      })
    }

    // Verifica horário de kickoff do jogo no horário de Brasília (UTC-3)
    const dataStr = (jogoRecord.getString('data') || '').trim()
    const horaStr = (jogoRecord.getString('hora') || '').trim()
    let kickoffMs = 0
    try {
      const horaParts = horaStr.split(':')
      const hh = (horaParts[0] || '16').padStart(2, '0')
      const mm = (horaParts[1] || '00').padStart(2, '0')
      const ss = (horaParts[2] || '00').padStart(2, '0')
      const isoStr = dataStr + 'T' + hh + ':' + mm + ':' + ss + '-03:00'
      const parsedKickoff = new Date(isoStr).getTime()
      if (!isNaN(parsedKickoff)) {
        kickoffMs = parsedKickoff
      }
    } catch (_) {}

    const kickoffJaChegou = kickoffMs > 0 ? Date.now() >= kickoffMs : true

    const goals = fixtureData.goals || {}
    const score = fixtureData.score || {}
    const statusInfo = fixtureData.fixture?.status || {}
    const statusShort = (statusInfo.short || '').toString().toUpperCase().trim()

    // Parser robusto de gols: goals.home/away com fallback para score.fulltime.home/away
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
    const hasOfficialScore = homeGoals !== null && awayGoals !== null

    // VALIDAÇÃO ESTRITA DE STATUS DA API-SPORTS:
    // "Apenas atualize o status de um jogo para 'Ao Vivo' (1H, 2H, HT, etc.) se a API-Sports retornar
    // explicitamente que a partida está em andamento (status '1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE')."
    // "Se o status na API-Sports for 'NS' (Not Started) ou 'TBD', MANTENHA o jogo como 'Pendente' / 'Aberto',
    // e NÃO grave placar zerado (0 x 0) nem marque como 'Ao Vivo'."
    const isLive = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT'].includes(statusShort)
    const isFinished = ['FT', 'AET', 'PEN'].includes(statusShort)
    const isNotStarted = ['NS', 'TBD', ''].includes(statusShort)

    // Se a partida está finalizada ou em andamento explícito, grava os gols oficiais se existirem
    if (isFinished || isLive) {
      if (homeGoals !== null) {
        jogoRecord.set('placar_a', homeGoals)
      }
      if (awayGoals !== null) {
        jogoRecord.set('placar_b', awayGoals)
      }
    } else if (isNotStarted) {
      // Para NS/TBD: NÃO grava placar zerado (0x0) nem sobrescreve com 0
      // Mantém placar intocado ou limpa placar falso se for NS/TBD
      console.log(
        `[atualizar-jogo] Partida fixture ${fixtureIdParaUso} está NS/TBD. Mantendo Pendente/Aberto sem placar zerado.`,
      )
    }

    // Atualização de logos/escudos dos times via API-Football
    const homeTeamLogo = (fixtureData.teams?.home?.logo || '').toString().trim()
    const awayTeamLogo = (fixtureData.teams?.away?.logo || '').toString().trim()

    if (homeTeamLogo) {
      jogoRecord.set('url_escudo_mandante', homeTeamLogo)
    }
    if (awayTeamLogo) {
      jogoRecord.set('url_escudo_visitante', awayTeamLogo)
    }

    // Se houver registros vinculados na tabela jogos_do_dia ou enquete_jogos com o mesmo fixture_id, atualiza lá também
    try {
      if (fixtureIdParaUso && (homeTeamLogo || awayTeamLogo)) {
        try {
          const jdds = $app.findRecordsByFilter(
            'jogos_do_dia',
            `fixture_id = '${fixtureIdParaUso}'`,
            '-created',
            5,
            0,
          )
          for (let jdi = 0; jdi < jdds.length; jdi++) {
            const jdd = jdds[jdi]
            let mudouJdd = false
            if (homeTeamLogo && !jdd.getString('logo_casa')) {
              jdd.set('logo_casa', homeTeamLogo)
              mudouJdd = true
            }
            if (awayTeamLogo && !jdd.getString('logo_visitante')) {
              jdd.set('logo_visitante', awayTeamLogo)
              mudouJdd = true
            }
            if (mudouJdd) $app.save(jdd)
          }
        } catch (_) {}

        try {
          const enqs = $app.findRecordsByFilter(
            'enquete_jogos',
            `fixture_id = '${fixtureIdParaUso}'`,
            '-created',
            5,
            0,
          )
          for (let eqi = 0; eqi < enqs.length; eqi++) {
            const eq = enqs[eqi]
            let mudouEq = false
            if (homeTeamLogo && !eq.getString('logo_casa')) {
              eq.set('logo_casa', homeTeamLogo)
              mudouEq = true
            }
            if (awayTeamLogo && !eq.getString('logo_visitante')) {
              eq.set('logo_visitante', awayTeamLogo)
              mudouEq = true
            }
            if (mudouEq) $app.save(eq)
          }
        } catch (_) {}
      }
    } catch (_) {}

    // Atualização estrita de status:
    // Apenas finalizado se FT/AET/PEN ou se status já for finalizado/encerrado
    // Apenas ao_vivo se 1H/HT/2H/ET/BT/P/LIVE/INT E kickoff já passou
    // Se NS/TBD: mantém como 'pendente' ou 'aberto' (não mexe para ao_vivo)
    const currentStatusBanco = (jogoRecord.getString('status') || '').toLowerCase().trim()
    const isStatusBancoFinalizado = ['finalizado', 'encerrado', 'ft', 'finished'].includes(
      currentStatusBanco,
    )

    if (isFinished || isStatusBancoFinalizado) {
      jogoRecord.set('status', 'finalizado')
      jogoRecord.set('resultado_finalizado', true)
    } else if (isLive && kickoffJaChegou) {
      jogoRecord.set('status', 'ao_vivo')
      jogoRecord.set('resultado_finalizado', false)
    } else if (isNotStarted) {
      if (currentStatusBanco === 'ao_vivo') {
        jogoRecord.set('status', 'pendente')
      }
      jogoRecord.set('resultado_finalizado', false)
    }

    // BUSCA OBRIGATÓRIA DE EVENTOS E MARCADORES (/fixtures/events?fixture={fixture_id}):
    // Para garantir a extração fiel de eventos mesmo em planos/endpoints que omitem events do objeto fixture
    let dedicatedEventsRaw = []
    try {
      const urlEvents = `https://v3.football.api-sports.io/fixtures/events?fixture=${encodeURIComponent(fixtureIdParaUso)}`
      console.log(
        `[atualizar-jogo] Buscando eventos dedicados (/fixtures/events) para fixture ${fixtureIdParaUso}...`,
      )
      const callEvents =
        limiterMod && typeof limiterMod.enviarRequisicaoApiFootball === 'function'
          ? limiterMod.enviarRequisicaoApiFootball(
              urlEvents,
              { timeout: 15, isAdminManual: true },
              2,
            )
          : null

      if (
        callEvents &&
        callEvents.statusCode === 200 &&
        callEvents.json &&
        Array.isArray(callEvents.json.response)
      ) {
        dedicatedEventsRaw = callEvents.json.response
        console.log(
          `[atualizar-jogo] ${dedicatedEventsRaw.length} evento(s) retornados de /fixtures/events para fixture ${fixtureIdParaUso}`,
        )
      }
    } catch (errEvents) {
      console.log(
        `[atualizar-jogo] Erro ao consultar /fixtures/events para fixture ${fixtureIdParaUso}:`,
        errEvents,
      )
    }

    // Extrair eventos de gols, cartões e substituições no mesmo formato (prioriza /fixtures/events se retornado)
    const events =
      Array.isArray(dedicatedEventsRaw) && dedicatedEventsRaw.length > 0
        ? dedicatedEventsRaw
        : Array.isArray(fixtureData.events)
          ? fixtureData.events
          : []
    const homeTeamId = fixtureData.teams?.home?.id
    const awayTeamId = fixtureData.teams?.away?.id

    const normalizedEvents = events.map((ev) => {
      const typeStr = (ev.type || '').toString().toLowerCase()
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

    function extractTeamIdFromUrl(url) {
      if (!url || typeof url !== 'string') return null
      const m = url.match(/teams\/(\d+)(?:\.png|\.svg|\.jpg|\b)/i)
      return m ? String(m[1]) : null
    }

    const idMandante =
      (homeTeamId ? String(homeTeamId) : null) ||
      extractTeamIdFromUrl(jogoRecord.getString('url_escudo_mandante'))
    const idVisitante =
      (awayTeamId ? String(awayTeamId) : null) ||
      extractTeamIdFromUrl(jogoRecord.getString('url_escudo_visitante'))
    const timeANome = (
      jogoRecord.getString('time_a') ||
      fixtureData.teams?.home?.name ||
      ''
    ).toString()
    const timeBNome = (
      jogoRecord.getString('time_b') ||
      fixtureData.teams?.away?.name ||
      ''
    ).toString()
    const timeANorm = stripAccents(timeANome.toLowerCase())
    const timeBNorm = stripAccents(timeBNome.toLowerCase())

    const golsA = []
    const golsB = []
    const marcadoresGerais = []

    for (let i = 0; i < events.length; i++) {
      const ev = events[i]
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
        const evTeamName = (ev.team?.name || '').toString().trim()
        const teamNorm = stripAccents(evTeamName.toLowerCase())

        if (playerName) {
          let posicao = 'Atacante/Meia'
          if (isContra) {
            posicao = 'Gol Contra'
          }

          const item = {
            nome: playerName,
            posicao: posicao,
            quantidade: 1,
            minuto: minuteInt !== null ? minuteInt : minuteStr,
          }

          // Identificar time do evento PRIMEIRO por ID; só usa nome se IDs ausentes
          let evIsA = false
          let evIsB = false

          if (idMandante && idVisitante && evTeamId) {
            evIsA = evTeamId === idMandante
            evIsB = evTeamId === idVisitante
          } else if (evTeamId && idMandante) {
            evIsA = evTeamId === idMandante
          } else if (evTeamId && idVisitante) {
            evIsB = evTeamId === idVisitante
          } else if (teamNorm) {
            if (timeANorm && (timeANorm.includes(teamNorm) || teamNorm.includes(timeANorm))) {
              evIsA = true
            } else if (
              timeBNorm &&
              (timeBNorm.includes(teamNorm) || teamNorm.includes(timeBNorm))
            ) {
              evIsB = true
            }
          }

          // Own Goal credita ao ADVERSÁRIO
          let destIsA = false
          let destIsB = false
          if (isContra) {
            if (evIsA) destIsB = true
            else if (evIsB) destIsA = true
            else destIsB = true
          } else {
            if (evIsA) destIsA = true
            else if (evIsB) destIsB = true
            else destIsA = true
          }

          if (destIsA) {
            golsA.push(item)
          } else if (destIsB) {
            golsB.push(item)
          } else {
            golsA.push(item)
          }

          marcadoresGerais.push(minuteStr ? `${playerName} ${minuteStr}` : playerName)
        }
      }
    }

    // DERIVAÇÃO ESTRITA DE PLACAR A PARTIR DOS EVENTOS:
    // Se há eventos de gols válidos computados (golsA e/ou golsB), o placar DERIVADO
    // sobrepõe o placar bruto para garantir que o placar geral bata exatamente com a soma dos gols válidos.
    // Se não há eventos de gols válidos, preserva o placar bruto oficial da API.
    let defPlacarA = homeGoals
    let defPlacarB = awayGoals

    const totalEventGoals = golsA.length + golsB.length
    if (totalEventGoals > 0 && kickoffJaChegou) {
      defPlacarA = golsA.length
      defPlacarB = golsB.length
      console.log(
        `[atualizar-jogo] Placar derivado diretamente dos eventos válidos da partida: ${defPlacarA} x ${defPlacarB} (bruto API era ${homeGoals} x ${awayGoals})`,
      )
    } else if (
      (defPlacarA === null || defPlacarB === null) &&
      totalEventGoals > 0 &&
      kickoffJaChegou
    ) {
      defPlacarA = golsA.length
      defPlacarB = golsB.length
    }

    if (defPlacarA !== null && defPlacarB !== null) {
      jogoRecord.set('placar_a', defPlacarA)
      jogoRecord.set('placar_b', defPlacarB)
    }

    if (golsA.length > 0) {
      jogoRecord.set('gols_time_a', golsA)
    } else if (defPlacarA === 0 && (isFinished || isLive)) {
      jogoRecord.set('gols_time_a', [])
    }

    if (golsB.length > 0) {
      jogoRecord.set('gols_time_b', golsB)
    } else if (defPlacarB === 0 && (isFinished || isLive)) {
      jogoRecord.set('gols_time_b', [])
    }

    if (marcadoresGerais.length > 0) {
      jogoRecord.set('marcadores', marcadoresGerais)
    } else if (defPlacarA === 0 && defPlacarB === 0 && (isFinished || isLive)) {
      jogoRecord.set('marcadores', [])
    }

    if (
      fixtureIdParaUso &&
      (!jogoRecord.get('fixture_id') || jogoRecord.get('fixture_id') !== fixtureIdParaUso)
    ) {
      jogoRecord.set('fixture_id', fixtureIdParaUso)
    }

    // Busca ou processamento de Escalações (lineups) para o jogo individual:
    let parsedEscalacoesIndiv = null
    let apiLineupsIndiv = Array.isArray(fixtureData.lineups) ? fixtureData.lineups : []

    if (apiLineupsIndiv.length === 0 && (isLive || isFinished)) {
      try {
        const urlLineupsIndiv = `https://v3.football.api-sports.io/fixtures/lineups?fixture=${encodeURIComponent(fixtureIdParaUso)}`
        const callLineupIndiv =
          limiterMod && typeof limiterMod.enviarRequisicaoApiFootball === 'function'
            ? limiterMod.enviarRequisicaoApiFootball(
                urlLineupsIndiv,
                { timeout: 15, isAdminManual: true },
                2,
              )
            : null

        if (
          callLineupIndiv &&
          callLineupIndiv.statusCode === 200 &&
          callLineupIndiv.json &&
          Array.isArray(callLineupIndiv.json.response) &&
          callLineupIndiv.json.response.length > 0
        ) {
          apiLineupsIndiv = callLineupIndiv.json.response
        }
      } catch (errLineupsIndiv) {
        console.log(
          `[atualizar-jogo] Erro ao buscar lineups para fixture ${fixtureIdParaUso}:`,
          errLineupsIndiv,
        )
      }
    }

    if (apiLineupsIndiv.length > 0) {
      const teamsData = []
      for (let li = 0; li < apiLineupsIndiv.length; li++) {
        const teamBlock = apiLineupsIndiv[li]
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
        (t) => (t.starters && t.starters.length > 0) || (t.substitutes && t.substitutes.length > 0),
      )

      if (teamsData.length > 0 && hasRealLineupPlayers) {
        parsedEscalacoesIndiv = {
          status: 'confirmada',
          provider: 'api_football',
          fixtureId: fixtureIdParaUso,
          teams: teamsData,
          updatedAt: new Date().toISOString(),
        }
        jogoRecord.set('escalacoes', parsedEscalacoesIndiv)
      }
    }

    // Ficha de detalhes consolidada
    const fichaPayloadIndiv = {
      success: true,
      cached: false,
      source: 'api_football_individual',
      fixture_id: fixtureIdParaUso,
      teams: fixtureData.teams || {},
      goals: fixtureData.goals || {},
      fixture_status: fixtureData.fixture?.status || {},
      events: normalizedEvents,
      lineups: apiLineupsIndiv,
      updatedAt: new Date().toISOString(),
    }

    try {
      $app.store().set('events_fixture_' + fixtureIdParaUso, JSON.stringify(fichaPayloadIndiv))
      if (parsedEscalacoesIndiv) {
        $app.store().set('lineup_' + fixtureIdParaUso, JSON.stringify(parsedEscalacoesIndiv))
      }
    } catch (_) {}

    const prevFichaIndiv = jogoRecord.get('ficha_detalhes')
    const hasPrevEventsIndiv =
      prevFichaIndiv && Array.isArray(prevFichaIndiv.events) && prevFichaIndiv.events.length > 0
    if (normalizedEvents.length > 0 || !hasPrevEventsIndiv || isLive || isFinished) {
      jogoRecord.set('ficha_detalhes', fichaPayloadIndiv)
    }

    // Salvar alterações no registro de jogo
    try {
      $app.save(jogoRecord)
    } catch (err) {
      return e.json(500, {
        error: 'Erro ao persistir dados do jogo no banco: ' + (err.message || String(err)),
      })
    }

    // Leitura de confirmação pós-gravação diretamente do banco de dados
    let savedJogoRecord = null
    try {
      savedJogoRecord = $app.findRecordById('jogos', jogoRecord.id)
    } catch (errRead) {
      return e.json(500, {
        error: 'Erro ao confirmar persistência no banco: ' + (errRead.message || String(errRead)),
      })
    }

    const savedPlacarA = savedJogoRecord.get('placar_a')
    const savedPlacarB = savedJogoRecord.get('placar_b')
    const savedStatus = savedJogoRecord.getString('status')
    const savedFinalizado = savedJogoRecord.getBool('resultado_finalizado')

    // Dispara o recálculo de pontuação dos palpites e ranking (reaproveitando rotina inline idêntica a admin_salvar_marcadores)
    let recalculou = false
    try {
      const statusAtualJogo = (jogoRecord.getString('status') || '').toLowerCase().trim()
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
      const jogoIniciou = (kickoffMs > 0 && Date.now() >= kickoffMs) || statusIniciado

      const placarRealA = jogoRecord.getInt('placar_a')
      const placarRealB = jogoRecord.getInt('placar_b')
      const bolaoId = jogoRecord.getString('bolao')
      const temPenaltis = jogoRecord.getBool('tem_penaltis')
      const vencedorPenaltisReal = (jogoRecord.getString('vencedor_penaltis') || '')
        .toUpperCase()
        .trim()

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

      const golsTimeA = parseJsonField(jogoRecord, 'gols_time_a')
      const golsTimeB = parseJsonField(jogoRecord, 'gols_time_b')

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
          if (orig && corr) {
            normMap[orig] = corr
          }
        }
      } catch (_) {}

      const normalizePlayerName = (name) => {
        if (!name) return ''
        let clean = stripAccents(String(name).toLowerCase().trim())
        if (normMap[clean]) {
          clean = stripAccents(normMap[clean])
        }
        return clean
      }

      const getWinner = (a, b) => {
        if (a > b) return 1
        if (b > a) return -1
        return 0
      }

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
          (pts === 3 ? 'Defensor' : pts === 10 ? 'Goleiro' : pts === 5 ? 'Gol Contra' : 'Atacante')

        const mins = []
        const minRegex = /(\d+)\s*['’]/g
        let mMatch
        while ((mMatch = minRegex.exec(rawNome)) !== null) {
          const num = parseInt(mMatch[1], 10)
          if (!isNaN(num)) mins.push(num)
        }

        if (realScorersMap[norm]) {
          realScorersMap[norm].countReal += count
          if (mins.length > 0) {
            realScorersMap[norm].minutes = realScorersMap[norm].minutes.concat(mins)
          }
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

      for (let gi = 0; gi < golsTimeA.length; gi++) processScorer(golsTimeA[gi])
      for (let gi = 0; gi < golsTimeB.length; gi++) processScorer(golsTimeB[gi])

      // Recalcula todos os palpites do jogo (trava jogoPontua intacta: !jogoIniciou zera pontuação)
      const palpitesDoJogo = $app.findRecordsByFilter(
        'palpites',
        "jogo = '" + jogoId + "'",
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
            predInfo[normP] = {
              count: 1,
              posicao: pPos,
              golContra: pContra,
            }
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

              const minsToUse = (matchedReal.minutes || []).slice(0, g)
              let txt = ''
              if (minsToUse.length > 0) {
                const minsStr = minsToUse.map((m) => m + "'").join(', ')
                txt =
                  matchedReal.displayName +
                  ' ' +
                  minsStr +
                  ' [' +
                  displayPos +
                  '] (+' +
                  ptsTotal +
                  ' pt' +
                  (ptsTotal > 1 ? 's' : '') +
                  ')'
              } else if (g > 1) {
                txt =
                  matchedReal.displayName +
                  ' ×' +
                  g +
                  ' [' +
                  displayPos +
                  '] (+' +
                  ptsTotal +
                  ' pt' +
                  (ptsTotal > 1 ? 's' : '') +
                  ')'
              } else {
                txt =
                  matchedReal.displayName +
                  ' [' +
                  displayPos +
                  '] (+' +
                  ptsTotal +
                  ' pt' +
                  (ptsTotal > 1 ? 's' : '') +
                  ')'
              }
              matchedScorers.push(txt)
            }
          }
        }

        if (matchedScorers.length > 0) {
          detalhamento.push('Gols acertados: ' + matchedScorers.join(', '))
        }

        if (temPenaltis) {
          const predPenaltis = (palpite.getString('vencedor_penaltis') || '').toUpperCase().trim()
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

      // Reacumula pontuação total dos participantes
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
          const pJogoId = p.getString('jogo')
          try {
            const gameRec = $app.findRecordById('jogos', pJogoId)
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

      recalculou = true
    } catch (errRecalc) {
      console.log('[atualizar-jogo] Erro ao recalcular pontuação:', errRecalc)
    }

    // Mensagem de retorno considerando jogo ao vivo vs finalizado
    let messageIndividual = ''
    if (isFinished) {
      messageIndividual = `Placar final sincronizado com sucesso: ${savedPlacarA} x ${savedPlacarB}. Jogo marcado como Encerrado.`
    } else if (isLive) {
      const minInfo = statusInfo.elapsed ? ` (${statusInfo.elapsed}')` : ''
      messageIndividual = `Placar ao vivo sincronizado: ${savedPlacarA} x ${savedPlacarB}${minInfo}. Partida em andamento.`
    } else if (hasOfficialScore) {
      messageIndividual = `Placar sincronizado com sucesso: ${savedPlacarA} x ${savedPlacarB}.`
    } else {
      messageIndividual =
        'A API retornou a consulta, mas o placar oficial do jogo ainda não foi disponibilizado na API-Sports.'
    }

    return e.json(200, {
      success: true,
      tem_placar_oficial: hasOfficialScore || isLive || isFinished,
      ao_vivo: isLive,
      message: messageIndividual,
      jogo: {
        id: savedJogoRecord.id,
        bolao: savedJogoRecord.get('bolao'),
        placar_a: savedPlacarA,
        placar_b: savedPlacarB,
        status: savedStatus,
        resultado_finalizado: savedFinalizado,
        gols_time_a: savedJogoRecord.get('gols_time_a'),
        gols_time_b: savedJogoRecord.get('gols_time_b'),
        marcadores: savedJogoRecord.get('marcadores'),
        escalacoes: savedJogoRecord.get('escalacoes'),
        ficha_detalhes: fichaPayloadIndiv,
        url_escudo_mandante: savedJogoRecord.get('url_escudo_mandante'),
        url_escudo_visitante: savedJogoRecord.get('url_escudo_visitante'),
        fixture_id: savedJogoRecord.get('fixture_id'),
      },
      status_fixture: statusShort,
      elapsed: statusInfo.elapsed || null,
      recalculou,
    })
  },
  $apis.requireAuth(),
)
