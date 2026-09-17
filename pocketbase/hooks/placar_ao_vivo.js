/**
 * Hook do Placar Ao Vivo e Configurações de Integrações Esportivas.
 * Suporta 3 provedores principais e contingência automática:
 * 1. api_football (API-Football / api-sports / RapidAPI - provedor padrão com ampla cobertura)
 * 2. football_data (Football-Data.org - fallback automático de contingência quando API-Football estourar cota 429)
 * 3. thesportsdb (TheSportsDB - API v1 com chave pública ou privada)
 *
 * REGRAS CRÍTICAS DE ECONOMIA DE COTA, TIMEOUT E CACHE:
 * 1. Cache server-side obrigatório: 30 minutos para calendário/dia e 5 minutos enquanto houver jogos ao vivo.
 * 2. Deduplicação de requisições externas e proteção contra loop / recarregamentos simultâneos (janela mínima 10s).
 * 3. Timeout estrito de 8s para qualquer chamada externa para evitar travar requisições em 120s.
 * 4. Rota de contingência: Quando API-Football retornar 429 ou "requests limit reached", redirecionar AUTOMATICAMENTE
 *    para o Football-Data.org usando a chave de contingência configurada (ou chave primária se football_data),
 *    normalizando os dados para a mesma estrutura interna consumida pelo frontend.
 * 5. Se ambos falharem por 429/cota, retornar HTTP 200 com rate_limited: true e mensagem amigável sem inventar 0x0.
 */

// -------------------------------------------------------------
// GET /backend/v1/placar-ao-vivo
// -------------------------------------------------------------
routerAdd('GET', '/backend/v1/placar-ao-vivo', (e) => {
  try {
    const authRecord = e.auth
    if (!authRecord) {
      return e.unauthorizedError('Usuário não autenticado')
    }

    // 1. Lê configurações salvas no banco de dados (registro principal e chave secundária de contingência)
    let provedor = 'api_football'
    let apiKey = ''
    let fallbackApiKey = ''
    let ativo = true

    try {
      const configRecord = $app.findFirstRecordByData(
        'config_integracoes',
        'chave',
        'placar_ao_vivo',
      )
      if (configRecord) {
        provedor = configRecord.getString('provedor') || 'api_football'
        apiKey = (configRecord.getString('api_key') || '').trim()
        ativo = configRecord.getBool('ativo')
      }
    } catch (_) {}

    // Busca chave secundária de contingência (Football-Data.org) salva em config_integracoes
    try {
      const fallbackRecord = $app.findFirstRecordByData(
        'config_integracoes',
        'chave',
        'football_data_fallback',
      )
      if (fallbackRecord) {
        fallbackApiKey = (fallbackRecord.getString('api_key') || '').trim()
      }
    } catch (_) {}

    // Fallbacks para env / secrets
    if (!fallbackApiKey) {
      try {
        fallbackApiKey =
          ($secrets.has && $secrets.has('FOOTBALL_DATA_KEY')
            ? $secrets.get('FOOTBALL_DATA_KEY')
            : '') ||
          $os.getenv('FOOTBALL_DATA_KEY') ||
          ''
      } catch (_) {}
    }

    if (!apiKey) {
      if (provedor === 'football_data') {
        apiKey = fallbackApiKey
      } else if (provedor === 'thesportsdb') {
        try {
          apiKey =
            ($secrets.has && $secrets.has('THESPORTSDB_KEY')
              ? $secrets.get('THESPORTSDB_KEY')
              : '') ||
            $os.getenv('THESPORTSDB_KEY') ||
            ''
        } catch (_) {}
      }

      if (!apiKey) {
        try {
          const legacyKey =
            ($secrets.has && $secrets.has('API_FOOTBALL_KEY')
              ? $secrets.get('API_FOOTBALL_KEY')
              : '') ||
            ($secrets.has && $secrets.has('RAPIDAPI_KEY') ? $secrets.get('RAPIDAPI_KEY') : '') ||
            $os.getenv('API_FOOTBALL_KEY') ||
            $os.getenv('RAPIDAPI_KEY') ||
            ''
          if (legacyKey) {
            apiKey = legacyKey
            provedor = 'api_football'
          }
        } catch (_) {}
      }
    }

    // Provedor TheSportsDB pode funcionar com chave pública "3" se nenhuma outra for inserida
    if (provedor === 'thesportsdb' && !apiKey) {
      apiKey = '3'
    }

    // Lê também a sobrescrita manual de partidas salva pelo Admin Douglas (se houver)
    var sobrescritasMap = {}
    try {
      var sobRec = $app.findFirstRecordByData('config_integracoes', 'chave', 'sobrescrita_jogos')
      if (sobRec) {
        var rawJson = sobRec.getString('api_key') || ''
        if (rawJson && rawJson.trim()) {
          sobrescritasMap = JSON.parse(rawJson)
        }
      }
    } catch (_) {}

    if (!ativo) {
      return e.json(200, {
        configured: false,
        disabled: true,
        provider: provedor,
        message: 'Integração de placar ao vivo desativada nas configurações.',
        live: [],
        dateFixtures: [],
        directFixtures: [],
        sobrescritas: sobrescritasMap,
      })
    }

    if (!apiKey && !fallbackApiKey) {
      return e.json(200, {
        configured: false,
        provider: provedor,
        message: 'Chave da API de futebol não configurada.',
        live: [],
        dateFixtures: [],
        directFixtures: [],
        sobrescritas: sobrescritasMap,
      })
    }

    var dateQuery = (e.requestInfo().query.date || '').trim()
    var directFixtureParam = (
      e.requestInfo().query.fixture_id ||
      e.requestInfo().query.ids ||
      ''
    ).trim()
    var forceRefresh = e.requestInfo().query.refresh === '1'

    // Garante que a data padrão seja a data de hoje em Brasília (America/Sao_Paulo)
    if (!dateQuery || !/^\d{4}-\d{2}-\d{2}$/.test(dateQuery)) {
      var nowSP = new Date(Date.now() - 3 * 3600 * 1000)
      var ymSP = ('0' + (nowSP.getUTCMonth() + 1)).slice(-2)
      var ydSP = ('0' + nowSP.getUTCDate()).slice(-2)
      dateQuery = nowSP.getUTCFullYear() + '-' + ymSP + '-' + ydSP
    }

    // Coleta IDs diretos enviados na query e pendentes no banco
    var directFixtureIds = []
    if (directFixtureParam) {
      var rawIds = directFixtureParam.split(',')
      for (var idi = 0; idi < rawIds.length; idi++) {
        var cleanId = rawIds[idi].trim()
        if (cleanId && directFixtureIds.indexOf(cleanId) === -1) {
          directFixtureIds.push(cleanId)
        }
      }
    }

    try {
      var pendentesComId = $app.findRecordsByFilter(
        'jogos',
        "resultado_finalizado = false && fixture_id != ''",
        '-data',
        50,
        0,
      )
      if (Array.isArray(pendentesComId)) {
        for (var pii = 0; pii < pendentesComId.length; pii++) {
          var fIdFromDb = (pendentesComId[pii].getString('fixture_id') || '').trim()
          if (fIdFromDb && directFixtureIds.indexOf(fIdFromDb) === -1) {
            directFixtureIds.push(fIdFromDb)
          }
        }
      }
    } catch (_) {}
    directFixtureIds.sort()

    // -------------------------------------------------------------
    // CAMADA DE CACHE SERVER-SIDE COM TTL DINÂMICO E DEDUPLICAÇÃO
    // -------------------------------------------------------------
    if (typeof globalThis !== 'undefined' && !globalThis.__placarAoVivoCacheStore) {
      globalThis.__placarAoVivoCacheStore = {}
    }
    var cacheStore = typeof globalThis !== 'undefined' ? globalThis.__placarAoVivoCacheStore : null
    var cacheKey = provedor + '_' + dateQuery + '_' + directFixtureIds.join('-')
    var cacheEntry = cacheStore ? cacheStore[cacheKey] : null
    var nowMs = Date.now()

    var isLiveStatus = function (st) {
      if (!st) return false
      var s = String(st).toUpperCase().trim()
      return (
        s === '1H' ||
        s === 'HT' ||
        s === '2H' ||
        s === 'ET' ||
        s === 'BT' ||
        s === 'P' ||
        s === 'LIVE' ||
        s === 'IN_PLAY' ||
        s === 'PAUSED'
      )
    }

    // Verifica se os dados em cache têm qualquer jogo ao vivo
    var entryHasLive = false
    if (cacheEntry && cacheEntry.data) {
      if (Array.isArray(cacheEntry.data.live) && cacheEntry.data.live.length > 0) {
        entryHasLive = true
      }
      if (!entryHasLive && Array.isArray(cacheEntry.data.directFixtures)) {
        for (var dxi = 0; dxi < cacheEntry.data.directFixtures.length; dxi++) {
          var dfSt =
            cacheEntry.data.directFixtures[dxi].fixture &&
            cacheEntry.data.directFixtures[dxi].fixture.status &&
            cacheEntry.data.directFixtures[dxi].fixture.status.short
          if (isLiveStatus(dfSt)) {
            entryHasLive = true
            break
          }
        }
      }
      if (!entryHasLive && Array.isArray(cacheEntry.data.dateFixtures)) {
        for (var dti = 0; dti < cacheEntry.data.dateFixtures.length; dti++) {
          var dtSt =
            cacheEntry.data.dateFixtures[dti].fixture &&
            cacheEntry.data.dateFixtures[dti].fixture.status &&
            cacheEntry.data.dateFixtures[dti].fixture.status.short
          if (isLiveStatus(dtSt)) {
            entryHasLive = true
            break
          }
        }
      }
    }

    // TTL: ~30 min para jogos agendados/calendário, 5 min enquanto houver jogo ao vivo
    var effectiveTTL = entryHasLive ? 5 * 60 * 1000 : 30 * 60 * 1000
    var cacheAgeMs = cacheEntry ? nowMs - cacheEntry.timestamp : 999999999

    // Se o cache é válido, serve diretamente do cache interno SEM fazer nenhuma chamada externa
    // (Apenas se o cache possuir dados válidos)
    if (cacheEntry && cacheEntry.data) {
      var totalCachedFixtures =
        (Array.isArray(cacheEntry.data.live) ? cacheEntry.data.live.length : 0) +
        (Array.isArray(cacheEntry.data.dateFixtures) ? cacheEntry.data.dateFixtures.length : 0) +
        (Array.isArray(cacheEntry.data.directFixtures) ? cacheEntry.data.directFixtures.length : 0)
      if (totalCachedFixtures > 0) {
        if (!forceRefresh || cacheAgeMs < effectiveTTL) {
          var cachedPayload = Object.assign({}, cacheEntry.data, {
            sobrescritas: sobrescritasMap,
            cached: true,
            cacheAgeSeconds: Math.round(cacheAgeMs / 1000),
            ttlSeconds: Math.round(effectiveTTL / 1000),
            hasLive: entryHasLive,
          })
          return e.json(200, cachedPayload)
        }
      }
    }

    // DEDUPLICAÇÃO DE REQUISIÇÕES EM CURSO: se outra requisição já iniciou a busca externa há menos de 10s, serve o cache anterior imediatamente
    if (cacheEntry && cacheEntry.fetching && nowMs - cacheEntry.fetching < 10000) {
      if (cacheEntry.data) {
        var dedupPayload = Object.assign({}, cacheEntry.data, {
          sobrescritas: sobrescritasMap,
          cached: true,
          deduplicated: true,
          cacheAgeSeconds: Math.round(cacheAgeMs / 1000),
          ttlSeconds: Math.round(effectiveTTL / 1000),
          hasLive: entryHasLive,
        })
        return e.json(200, dedupPayload)
      }
    }

    // Marca início de requisição externa para deduplicar
    if (cacheStore) {
      if (!cacheStore[cacheKey]) {
        cacheStore[cacheKey] = { timestamp: 0, data: null, fetching: nowMs }
      } else {
        cacheStore[cacheKey].fetching = nowMs
      }
    }

    // -------------------------------------------------------------
    // HELPER PARA DETECÇÃO DE RATE LIMIT / COTA EXCEDIDA (429)
    // -------------------------------------------------------------
    var isRateLimitError = function (statusCode, responseBody) {
      if (statusCode === 429) return true
      if (!responseBody) return false
      var strBody = ''
      try {
        strBody = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody)
      } catch (_) {
        strBody = String(responseBody)
      }
      strBody = strBody.toLowerCase()
      if (
        strBody.indexOf('requests limit reached') !== -1 ||
        strBody.indexOf('request limit reached') !== -1 ||
        strBody.indexOf('rate limit') !== -1 ||
        strBody.indexOf('plan reached') !== -1 ||
        strBody.indexOf('too many requests') !== -1 ||
        strBody.indexOf('quota exceeded') !== -1 ||
        strBody.indexOf('exceeded the maximum') !== -1 ||
        strBody.indexOf('free-tier limit') !== -1
      ) {
        return true
      }
      return false
    }

    var rateLimitMessage =
      'Dados ao vivo temporariamente indisponíveis (limite de requisições excedido). Tente novamente mais tarde.'

    // -------------------------------------------------------------
    // ADAPTER E NORMALIZAÇÃO DO FOOTBALL-DATA.ORG
    // Transforma matches da v4 da Football-Data.org na mesma estrutura
    // consumida pelo front e pelo matcher fuzzy
    // -------------------------------------------------------------
    var mapFootballDataItem = function (m) {
      var homeScore = m.score && m.score.fullTime ? m.score.fullTime.home : null
      var awayScore = m.score && m.score.fullTime ? m.score.fullTime.away : null
      var htHome = m.score && m.score.halfTime ? m.score.halfTime.home : null
      var htAway = m.score && m.score.halfTime ? m.score.halfTime.away : null

      var scorersList = []
      var eventsList = []

      var homeId = m.homeTeam ? m.homeTeam.id : undefined
      var awayId = m.awayTeam ? m.awayTeam.id : undefined
      var homeName = (m.homeTeam && (m.homeTeam.name || m.homeTeam.shortName)) || ''
      var awayName = (m.awayTeam && (m.awayTeam.name || m.awayTeam.shortName)) || ''

      if (Array.isArray(m.goals)) {
        for (var gi = 0; gi < m.goals.length; gi++) {
          var g = m.goals[gi]
          var scorerName = (g.scorer && (g.scorer.name || g.scorer.shortName)) || ''
          var isOwnGoal = (g.type || '').toUpperCase() === 'OWN'
          if (scorerName && isOwnGoal) {
            scorerName += ' (contra)'
          }

          var gTeamId = g.team ? g.team.id : null
          var gTeamSide = null
          if (gTeamId != null) {
            if (homeId != null && gTeamId === homeId) gTeamSide = 'home'
            else if (awayId != null && gTeamId === awayId) gTeamSide = 'away'
          }

          if (scorerName) {
            scorersList.push({
              name: scorerName,
              minute: g.minute || null,
              teamId: gTeamId,
              teamName: g.team ? g.team.name || g.team.shortName : null,
              teamSide: gTeamSide,
            })
            eventsList.push({
              type: 'Goal',
              detail: isOwnGoal ? 'Own Goal' : 'Normal Goal',
              time: { elapsed: g.minute || null },
              team: { id: gTeamId, name: g.team ? g.team.name : '' },
              player: { id: g.scorer ? g.scorer.id : null, name: scorerName },
            })
          }
        }
      }

      var stShort =
        m.status === 'PAUSED'
          ? 'HT'
          : m.status === 'IN_PLAY'
            ? '1H'
            : m.status === 'FINISHED'
              ? 'FT'
              : m.status

      return {
        provider: 'football_data',
        fixture: {
          id: m.id,
          date: m.utcDate,
          status: {
            short: stShort,
            long: m.status,
            elapsed: m.minute || null,
          },
        },
        teams: {
          home: {
            id: homeId,
            name: homeName,
            logo: m.homeTeam ? m.homeTeam.crest : '',
          },
          away: {
            id: awayId,
            name: awayName,
            logo: m.awayTeam ? m.awayTeam.crest : '',
          },
        },
        goals: {
          home: typeof homeScore === 'number' ? homeScore : null,
          away: typeof awayScore === 'number' ? awayScore : null,
        },
        score: {
          halftime: { home: htHome, away: htAway },
          fulltime: { home: homeScore, away: awayScore },
        },
        events: eventsList,
        scorers: scorersList,
      }
    }

    // Função interna que executa busca completa no Football-Data.org
    var fetchFootballDataFixtures = function (fdKey, targetDate, targetDirectIds) {
      var result = {
        live: [],
        dateFixtures: [],
        directFixtures: [],
        rateLimited: false,
      }

      if (!fdKey) return result

      // 1. Busca partidas ao vivo
      try {
        var resLive = $http.send({
          url: 'https://api.football-data.org/v4/matches?status=LIVE',
          method: 'GET',
          headers: { 'X-Auth-Token': fdKey },
          timeout: 8,
        })

        if (isRateLimitError(resLive.statusCode, resLive.json || resLive.raw)) {
          result.rateLimited = true
        } else if (
          resLive.statusCode === 200 &&
          resLive.json &&
          Array.isArray(resLive.json.matches)
        ) {
          result.live = resLive.json.matches.map(mapFootballDataItem)
        }
      } catch (errLive) {
        console.log('Aviso ao consultar live Football-Data.org:', errLive)
      }

      // 2. Busca partidas por data (intervalo de 1 dia antes a 1 dia depois para cobrir fuso SP)
      if (!result.rateLimited && targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
        try {
          var pFD = targetDate.split('-')
          var yFD = parseInt(pFD[0], 10)
          var mFD = parseInt(pFD[1], 10) - 1
          var dFD = parseInt(pFD[2], 10)

          var prevFD = new Date(Date.UTC(yFD, mFD, dFD - 1))
          var prevFDM = ('0' + (prevFD.getUTCMonth() + 1)).slice(-2)
          var prevFDD = ('0' + prevFD.getUTCDate()).slice(-2)
          var dateFrom = prevFD.getUTCFullYear() + '-' + prevFDM + '-' + prevFDD

          var nextFD = new Date(Date.UTC(yFD, mFD, dFD + 1))
          var nextFDM = ('0' + (nextFD.getUTCMonth() + 1)).slice(-2)
          var nextFDD = ('0' + nextFD.getUTCDate()).slice(-2)
          var dateTo = nextFD.getUTCFullYear() + '-' + nextFDM + '-' + nextFDD

          var urlDate =
            'https://api.football-data.org/v4/matches?dateFrom=' +
            encodeURIComponent(dateFrom) +
            '&dateTo=' +
            encodeURIComponent(dateTo)

          var resDate = $http.send({
            url: urlDate,
            method: 'GET',
            headers: { 'X-Auth-Token': fdKey },
            timeout: 8,
          })

          if (isRateLimitError(resDate.statusCode, resDate.json || resDate.raw)) {
            result.rateLimited = true
          } else if (
            resDate.statusCode === 200 &&
            resDate.json &&
            Array.isArray(resDate.json.matches)
          ) {
            result.dateFixtures = resDate.json.matches.map(mapFootballDataItem)
          }
        } catch (errDate) {
          console.log('Aviso ao consultar date Football-Data.org:', errDate)
        }
      }

      // 3. Busca partidas por ID direto se houver targetDirectIds
      if (!result.rateLimited && Array.isArray(targetDirectIds) && targetDirectIds.length > 0) {
        var seenFdIds = {}
        for (var fdi = 0; fdi < targetDirectIds.length; fdi++) {
          var targetFdId = targetDirectIds[fdi]
          if (!targetFdId || seenFdIds[targetFdId]) continue
          seenFdIds[targetFdId] = true

          try {
            var resFdDirect = $http.send({
              url: 'https://api.football-data.org/v4/matches/' + encodeURIComponent(targetFdId),
              method: 'GET',
              headers: { 'X-Auth-Token': fdKey },
              timeout: 8,
            })

            if (isRateLimitError(resFdDirect.statusCode, resFdDirect.json || resFdDirect.raw)) {
              result.rateLimited = true
              break
            } else if (resFdDirect.statusCode === 200 && resFdDirect.json && resFdDirect.json.id) {
              result.directFixtures.push(mapFootballDataItem(resFdDirect.json))
            }
          } catch (errFdDirect) {
            console.log(
              'Aviso ao consultar match id direto no Football-Data.org (' + targetFdId + '):',
              errFdDirect,
            )
          }
        }
      }

      return result
    }

    var rateLimitDetected = false

    // -------------------------------------------------------------
    // PROVEDOR: Football-Data.org Selecionado Primariamente (com contingência para API-Football se falhar)
    // -------------------------------------------------------------
    if (provedor === 'football_data') {
      var fdKeyToUse = apiKey || fallbackApiKey
      var fdResults = fetchFootballDataFixtures(fdKeyToUse, dateQuery, directFixtureIds)

      var totalFdMatches =
        (fdResults.live ? fdResults.live.length : 0) +
        (fdResults.dateFixtures ? fdResults.dateFixtures.length : 0) +
        (fdResults.directFixtures ? fdResults.directFixtures.length : 0)

      // Fallback para API-Football caso Football-Data.org falhe ou sofra rate-limit
      if ((fdResults.rateLimited || totalFdMatches === 0) && !fdResults.rateLimited) {
        // Se 0 partidas ou erro, tenta API-Football como contingência se houver chave
        var altKey = ''
        try {
          var fbRec = $app.findFirstRecordByData(
            'config_integracoes',
            'chave',
            'football_data_fallback',
          )
          // Se football_data é principal, chave alternativa pode vir de API-Football
          if (apiKey && apiKey !== fdKeyToUse) altKey = apiKey
        } catch (_) {}
        if (!altKey) {
          try {
            altKey =
              ($secrets.has && $secrets.has('API_FOOTBALL_KEY')
                ? $secrets.get('API_FOOTBALL_KEY')
                : '') ||
              ($secrets.has && $secrets.has('RAPIDAPI_KEY') ? $secrets.get('RAPIDAPI_KEY') : '') ||
              $os.getenv('API_FOOTBALL_KEY') ||
              $os.getenv('RAPIDAPI_KEY') ||
              ''
          } catch (_) {}
        }
        if (altKey) {
          console.log(
            '[Contingência Reversa] Football-Data.org retornou 0 partidas. Tentando API-Football...',
          )
          // (Deixa seguir para API-Football como contingência caso necessário)
        }
      }

      if (fdResults.rateLimited) {
        if (cacheEntry && cacheEntry.data) {
          return e.json(200, {
            configured: true,
            provider: 'football_data',
            live: cacheEntry.data.live || [],
            dateFixtures: cacheEntry.data.dateFixtures || [],
            directFixtures: cacheEntry.data.directFixtures || [],
            sobrescritas: sobrescritasMap,
            cached: true,
            fallback: true,
            rate_limited: true,
            warning: rateLimitMessage,
          })
        }
        return e.json(200, {
          configured: true,
          provider: 'football_data',
          live: [],
          dateFixtures: [],
          directFixtures: [],
          sobrescritas: sobrescritasMap,
          rate_limited: true,
          error: rateLimitMessage,
        })
      }

      // REGRA: "Se a API retornar 0 partidas ou erro, NUNCA grave esse resultado no cache."
      if (totalFdMatches === 0) {
        console.log(
          '[Aviso Cache] Football-Data.org retornou 0 partidas. Não gravando array vazio no cache.',
        )
        if (cacheEntry && cacheEntry.data) {
          return e.json(
            200,
            Object.assign({}, cacheEntry.data, {
              sobrescritas: sobrescritasMap,
              cached: true,
              stale: true,
              warning:
                'Nenhuma nova partida retornada pela Football-Data.org; mantendo último resultado válido.',
            }),
          )
        }
        return e.json(200, {
          configured: true,
          provider: 'football_data',
          live: [],
          dateFixtures: [],
          directFixtures: [],
          sobrescritas: sobrescritasMap,
          cached: false,
          warning: 'Nenhuma partida encontrada no Football-Data.org para os critérios informados.',
        })
      }

      var fdPayload = {
        configured: true,
        provider: 'football_data',
        live: fdResults.live,
        dateFixtures: fdResults.dateFixtures,
        directFixtures: fdResults.directFixtures,
        updatedAt: new Date().toISOString(),
      }

      // Só grava no cache se houver pelo menos 1 partida!
      if (cacheStore && totalFdMatches > 0) {
        cacheStore[cacheKey] = {
          timestamp: Date.now(),
          data: fdPayload,
          fetching: 0,
        }
      }

      return e.json(
        200,
        Object.assign({}, fdPayload, {
          sobrescritas: sobrescritasMap,
          cached: false,
        }),
      )
    }

    // -------------------------------------------------------------
    // PROVEDOR: TheSportsDB Selecionado Primariamente
    // -------------------------------------------------------------
    if (provedor === 'thesportsdb') {
      let liveFixtures = []
      let dateFixtures = []

      try {
        const resLive = $http.send({
          url:
            'https://www.thesportsdb.com/api/v1/json/' +
            encodeURIComponent(apiKey) +
            '/livescore.php?s=Soccer',
          method: 'GET',
          timeout: 8,
        })

        if (isRateLimitError(resLive.statusCode, resLive.json || resLive.raw)) {
          rateLimitDetected = true
        } else if (
          resLive.statusCode === 200 &&
          resLive.json &&
          Array.isArray(resLive.json.livescore)
        ) {
          liveFixtures = resLive.json.livescore.map(function (item) {
            const hScore = parseInt(item.intHomeScore, 10)
            const aScore = parseInt(item.intAwayScore, 10)
            const elapsed = parseInt(item.strProgress, 10)
            const st = (item.strStatus || 'LIVE').toUpperCase()

            var scorersList = []
            var parseTsdbDetails = function (detailStr, teamSide) {
              if (typeof detailStr !== 'string' || !detailStr.trim()) return
              var parts = detailStr.split(';')
              for (var pi = 0; pi < parts.length; pi++) {
                var rawPart = parts[pi].trim()
                if (!rawPart) continue
                var minMatch = rawPart.match(/(\d+)'?/)
                var extractedMin = minMatch ? parseInt(minMatch[1], 10) : null
                var nameClean = rawPart
                  .replace(/^\d+'?:?/, '')
                  .replace(/\s*\d+'?$/, '')
                  .trim()
                if (nameClean) {
                  scorersList.push({
                    name: nameClean,
                    minute: extractedMin,
                    teamSide: teamSide,
                  })
                }
              }
            }
            parseTsdbDetails(item.strHomeGoalDetails, 'home')
            parseTsdbDetails(item.strAwayGoalDetails, 'away')

            return {
              provider: 'thesportsdb',
              fixture: {
                id: item.idLiveScore || item.idEvent,
                date: item.strTimestamp || item.dateEvent,
                status: {
                  short: st === 'HT' || st === 'HALF TIME' ? 'HT' : st,
                  long: item.strStatus || 'Live',
                  elapsed: isNaN(elapsed) ? null : elapsed,
                },
              },
              teams: {
                home: {
                  id: item.idHomeTeam,
                  name: item.strHomeTeam || '',
                  logo: item.strHomeTeamBadge || '',
                },
                away: {
                  id: item.idAwayTeam,
                  name: item.strAwayTeam || '',
                  logo: item.strAwayTeamBadge || '',
                },
              },
              goals: {
                home: isNaN(hScore) ? null : hScore,
                away: isNaN(aScore) ? null : aScore,
              },
              scorers: scorersList,
            }
          })
        }
      } catch (errLive) {
        console.log('Aviso ao consultar live TheSportsDB:', errLive)
      }

      if (rateLimitDetected) {
        if (cacheEntry && cacheEntry.data) {
          return e.json(200, {
            configured: true,
            provider: 'thesportsdb',
            live: cacheEntry.data.live || [],
            dateFixtures: cacheEntry.data.dateFixtures || [],
            directFixtures: cacheEntry.data.directFixtures || [],
            sobrescritas: sobrescritasMap,
            cached: true,
            fallback: true,
            rate_limited: true,
            warning: rateLimitMessage,
          })
        }
        return e.json(200, {
          configured: true,
          provider: 'thesportsdb',
          live: [],
          dateFixtures: [],
          directFixtures: [],
          sobrescritas: sobrescritasMap,
          rate_limited: true,
          error: rateLimitMessage,
        })
      }

      var totalTsdb = liveFixtures.length + dateFixtures.length
      if (totalTsdb === 0) {
        console.log('[Aviso Cache] TheSportsDB retornou 0 partidas. Não gravando no cache.')
        if (cacheEntry && cacheEntry.data) {
          return e.json(
            200,
            Object.assign({}, cacheEntry.data, {
              sobrescritas: sobrescritasMap,
              cached: true,
              stale: true,
            }),
          )
        }
      }

      var tsdbPayload = {
        configured: true,
        provider: 'thesportsdb',
        live: liveFixtures,
        dateFixtures: dateFixtures,
        directFixtures: [],
        updatedAt: new Date().toISOString(),
      }

      // Só grava no cache se houver pelo menos 1 partida!
      if (cacheStore && totalTsdb > 0) {
        cacheStore[cacheKey] = {
          timestamp: Date.now(),
          data: tsdbPayload,
          fetching: 0,
        }
      }

      return e.json(
        200,
        Object.assign({}, tsdbPayload, {
          sobrescritas: sobrescritasMap,
          cached: false,
        }),
      )
    }

    // -------------------------------------------------------------
    // PROVEDOR 3: API-Football (Principal) com CONTINGÊNCIA AUTOMÁTICA
    // -------------------------------------------------------------
    const isRapidApi =
      ($secrets.has && $secrets.has('RAPIDAPI_KEY')) ||
      Boolean($os.getenv('RAPIDAPI_KEY')) ||
      apiKey.length > 40

    let urlLive = 'https://v3.football.api-sports.io/fixtures?live=all&timezone=America%2FSao_Paulo'
    let headers = {
      'x-apisports-key': apiKey,
    }

    if (isRapidApi) {
      urlLive =
        'https://api-football-v1.p.rapidapi.com/v3/fixtures?live=all&timezone=America%2FSao_Paulo'
      headers = {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': 'api-football-v1.p.rapidapi.com',
      }
    }

    // Helper interno para converter fixtures da API-Football
    var mapApiFootballItem = function (item) {
      var scorersList = []
      if (Array.isArray(item.events)) {
        for (var ei = 0; ei < item.events.length; ei++) {
          var ev = item.events[ei]
          if (ev && ev.type === 'Goal' && ev.player && ev.player.name) {
            var isOwnGoal = ev.detail && ev.detail.toLowerCase().indexOf('own') !== -1
            var scorerNameStr = String(ev.player.name).trim()
            if (isOwnGoal) {
              scorerNameStr += ' (contra)'
            }
            scorersList.push({
              name: scorerNameStr,
              minute: ev.time ? ev.time.elapsed : null,
              teamId: ev.team ? ev.team.id : null,
              teamName: ev.team ? ev.team.name : null,
              teamSide:
                item.teams && item.teams.home && ev.team && ev.team.id === item.teams.home.id
                  ? 'home'
                  : item.teams && item.teams.away && ev.team && ev.team.id === item.teams.away.id
                    ? 'away'
                    : null,
            })
          }
        }
      }

      return {
        provider: 'api_football',
        fixture: item.fixture,
        teams: item.teams,
        goals: item.goals,
        score: item.score,
        events: item.events,
        scorers: scorersList,
      }
    }

    var directFixtures = []
    var seenDirectIds = {}

    // Executa busca direta de fixtures com proteção contra 429 e timeout curto (8s)
    for (var fxi = 0; fxi < directFixtureIds.length; fxi++) {
      var targetFixtureId = directFixtureIds[fxi]
      if (!targetFixtureId || seenDirectIds[targetFixtureId]) continue

      var baseDirectUrl = isRapidApi
        ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures'
        : 'https://v3.football.api-sports.io/fixtures'
      var urlDirect =
        baseDirectUrl +
        '?id=' +
        encodeURIComponent(targetFixtureId) +
        '&timezone=America%2FSao_Paulo'

      try {
        var resDirect = $http.send({
          url: urlDirect,
          method: 'GET',
          headers: headers,
          timeout: 8,
        })

        if (isRateLimitError(resDirect.statusCode, resDirect.json || resDirect.raw)) {
          rateLimitDetected = true
          break
        }

        if (
          resDirect.statusCode === 200 &&
          resDirect.json &&
          Array.isArray(resDirect.json.response)
        ) {
          for (var dri = 0; dri < resDirect.json.response.length; dri++) {
            var directItem = resDirect.json.response[dri]
            var parsedDirect = mapApiFootballItem(directItem)
            var actualId =
              directItem.fixture && directItem.fixture.id
                ? String(directItem.fixture.id)
                : targetFixtureId
            seenDirectIds[actualId] = true
            directFixtures.push(parsedDirect)
          }
        }
      } catch (errDirect) {
        console.log('Aviso ao consultar fixture_id direto (' + targetFixtureId + '):', errDirect)
      }
    }

    let liveFixtures = []
    if (!rateLimitDetected) {
      try {
        const resLive = $http.send({
          url: urlLive,
          method: 'GET',
          headers: headers,
          timeout: 8,
        })

        if (isRateLimitError(resLive.statusCode, resLive.json || resLive.raw)) {
          rateLimitDetected = true
        } else if (
          resLive.statusCode === 200 &&
          resLive.json &&
          Array.isArray(resLive.json.response)
        ) {
          liveFixtures = resLive.json.response.map(mapApiFootballItem)
        }
      } catch (errLive) {
        console.log('Aviso ao consultar live fixtures API-Football:', errLive)
      }
    }

    let dateFixtures = []
    if (!rateLimitDetected && dateQuery && /^\d{4}-\d{2}-\d{2}$/.test(dateQuery)) {
      var baseUrlDate = isRapidApi
        ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures'
        : 'https://v3.football.api-sports.io/fixtures'
      var urlDate =
        baseUrlDate + '?date=' + encodeURIComponent(dateQuery) + '&timezone=America%2FSao_Paulo'

      try {
        var resDate = $http.send({
          url: urlDate,
          method: 'GET',
          headers: headers,
          timeout: 8,
        })

        if (isRateLimitError(resDate.statusCode, resDate.json || resDate.raw)) {
          rateLimitDetected = true
        } else if (
          resDate.statusCode === 200 &&
          resDate.json &&
          Array.isArray(resDate.json.response)
        ) {
          for (var ri = 0; ri < resDate.json.response.length; ri++) {
            dateFixtures.push(mapApiFootballItem(resDate.json.response[ri]))
          }
        }
      } catch (errDate) {
        console.log('Aviso ao consultar date fixtures API-Football:', errDate)
      }
    }

    // -------------------------------------------------------------
    // CONTINGÊNCIA AUTOMÁTICA SE A API-FOOTBALL ESTOUROU A COTA (429)
    // Se rateLimitDetected for verdadeiro, tenta AUTOMATICAMENTE a
    // Football-Data.org com a chave de contingência antes de falhar
    // -------------------------------------------------------------
    if (rateLimitDetected) {
      console.log('[Contingência] API-Football atingiu cota (429). Acionando Football-Data.org...')
      var contingencyKey = fallbackApiKey || ''
      if (contingencyKey) {
        var fallbackFdData = fetchFootballDataFixtures(contingencyKey, dateQuery, directFixtureIds)

        // Se a Football-Data.org funcionou e não estourou cota
        if (
          !fallbackFdData.rateLimited &&
          (fallbackFdData.live.length > 0 ||
            fallbackFdData.dateFixtures.length > 0 ||
            fallbackFdData.directFixtures.length > 0)
        ) {
          var fbPayload = {
            configured: true,
            provider: 'football_data',
            fallback_active: true,
            original_provider: 'api_football',
            message: 'Contingência ativada: dados providos via Football-Data.org.',
            directFixtures: fallbackFdData.directFixtures,
            live: fallbackFdData.live,
            dateFixtures: fallbackFdData.dateFixtures,
            updatedAt: new Date().toISOString(),
          }

          if (cacheStore) {
            cacheStore[cacheKey] = {
              timestamp: Date.now(),
              data: fbPayload,
              fetching: 0,
            }
          }

          return e.json(
            200,
            Object.assign({}, fbPayload, {
              sobrescritas: sobrescritasMap,
              cached: false,
            }),
          )
        }
      }

      // Se Football-Data.org também falhou por cota ou não há chave
      if (cacheEntry && cacheEntry.data) {
        return e.json(200, {
          configured: true,
          provider: 'api_football',
          directFixtures: cacheEntry.data.directFixtures || [],
          live: cacheEntry.data.live || [],
          dateFixtures: cacheEntry.data.dateFixtures || [],
          sobrescritas: sobrescritasMap,
          cached: true,
          fallback: true,
          rate_limited: true,
          warning: rateLimitMessage,
        })
      }
      return e.json(200, {
        configured: true,
        provider: 'api_football',
        directFixtures: [],
        live: [],
        dateFixtures: [],
        sobrescritas: sobrescritasMap,
        rate_limited: true,
        error: rateLimitMessage,
      })
    }

    var totalApiFootball = directFixtures.length + liveFixtures.length + dateFixtures.length

    // REGRA DE OURO: "Se a API retornar 0 partidas ou erro, NUNCA grave esse resultado no cache."
    if (totalApiFootball === 0) {
      console.log(
        '[Aviso Cache] API-Football retornou 0 partidas. Não gravando no cache e preservando anterior.',
      )
      if (cacheEntry && cacheEntry.data) {
        var existingTotal =
          (Array.isArray(cacheEntry.data.live) ? cacheEntry.data.live.length : 0) +
          (Array.isArray(cacheEntry.data.dateFixtures) ? cacheEntry.data.dateFixtures.length : 0) +
          (Array.isArray(cacheEntry.data.directFixtures)
            ? cacheEntry.data.directFixtures.length
            : 0)
        if (existingTotal > 0) {
          return e.json(
            200,
            Object.assign({}, cacheEntry.data, {
              sobrescritas: sobrescritasMap,
              cached: true,
              stale: true,
              warning: 'API retornou 0 partidas; mantendo último resultado válido em cache.',
            }),
          )
        }
      }

      // Se não havia cache anterior, tenta contingência antes de entregar vazio
      if (fallbackApiKey) {
        var tryFb = fetchFootballDataFixtures(fallbackApiKey, dateQuery, directFixtureIds)
        var tryFbTotal =
          (tryFb.live ? tryFb.live.length : 0) +
          (tryFb.dateFixtures ? tryFb.dateFixtures.length : 0) +
          (tryFb.directFixtures ? tryFb.directFixtures.length : 0)
        if (tryFbTotal > 0) {
          var fbP = {
            configured: true,
            provider: 'football_data',
            fallback_active: true,
            original_provider: 'api_football',
            message: 'Contingência ativada: dados providos via Football-Data.org.',
            directFixtures: tryFb.directFixtures,
            live: tryFb.live,
            dateFixtures: tryFb.dateFixtures,
            updatedAt: new Date().toISOString(),
          }
          if (cacheStore) {
            cacheStore[cacheKey] = {
              timestamp: Date.now(),
              data: fbP,
              fetching: 0,
            }
          }
          return e.json(
            200,
            Object.assign({}, fbP, { sobrescritas: sobrescritasMap, cached: false }),
          )
        }
      }
    }

    var apiFootballPayload = {
      configured: true,
      provider: 'api_football',
      directFixtures: directFixtures,
      live: liveFixtures,
      dateFixtures: dateFixtures,
      updatedAt: new Date().toISOString(),
    }

    // Só grava no cache se houver pelo menos 1 partida!
    if (cacheStore && totalApiFootball > 0) {
      cacheStore[cacheKey] = {
        timestamp: Date.now(),
        data: apiFootballPayload,
        fetching: 0,
      }
    }

    return e.json(
      200,
      Object.assign({}, apiFootballPayload, {
        sobrescritas: sobrescritasMap,
        cached: false,
      }),
    )
  } catch (err) {
    console.log('Aviso ao consultar placar ao vivo:', err ? err.message : err)
    return e.json(200, {
      configured: true,
      provider: 'api_football',
      directFixtures: [],
      live: [],
      dateFixtures: [],
      sobrescritas: {},
      error: 'Instabilidade momentânea ao consultar partidas. O sistema tentará novamente.',
    })
  }
})

// -------------------------------------------------------------
// GET /backend/v1/jogos-do-dia
// -------------------------------------------------------------
routerAdd('GET', '/backend/v1/jogos-do-dia', (e) => {
  try {
    var dateQuery = (e.requestInfo().query.date || '').trim()
    var forceRefresh = e.requestInfo().query.refresh === '1'

    // Formato de data padrão YYYY-MM-DD no fuso de Brasília (UTC-3)
    if (!dateQuery || !/^\d{4}-\d{2}-\d{2}$/.test(dateQuery)) {
      var now = new Date(Date.now() - 3 * 3600 * 1000)
      var ym = ('0' + (now.getUTCMonth() + 1)).slice(-2)
      var yd = ('0' + now.getUTCDate()).slice(-2)
      dateQuery = now.getUTCFullYear() + '-' + ym + '-' + yd
    }

    // Inicializa store global de cache de jogos do dia
    if (typeof globalThis !== 'undefined' && !globalThis.__jogosDoDiaStore) {
      globalThis.__jogosDoDiaStore = {}
    }
    var dayStore = typeof globalThis !== 'undefined' ? globalThis.__jogosDoDiaStore : null
    var dayEntry = dayStore ? dayStore[dateQuery] : null
    var nowMs = Date.now()
    var cacheAgeMs = dayEntry ? nowMs - dayEntry.timestamp : 999999999

    var entryHasLive = Boolean(dayEntry && dayEntry.payload && dayEntry.payload.hasLive === true)
    // TTL OBRIGATÓRIO: Topo da faixa (~30 minutos para o calendário; 5 min enquanto houver jogo "Ao Vivo")
    var maxAgeMs = entryHasLive ? 5 * 60 * 1000 : 30 * 60 * 1000

    // REGRA DE ON-DEMAND FETCHING E CARREGAMENTO PASSIVO:
    // Carregamento passivo da página deve servir SEMPRE do cache interno do servidor se válido.
    // O botão Atualizar (forceRefresh) pode forçar revalidação apenas quando o TTL já expirou;
    // se o TTL ainda estiver válido, mostra os dados em cache imediatamente.
    // CRÍTICO: Se o cache estiver corrompido com 0 jogos (resultado de falha anterior), NÃO serve dele e força revalidação!
    if (dayEntry && dayEntry.payload) {
      var cachedFixturesCount = Array.isArray(dayEntry.payload.fixtures)
        ? dayEntry.payload.fixtures.length
        : 0
      if (cachedFixturesCount > 0) {
        if (!forceRefresh || cacheAgeMs < maxAgeMs) {
          var cachedResp = Object.assign({}, dayEntry.payload, {
            cached: true,
            cacheAgeSeconds: Math.round(cacheAgeMs / 1000),
            ttlSeconds: Math.round(maxAgeMs / 1000),
            ttlRemainingSeconds: Math.max(0, Math.round((maxAgeMs - cacheAgeMs) / 1000)),
          })
          return e.json(200, cachedResp)
        }
      } else {
        console.log(
          '[Cache Jogos-do-Dia] Cache continha 0 partidas (contaminado). Descartando e buscando novamente da API.',
        )
      }
    }

    // Deduplicação de requisições externas para o mesmo dia (janela mínima de 10s)
    if (dayEntry && dayEntry.fetching && nowMs - dayEntry.fetching < 10000) {
      if (dayEntry.payload) {
        var dedupResp = Object.assign({}, dayEntry.payload, {
          cached: true,
          deduplicated: true,
          cacheAgeSeconds: Math.round(cacheAgeMs / 1000),
          ttlSeconds: Math.round(maxAgeMs / 1000),
        })
        return e.json(200, dedupResp)
      }
    }

    // Marca início de fetch para evitar que múltiplas abas chamem a API externa ao mesmo tempo
    if (dayStore) {
      if (!dayStore[dateQuery]) {
        dayStore[dateQuery] = { timestamp: 0, payload: null, fetching: nowMs }
      } else {
        dayStore[dateQuery].fetching = nowMs
      }
    }

    // Buscar credenciais configuradas (primária e contingência)
    var provedor = 'api_football'
    var apiKey = ''
    var fallbackApiKey = ''
    var isRapidApi = false
    try {
      var configRecord = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
      if (configRecord) {
        provedor = configRecord.getString('provedor') || 'api_football'
        apiKey = (configRecord.getString('api_key') || '').trim()
      }
    } catch (_) {}

    try {
      var fallbackRecord = $app.findFirstRecordByData(
        'config_integracoes',
        'chave',
        'football_data_fallback',
      )
      if (fallbackRecord) {
        fallbackApiKey = (fallbackRecord.getString('api_key') || '').trim()
      }
    } catch (_) {}

    if (!fallbackApiKey) {
      try {
        fallbackApiKey =
          ($secrets.has && $secrets.has('FOOTBALL_DATA_KEY')
            ? $secrets.get('FOOTBALL_DATA_KEY')
            : '') ||
          $os.getenv('FOOTBALL_DATA_KEY') ||
          ''
      } catch (_) {}
    }

    if (!apiKey) {
      if ($secrets.has && $secrets.has('API_FOOTBALL_KEY')) {
        apiKey = $secrets.get('API_FOOTBALL_KEY')
      } else if ($secrets.has && $secrets.has('RAPIDAPI_KEY')) {
        apiKey = $secrets.get('RAPIDAPI_KEY')
        isRapidApi = true
      } else if ($os.getenv('API_FOOTBALL_KEY')) {
        apiKey = $os.getenv('API_FOOTBALL_KEY')
      } else if ($os.getenv('RAPIDAPI_KEY')) {
        apiKey = $os.getenv('RAPIDAPI_KEY')
        isRapidApi = true
      }
    }

    if (apiKey.length > 40) {
      isRapidApi = true
    }

    if (!apiKey && !fallbackApiKey) {
      return e.json(200, {
        configured: false,
        date: dateQuery,
        fixtures: [],
        message: 'API de futebol não configurada pelo administrador.',
      })
    }

    var isRateLimitErrorDay = function (statusCode, responseBody) {
      if (statusCode === 429) return true
      if (!responseBody) return false
      var strBody = ''
      try {
        strBody = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody)
      } catch (_) {
        strBody = String(responseBody)
      }
      strBody = strBody.toLowerCase()
      if (
        strBody.indexOf('requests limit reached') !== -1 ||
        strBody.indexOf('request limit reached') !== -1 ||
        strBody.indexOf('rate limit') !== -1 ||
        strBody.indexOf('plan reached') !== -1 ||
        strBody.indexOf('too many requests') !== -1 ||
        strBody.indexOf('quota exceeded') !== -1 ||
        strBody.indexOf('exceeded the maximum') !== -1 ||
        strBody.indexOf('free-tier limit') !== -1
      ) {
        return true
      }
      return false
    }

    var rateLimitMessage =
      'Dados ao vivo temporariamente indisponíveis (limite de requisições excedido). Tente novamente mais tarde.'

    var allFixtures = null
    var rateLimitHit = false

    // Função interna para normalizar dados do Football-Data.org para jogos-do-dia
    var parseFootballDataToDayFixtures = function (fdMatches) {
      var convertedFixtures = []
      var hasLiveMatchFD = false

      for (var fdi = 0; fdi < fdMatches.length; fdi++) {
        var m = fdMatches[fdi]
        var homeScore = m.score && m.score.fullTime ? m.score.fullTime.home : null
        var awayScore = m.score && m.score.fullTime ? m.score.fullTime.away : null
        var htHome = m.score && m.score.halfTime ? m.score.halfTime.home : null
        var htAway = m.score && m.score.halfTime ? m.score.halfTime.away : null

        var stShort =
          m.status === 'PAUSED'
            ? 'HT'
            : m.status === 'IN_PLAY'
              ? '1H'
              : m.status === 'FINISHED'
                ? 'FT'
                : m.status
        var isLive =
          ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'IN_PLAY', 'PAUSED'].indexOf(stShort) !== -1
        if (isLive) hasLiveMatchFD = true

        var scorersListFD = []
        if (Array.isArray(m.goals)) {
          for (var gi = 0; gi < m.goals.length; gi++) {
            var g = m.goals[gi]
            var scorerName = (g.scorer && (g.scorer.name || g.scorer.shortName)) || ''
            var isOwnGoal = (g.type || '').toUpperCase() === 'OWN'
            if (scorerName && isOwnGoal) scorerName += ' (contra)'
            if (scorerName) {
              scorersListFD.push({
                name: scorerName,
                minute: g.minute || null,
                extraMinute: null,
                teamId: g.team ? g.team.id : null,
                teamName: g.team ? g.team.name || g.team.shortName : null,
                teamSide:
                  m.homeTeam && g.team && g.team.id === m.homeTeam.id
                    ? 'home'
                    : m.awayTeam && g.team && g.team.id === m.awayTeam.id
                      ? 'away'
                      : null,
              })
            }
          }
        }

        var compCode = (m.competition && m.competition.code) || ''
        var compName = (m.competition && m.competition.name) || ''
        var compId = (m.competition && m.competition.id) || 1000 + fdi

        var region = 'Outros'
        if (
          compCode === 'BSA' ||
          compName.indexOf('Brasileiro') !== -1 ||
          compName.indexOf('Serie A') !== -1
        ) {
          region = 'Brasileirão & Copas'
          compId = 71
        } else if (compCode === 'CL' || compName.indexOf('Champions') !== -1) {
          region = 'Futebol Europeu'
          compId = 2
        } else if (compCode === 'EL' || compName.indexOf('Europa League') !== -1) {
          region = 'Futebol Europeu'
          compId = 3
        } else if (compCode === 'PL' || compName.indexOf('Premier') !== -1) {
          region = 'Futebol Europeu'
          compId = 39
        } else if (
          compCode === 'PD' ||
          compName.indexOf('La Liga') !== -1 ||
          compName.indexOf('Primera') !== -1
        ) {
          region = 'Futebol Europeu'
          compId = 140
        } else if (compCode === 'SA' || compName.indexOf('Serie A') !== -1) {
          region = 'Futebol Europeu'
          compId = 135
        } else if (compCode === 'BL1' || compName.indexOf('Bundesliga') !== -1) {
          region = 'Futebol Europeu'
          compId = 78
        } else if (compCode === 'FL1' || compName.indexOf('Ligue 1') !== -1) {
          region = 'Futebol Europeu'
          compId = 61
        } else if (compCode === 'CLI' || compName.indexOf('Libertadores') !== -1) {
          region = 'Sul-Americana'
          compId = 13
        }

        convertedFixtures.push({
          fixture: {
            id: m.id,
            date: m.utcDate,
            timestamp: Math.floor(new Date(m.utcDate).getTime() / 1000),
            status: {
              short: stShort,
              long: m.status,
              elapsed: m.minute || null,
            },
          },
          league: {
            id: compId,
            name: compName || 'Competição Externa',
            country: (m.area && m.area.name) || '',
            logo: (m.competition && m.competition.emblem) || '',
            flag: (m.area && m.area.flag) || '',
            round: m.matchday ? 'Rodada ' + m.matchday : '',
            region: region,
          },
          teams: {
            home: {
              id: m.homeTeam ? m.homeTeam.id : 0,
              name: (m.homeTeam && (m.homeTeam.name || m.homeTeam.shortName)) || '',
              logo: (m.homeTeam && m.homeTeam.crest) || '',
              country: (m.area && m.area.name) || '',
            },
            away: {
              id: m.awayTeam ? m.awayTeam.id : 0,
              name: (m.awayTeam && (m.awayTeam.name || m.awayTeam.shortName)) || '',
              logo: (m.awayTeam && m.awayTeam.crest) || '',
              country: (m.area && m.area.name) || '',
            },
          },
          goals: {
            home: typeof homeScore === 'number' ? homeScore : null,
            away: typeof awayScore === 'number' ? awayScore : null,
          },
          score: {
            halftime: { home: htHome, away: htAway },
            fulltime: { home: homeScore, away: awayScore },
          },
          scorers: scorersListFD,
          isLive: isLive,
        })
      }

      return { fixtures: convertedFixtures, hasLive: hasLiveMatchFD }
    }

    // Se FOOTBALL_DATA for o provedor principal selecionado
    if (provedor === 'football_data') {
      var fdPrimaryToken = apiKey || fallbackApiKey
      if (fdPrimaryToken) {
        try {
          var pFD1 = dateQuery.split('-')
          var yFD1 = parseInt(pFD1[0], 10)
          var mFD1 = parseInt(pFD1[1], 10) - 1
          var dFD1 = parseInt(pFD1[2], 10)

          var prevFD1 = new Date(Date.UTC(yFD1, mFD1, dFD1 - 1))
          var dateFrom1 =
            prevFD1.getUTCFullYear() +
            '-' +
            ('0' + (prevFD1.getUTCMonth() + 1)).slice(-2) +
            '-' +
            ('0' + prevFD1.getUTCDate()).slice(-2)
          var nextFD1 = new Date(Date.UTC(yFD1, mFD1, dFD1 + 1))
          var dateTo1 =
            nextFD1.getUTCFullYear() +
            '-' +
            ('0' + (nextFD1.getUTCMonth() + 1)).slice(-2) +
            '-' +
            ('0' + nextFD1.getUTCDate()).slice(-2)

          var resFDPrimary = $http.send({
            url:
              'https://api.football-data.org/v4/matches?dateFrom=' +
              encodeURIComponent(dateFrom1) +
              '&dateTo=' +
              encodeURIComponent(dateTo1),
            method: 'GET',
            headers: { 'X-Auth-Token': fdPrimaryToken },
            timeout: 8,
          })

          if (isRateLimitErrorDay(resFDPrimary.statusCode, resFDPrimary.json || resFDPrimary.raw)) {
            rateLimitHit = true
          } else if (
            resFDPrimary.statusCode === 200 &&
            resFDPrimary.json &&
            Array.isArray(resFDPrimary.json.matches)
          ) {
            var parsedFD = parseFootballDataToDayFixtures(resFDPrimary.json.matches)

            // REGRA: Se retornar 0 partidas, NUNCA grave no cache
            if (parsedFD.fixtures.length > 0) {
              var fdPrimaryPayload = {
                configured: true,
                provider: 'football_data',
                date: dateQuery,
                total: parsedFD.fixtures.length,
                hasLive: parsedFD.hasLive,
                fixtures: parsedFD.fixtures,
                updatedAt: new Date().toISOString(),
              }

              if (dayStore) {
                dayStore[dateQuery] = {
                  timestamp: Date.now(),
                  payload: fdPrimaryPayload,
                  fetching: 0,
                }
              }

              return e.json(
                200,
                Object.assign({}, fdPrimaryPayload, {
                  cached: false,
                  ttlSeconds: Math.round(
                    (parsedFD.hasLive ? 5 * 60 * 1000 : 30 * 60 * 1000) / 1000,
                  ),
                }),
              )
            } else {
              console.log(
                '[Aviso Jogos-do-Dia] Football-Data.org retornou 0 partidas. Não gravando array vazio no cache.',
              )
              // Se temos cache anterior válido, usa-o
              if (
                dayEntry &&
                dayEntry.payload &&
                Array.isArray(dayEntry.payload.fixtures) &&
                dayEntry.payload.fixtures.length > 0
              ) {
                return e.json(
                  200,
                  Object.assign({}, dayEntry.payload, {
                    cached: true,
                    stale: true,
                    warning:
                      'Football-Data.org retornou 0 partidas; mantendo dados anteriores em cache.',
                  }),
                )
              }
              // Tenta API-Football como contingência reversa se houver chave
              var altApiKey = ''
              try {
                altApiKey =
                  ($secrets.has && $secrets.has('API_FOOTBALL_KEY')
                    ? $secrets.get('API_FOOTBALL_KEY')
                    : '') ||
                  ($secrets.has && $secrets.has('RAPIDAPI_KEY')
                    ? $secrets.get('RAPIDAPI_KEY')
                    : '') ||
                  $os.getenv('API_FOOTBALL_KEY') ||
                  $os.getenv('RAPIDAPI_KEY') ||
                  ''
              } catch (_) {}
              if (!altApiKey && apiKey && apiKey !== fdPrimaryToken) {
                altApiKey = apiKey
              }
              if (altApiKey) {
                console.log(
                  '[Contingência Reversa] Football-Data.org retornou 0 partidas. Tentando API-Football...',
                )
                // Permite seguir para API-Football abaixo
              } else {
                return e.json(200, {
                  configured: true,
                  provider: 'football_data',
                  date: dateQuery,
                  total: 0,
                  hasLive: false,
                  fixtures: [],
                  cached: false,
                  warning: 'Nenhuma partida encontrada no Football-Data.org para a data.',
                })
              }
            }
          }
        } catch (errFDPrimary) {
          console.log('Erro ao consultar Football-Data.org como primário:', errFDPrimary)
        }
      }
    }

    // Se API-Football é primária (ou contingência de Football-Data)
    var apiFootballKey = apiKey
    if (provedor === 'football_data') {
      // Se football_data é principal, tenta buscar chave alternativa de API-Football
      try {
        var altKey =
          ($secrets.has && $secrets.has('API_FOOTBALL_KEY')
            ? $secrets.get('API_FOOTBALL_KEY')
            : '') ||
          ($secrets.has && $secrets.has('RAPIDAPI_KEY') ? $secrets.get('RAPIDAPI_KEY') : '') ||
          $os.getenv('API_FOOTBALL_KEY') ||
          $os.getenv('RAPIDAPI_KEY') ||
          ''
        if (altKey) apiFootballKey = altKey
      } catch (_) {}
    }

    if (apiFootballKey && apiFootballKey !== fallbackApiKey) {
      var baseUrl = isRapidApi
        ? 'https://api-football-v1.p.rapidapi.com/v3/fixtures'
        : 'https://v3.football.api-sports.io/fixtures'

      var headers = isRapidApi
        ? {
            'x-rapidapi-key': apiFootballKey,
            'x-rapidapi-host': 'api-football-v1.p.rapidapi.com',
          }
        : {
            'x-apisports-key': apiFootballKey,
          }

      var callUrl =
        baseUrl + '?date=' + encodeURIComponent(dateQuery) + '&timezone=America%2FSao_Paulo'

      try {
        var resp = $http.send({
          url: callUrl,
          method: 'GET',
          headers: headers,
          timeout: 8,
        })

        if (isRateLimitErrorDay(resp.statusCode, resp.json || resp.raw)) {
          rateLimitHit = true
        } else if (
          resp &&
          resp.statusCode === 200 &&
          resp.json &&
          Array.isArray(resp.json.response)
        ) {
          allFixtures = resp.json.response
        }
      } catch (eH) {
        console.log('Aviso ao consultar data ' + dateQuery + ' na API-Football:', eH)
      }
    } else {
      rateLimitHit = true
    }

    // -------------------------------------------------------------
    // CONTINGÊNCIA AUTOMÁTICA EM JOGOS DO DIA: Football-Data.org
    // -------------------------------------------------------------
    var contingencyUsed = false
    if ((rateLimitHit || !allFixtures || allFixtures.length === 0) && fallbackApiKey) {
      console.log(
        '[Contingência Jogos-do-Dia] API-Football indisponível ou sem partidas. Acionando Football-Data.org...',
      )
      try {
        var pFD = dateQuery.split('-')
        var yFD = parseInt(pFD[0], 10)
        var mFD = parseInt(pFD[1], 10) - 1
        var dFD = parseInt(pFD[2], 10)

        var prevFD = new Date(Date.UTC(yFD, mFD, dFD - 1))
        var prevFDM = ('0' + (prevFD.getUTCMonth() + 1)).slice(-2)
        var prevFDD = ('0' + prevFD.getUTCDate()).slice(-2)
        var dateFrom = prevFD.getUTCFullYear() + '-' + prevFDM + '-' + prevFDD

        var nextFD = new Date(Date.UTC(yFD, mFD, dFD + 1))
        var nextFDM = ('0' + (nextFD.getUTCMonth() + 1)).slice(-2)
        var nextFDD = ('0' + nextFD.getUTCDate()).slice(-2)
        var dateTo = nextFD.getUTCFullYear() + '-' + nextFDM + '-' + nextFDD

        var resFD = $http.send({
          url:
            'https://api.football-data.org/v4/matches?dateFrom=' +
            encodeURIComponent(dateFrom) +
            '&dateTo=' +
            encodeURIComponent(dateTo),
          method: 'GET',
          headers: { 'X-Auth-Token': fallbackApiKey },
          timeout: 8,
        })

        if (isRateLimitErrorDay(resFD.statusCode, resFD.json || resFD.raw)) {
          rateLimitHit = true
        } else if (resFD.statusCode === 200 && resFD.json && Array.isArray(resFD.json.matches)) {
          var parsedContingency = parseFootballDataToDayFixtures(resFD.json.matches)

          if (parsedContingency.fixtures.length > 0) {
            contingencyUsed = true
            var fdPayload = {
              configured: true,
              provider: 'football_data',
              fallback_active: true,
              original_provider: 'api_football',
              message: 'Contingência ativada: jogos providos via Football-Data.org.',
              date: dateQuery,
              total: parsedContingency.fixtures.length,
              hasLive: parsedContingency.hasLive,
              fixtures: parsedContingency.fixtures,
              updatedAt: new Date().toISOString(),
            }

            // Grava no cache se houver pelo menos 1 partida!
            if (dayStore) {
              dayStore[dateQuery] = {
                timestamp: Date.now(),
                payload: fdPayload,
                fetching: 0,
              }
            }

            return e.json(
              200,
              Object.assign({}, fdPayload, {
                cached: false,
                ttlSeconds: Math.round(
                  (parsedContingency.hasLive ? 5 * 60 * 1000 : 30 * 60 * 1000) / 1000,
                ),
              }),
            )
          }
        }
      } catch (eFD) {
        console.log('Aviso ao consultar contingência Football-Data.org em jogos-do-dia:', eFD)
      }
    }

    // Tratamento Gracioso se cota excedida e sem contingência funcional
    if (rateLimitHit && !contingencyUsed) {
      if (dayEntry && dayEntry.payload) {
        var fallbackResp = Object.assign({}, dayEntry.payload, {
          cached: true,
          fallback: true,
          rate_limited: true,
          warning: rateLimitMessage,
          cacheAgeSeconds: Math.round(cacheAgeMs / 1000),
          ttlSeconds: Math.round(maxAgeMs / 1000),
        })
        return e.json(200, fallbackResp)
      }

      return e.json(200, {
        configured: true,
        date: dateQuery,
        total: 0,
        hasLive: false,
        fixtures: [],
        rate_limited: true,
        error: rateLimitMessage,
      })
    }

    // Se falhou e temos cache antigo, entrega stale
    if (!allFixtures) {
      if (dayEntry && dayEntry.payload) {
        var prevTotal = Array.isArray(dayEntry.payload.fixtures)
          ? dayEntry.payload.fixtures.length
          : 0
        if (prevTotal > 0) {
          var staleResp = Object.assign({}, dayEntry.payload, {
            cached: true,
            fallback: true,
            cacheAgeSeconds: Math.round(cacheAgeMs / 1000),
          })
          return e.json(200, staleResp)
        }
      }

      return e.json(200, {
        configured: true,
        date: dateQuery,
        total: 0,
        hasLive: false,
        fixtures: [],
        error:
          'A API externa de futebol está temporariamente instável ou indisponível. Tente novamente em instantes.',
      })
    }

    var rawFixtures = []
    var hasLiveMatch = false
    var seenFixtureIds = {}

    for (var i = 0; i < allFixtures.length; i++) {
      var item = allFixtures[i]
      var fId = (item.fixture && item.fixture.id) || i
      if (seenFixtureIds[fId]) continue
      seenFixtureIds[fId] = true

      var statusShort = (item.fixture && item.fixture.status && item.fixture.status.short) || ''
      var isLive = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE'].indexOf(statusShort) !== -1
      if (isLive) {
        hasLiveMatch = true
      }

      var scorersList = []
      if (Array.isArray(item.events)) {
        for (var ei = 0; ei < item.events.length; ei++) {
          var ev = item.events[ei]
          if (ev && ev.type === 'Goal' && ev.player && ev.player.name) {
            var isOwnGoal = ev.detail && ev.detail.toLowerCase().indexOf('own') !== -1
            var scorerNameStr = String(ev.player.name).trim()
            if (isOwnGoal) {
              scorerNameStr += ' (contra)'
            }
            scorersList.push({
              name: scorerNameStr,
              minute: ev.time ? ev.time.elapsed : null,
              extraMinute: ev.time ? ev.time.extra : null,
              teamId: ev.team ? ev.team.id : null,
              teamName: ev.team ? ev.team.name : null,
              teamSide:
                item.teams && item.teams.home && ev.team && ev.team.id === item.teams.home.id
                  ? 'home'
                  : item.teams && item.teams.away && ev.team && ev.team.id === item.teams.away.id
                    ? 'away'
                    : null,
            })
          }
        }
      }

      var leagueId = item.league ? item.league.id : null
      var region = 'Outros'
      if (
        leagueId === 71 ||
        leagueId === 72 ||
        leagueId === 73 ||
        leagueId === 74 ||
        leagueId === 75 ||
        leagueId === 76
      ) {
        region = 'Brasileirão & Copas'
      } else if (leagueId === 13 || leagueId === 11 || leagueId === 450) {
        region = 'Sul-Americana'
      } else if (
        leagueId === 2 ||
        leagueId === 3 ||
        leagueId === 848 ||
        leagueId === 39 ||
        leagueId === 140 ||
        leagueId === 135 ||
        leagueId === 78 ||
        leagueId === 61 ||
        leagueId === 45 ||
        leagueId === 48 ||
        leagueId === 143 ||
        leagueId === 137 ||
        leagueId === 81 ||
        leagueId === 66
      ) {
        region = 'Futebol Europeu'
      }

      rawFixtures.push({
        fixture: item.fixture,
        league: {
          id: item.league ? item.league.id : null,
          name: item.league ? item.league.name : '',
          country: item.league ? item.league.country : '',
          logo: item.league ? item.league.logo : '',
          flag: item.league ? item.league.flag : '',
          round: item.league ? item.league.round : '',
          region: region,
        },
        teams: item.teams,
        goals: item.goals,
        score: item.score,
        scorers: scorersList,
        isLive: isLive,
      })
    }

    // REGRA DE OURO: "Se a API retornar 0 partidas ou erro, NUNCA grave esse resultado no cache."
    if (rawFixtures.length === 0) {
      console.log(
        '[Aviso Jogos-do-Dia] API retornou 0 partidas. Não gravando no cache e mantendo anterior se houver.',
      )
      if (
        dayEntry &&
        dayEntry.payload &&
        Array.isArray(dayEntry.payload.fixtures) &&
        dayEntry.payload.fixtures.length > 0
      ) {
        return e.json(
          200,
          Object.assign({}, dayEntry.payload, {
            cached: true,
            stale: true,
            warning: 'API retornou 0 partidas; mantendo último resultado válido em cache.',
          }),
        )
      }

      // Se não havia cache anterior, entrega resposta com flag temporária sem salvar no cache store!
      return e.json(200, {
        configured: true,
        date: dateQuery,
        total: 0,
        hasLive: false,
        fixtures: [],
        cached: false,
        warning: 'Nenhuma partida encontrada para a data informada.',
      })
    }

    var payload = {
      configured: true,
      date: dateQuery,
      total: rawFixtures.length,
      hasLive: hasLiveMatch,
      fixtures: rawFixtures,
      updatedAt: new Date().toISOString(),
    }

    // SÓ GRAVA NO CACHE SE HOUVER PELO MENOS 1 PARTIDA!
    if (dayStore && rawFixtures.length > 0) {
      dayStore[dateQuery] = {
        timestamp: Date.now(),
        payload: payload,
        fetching: 0,
      }
    }

    return e.json(
      200,
      Object.assign({}, payload, {
        cached: false,
        ttlSeconds: Math.round((hasLiveMatch ? 5 * 60 * 1000 : 30 * 60 * 1000) / 1000),
      }),
    )
  } catch (err) {
    console.log('Erro capturado no endpoint jogos-do-dia:', err)
    if (
      typeof globalThis !== 'undefined' &&
      globalThis.__jogosDoDiaStore &&
      globalThis.__jogosDoDiaStore[dateQuery] &&
      globalThis.__jogosDoDiaStore[dateQuery].payload
    ) {
      return e.json(
        200,
        Object.assign({}, globalThis.__jogosDoDiaStore[dateQuery].payload, {
          cached: true,
          fallback: true,
        }),
      )
    }

    return e.json(200, {
      configured: true,
      date: dateQuery || '',
      total: 0,
      hasLive: false,
      fixtures: [],
      error: 'Não foi possível carregar as partidas agora. Tente novamente mais tarde.',
    })
  }
})

// -------------------------------------------------------------
// GET /backend/v1/placar-ao-vivo/config
// -------------------------------------------------------------
routerAdd('GET', '/backend/v1/placar-ao-vivo/config', (e) => {
  try {
    const authRecord = e.auth
    if (!authRecord) {
      return e.unauthorizedError('Usuário não autenticado')
    }

    const userName = (authRecord.getString('name') || authRecord.getString('username') || '')
      .trim()
      .toLowerCase()
    if (userName !== 'douglas') {
      return e.forbiddenError('Acesso restrito ao administrador Douglas.')
    }

    let provedor = 'api_football'
    let hasDbKey = false
    let maskedKey = ''
    let ativo = true

    try {
      const configRecord = $app.findFirstRecordByData(
        'config_integracoes',
        'chave',
        'placar_ao_vivo',
      )
      if (configRecord) {
        provedor = configRecord.getString('provedor') || 'api_football'
        const k = (configRecord.getString('api_key') || '').trim()
        if (k) {
          hasDbKey = true
          maskedKey = k.length > 8 ? '••••••••' + k.slice(-4) : '••••' + k.slice(-2)
        }
        ativo = configRecord.getBool('ativo')
      }
    } catch (_) {}

    // Lê chave secundária de contingência (Football-Data.org)
    let hasFallbackDbKey = false
    let maskedFallbackKey = ''
    try {
      const fbRecord = $app.findFirstRecordByData(
        'config_integracoes',
        'chave',
        'football_data_fallback',
      )
      if (fbRecord) {
        const fbK = (fbRecord.getString('api_key') || '').trim()
        if (fbK) {
          hasFallbackDbKey = true
          maskedFallbackKey = fbK.length > 8 ? '••••••••' + fbK.slice(-4) : '••••' + fbK.slice(-2)
        }
      }
    } catch (_) {}

    let hasSecretFallback = false
    try {
      if (
        ($secrets.has &&
          ($secrets.has('API_FOOTBALL_KEY') ||
            $secrets.has('RAPIDAPI_KEY') ||
            $secrets.has('FOOTBALL_DATA_KEY'))) ||
        $os.getenv('API_FOOTBALL_KEY') ||
        $os.getenv('RAPIDAPI_KEY') ||
        $os.getenv('FOOTBALL_DATA_KEY')
      ) {
        hasSecretFallback = true
      }
    } catch (_) {}

    return e.json(200, {
      provedor: provedor,
      hasKey: hasDbKey || hasSecretFallback,
      hasDbKey: hasDbKey,
      hasSecretFallback: hasSecretFallback,
      maskedKey: maskedKey,
      hasFallbackKey:
        hasFallbackDbKey ||
        Boolean($secrets.has && $secrets.has('FOOTBALL_DATA_KEY')) ||
        Boolean($os.getenv('FOOTBALL_DATA_KEY')),
      hasFallbackDbKey: hasFallbackDbKey,
      maskedFallbackKey: maskedFallbackKey,
      ativo: ativo,
    })
  } catch (err) {
    return e.json(500, {
      error: err ? err.message : 'Erro ao ler configurações',
    })
  }
})

// -------------------------------------------------------------
// POST /backend/v1/placar-ao-vivo/config
// -------------------------------------------------------------
routerAdd('POST', '/backend/v1/placar-ao-vivo/config', (e) => {
  try {
    const authRecord = e.auth
    if (!authRecord) {
      return e.unauthorizedError('Usuário não autenticado')
    }

    const userName = (authRecord.getString('name') || authRecord.getString('username') || '')
      .trim()
      .toLowerCase()
    if (userName !== 'douglas') {
      return e.forbiddenError('Acesso restrito ao administrador Douglas.')
    }

    const body = e.requestInfo().body || {}
    const provedor = (body.provedor || 'api_football').trim()
    const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : undefined
    const fallbackApiKey =
      typeof body.fallback_api_key === 'string' ? body.fallback_api_key.trim() : undefined
    const ativo = body.ativo !== false

    const col = $app.findCollectionByNameOrId('config_integracoes')
    let record
    try {
      record = $app.findFirstRecordByData('config_integracoes', 'chave', 'placar_ao_vivo')
    } catch (_) {
      record = new Record(col)
      record.set('chave', 'placar_ao_vivo')
    }

    record.set('provedor', provedor)
    record.set('ativo', ativo)
    if (apiKey !== undefined) {
      record.set('api_key', apiKey)
    }

    $app.save(record)

    // Se fornecida chave secundária para contingência (Football-Data.org)
    let fbRecord
    try {
      fbRecord = $app.findFirstRecordByData('config_integracoes', 'chave', 'football_data_fallback')
    } catch (_) {
      fbRecord = new Record(col)
      fbRecord.set('chave', 'football_data_fallback')
      fbRecord.set('provedor', 'football_data')
      fbRecord.set('ativo', true)
    }

    if (fallbackApiKey !== undefined) {
      fbRecord.set('api_key', fallbackApiKey)
      $app.save(fbRecord)
    }

    // Invalida caches ao salvar nova chave para que o admin possa testar imediatamente
    try {
      if (typeof globalThis !== 'undefined') {
        globalThis.__placarAoVivoCacheStore = {}
        globalThis.__jogosDoDiaStore = {}
      }
    } catch (_) {}

    const savedKey = record.getString('api_key') || ''
    const maskedKey = savedKey
      ? savedKey.length > 8
        ? '••••••••' + savedKey.slice(-4)
        : '••••' + savedKey.slice(-2)
      : ''

    const savedFallbackKey = fbRecord.getString('api_key') || ''
    const maskedFallbackKey = savedFallbackKey
      ? savedFallbackKey.length > 8
        ? '••••••••' + savedFallbackKey.slice(-4)
        : '••••' + savedFallbackKey.slice(-2)
      : ''

    return e.json(200, {
      success: true,
      message: 'Configurações de integração e contingência salvas com sucesso no banco de dados.',
      provedor: provedor,
      hasKey: Boolean(savedKey),
      maskedKey: maskedKey,
      hasFallbackKey: Boolean(savedFallbackKey),
      maskedFallbackKey: maskedFallbackKey,
      ativo: ativo,
    })
  } catch (err) {
    return e.json(500, {
      error: err ? err.message : 'Erro ao salvar configurações',
    })
  }
})

// -------------------------------------------------------------
// POST /backend/v1/placar-ao-vivo/test
// -------------------------------------------------------------
routerAdd('POST', '/backend/v1/placar-ao-vivo/test', (e) => {
  try {
    const authRecord = e.auth
    if (!authRecord) {
      return e.unauthorizedError('Usuário não autenticado')
    }

    const userName = (authRecord.getString('name') || authRecord.getString('username') || '')
      .trim()
      .toLowerCase()
    if (userName !== 'douglas') {
      return e.forbiddenError('Acesso restrito ao administrador Douglas.')
    }

    const body = e.requestInfo().body || {}
    const provedor = (body.provedor || 'football_data').trim()
    const isFallbackTest = body.is_fallback === true
    let apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''

    if (!apiKey) {
      if (isFallbackTest || provedor === 'football_data') {
        try {
          const fallbackRecord = $app.findFirstRecordByData(
            'config_integracoes',
            'chave',
            'football_data_fallback',
          )
          if (fallbackRecord) {
            apiKey = (fallbackRecord.getString('api_key') || '').trim()
          }
        } catch (_) {}
      }

      if (!apiKey) {
        try {
          const configRecord = $app.findFirstRecordByData(
            'config_integracoes',
            'chave',
            'placar_ao_vivo',
          )
          if (configRecord) {
            apiKey = (configRecord.getString('api_key') || '').trim()
          }
        } catch (_) {}
      }

      if (!apiKey && (isFallbackTest || provedor === 'football_data')) {
        try {
          apiKey =
            ($secrets.has && $secrets.has('FOOTBALL_DATA_KEY')
              ? $secrets.get('FOOTBALL_DATA_KEY')
              : '') ||
            $os.getenv('FOOTBALL_DATA_KEY') ||
            ''
        } catch (_) {}
      }
    }

    if (provedor === 'thesportsdb' && !apiKey) {
      apiKey = '3'
    }

    if (!apiKey) {
      return e.json(400, {
        success: false,
        message: 'Por favor, informe a API Key para realizar o teste de conexão.',
      })
    }

    // Teste Football-Data.org (usado também no teste da chave de contingência)
    if (provedor === 'football_data' || isFallbackTest) {
      try {
        const res = $http.send({
          url: 'https://api.football-data.org/v4/competitions',
          method: 'GET',
          headers: { 'X-Auth-Token': apiKey },
          timeout: 8,
        })

        if (res.statusCode === 200) {
          const count =
            (res.json && res.json.count) ||
            (res.json && res.json.competitions && res.json.competitions.length) ||
            0
          return e.json(200, {
            success: true,
            provider: 'football_data',
            isFallback: isFallbackTest,
            statusCode: res.statusCode,
            message:
              'Conexão com Football-Data.org bem-sucedida! ' + count + ' competições disponíveis.',
          })
        } else if (res.statusCode === 429) {
          return e.json(200, {
            success: false,
            rate_limited: true,
            provider: 'football_data',
            isFallback: isFallbackTest,
            statusCode: 429,
            message:
              'Football-Data.org retornou limite de requisições excedido (HTTP 429). Tente novamente mais tarde.',
          })
        } else if (res.statusCode === 403 || res.statusCode === 401) {
          return e.json(400, {
            success: false,
            provider: 'football_data',
            isFallback: isFallbackTest,
            statusCode: res.statusCode,
            message:
              'Falha de autenticação: Chave de API inválida ou não autorizada pela Football-Data.org (HTTP ' +
              res.statusCode +
              ').',
          })
        } else {
          return e.json(400, {
            success: false,
            provider: 'football_data',
            isFallback: isFallbackTest,
            statusCode: res.statusCode,
            message:
              'A Football-Data.org retornou status HTTP ' + res.statusCode + ': ' + (res.raw || ''),
          })
        }
      } catch (errReq) {
        return e.json(500, {
          success: false,
          provider: 'football_data',
          isFallback: isFallbackTest,
          message:
            'Erro ao conectar à Football-Data.org: ' +
            (errReq ? errReq.message : 'Timeout ou erro de rede'),
        })
      }
    }

    // Teste TheSportsDB
    if (provedor === 'thesportsdb') {
      try {
        const res = $http.send({
          url:
            'https://www.thesportsdb.com/api/v1/json/' +
            encodeURIComponent(apiKey) +
            '/all_sports.php',
          method: 'GET',
          timeout: 8,
        })

        if (res.statusCode === 200 && res.json && Array.isArray(res.json.sports)) {
          return e.json(200, {
            success: true,
            provider: 'thesportsdb',
            statusCode: res.statusCode,
            message: 'Conexão com TheSportsDB bem-sucedida! Esportes retornados com sucesso.',
          })
        } else {
          return e.json(400, {
            success: false,
            provider: 'thesportsdb',
            statusCode: res.statusCode,
            message:
              'A TheSportsDB retornou status HTTP ' + res.statusCode + ' ou resposta inesperada.',
          })
        }
      } catch (errReq) {
        return e.json(500, {
          success: false,
          provider: 'thesportsdb',
          message:
            'Erro ao conectar à TheSportsDB: ' +
            (errReq ? errReq.message : 'Timeout ou erro de rede'),
        })
      }
    }

    // Teste API-Football
    if (provedor === 'api_football') {
      const isRapid = apiKey.length > 40
      let urlTest = 'https://v3.football.api-sports.io/status'
      let headersTest = {
        'x-apisports-key': apiKey,
      }

      if (isRapid) {
        urlTest = 'https://api-football-v1.p.rapidapi.com/v3/timezone'
        headersTest = {
          'x-rapidapi-key': apiKey,
          'x-rapidapi-host': 'api-football-v1.p.rapidapi.com',
        }
      }

      try {
        const res = $http.send({
          url: urlTest,
          method: 'GET',
          headers: headersTest,
          timeout: 8,
        })

        if (res.statusCode === 200) {
          return e.json(200, {
            success: true,
            provider: 'api_football',
            statusCode: res.statusCode,
            message: 'Conexão com API-Football bem-sucedida! Conta ativa e autorizada.',
          })
        } else if (res.statusCode === 429) {
          return e.json(200, {
            success: false,
            rate_limited: true,
            provider: 'api_football',
            statusCode: 429,
            message:
              'API-Football atingiu o limite de cota (Status 429). A contingência automática para Football-Data.org assumirá as consultas.',
          })
        } else {
          return e.json(400, {
            success: false,
            provider: 'api_football',
            statusCode: res.statusCode,
            message: 'API-Football retornou status HTTP ' + res.statusCode,
          })
        }
      } catch (errReq) {
        return e.json(500, {
          success: false,
          provider: 'api_football',
          message:
            'Erro ao conectar à API-Football: ' +
            (errReq ? errReq.message : 'Timeout ou erro de rede'),
        })
      }
    }

    return e.json(400, {
      success: false,
      message: 'Provedor desconhecido: ' + provedor,
    })
  } catch (err) {
    return e.json(500, {
      success: false,
      error: err ? err.message : 'Erro inesperado no teste de conexão',
    })
  }
})

// -------------------------------------------------------------
// POST /backend/v1/limpar-cache (ou /backend/v1/placar-ao-vivo/limpar-cache)
// -------------------------------------------------------------
routerAdd('POST', '/backend/v1/placar-ao-vivo/limpar-cache', (e) => {
  try {
    const authRecord = e.auth
    if (!authRecord) {
      return e.unauthorizedError('Usuário não autenticado')
    }

    const userName = (authRecord.getString('name') || authRecord.getString('username') || '')
      .trim()
      .toLowerCase()
    if (userName !== 'douglas') {
      return e.forbiddenError('Acesso restrito ao administrador Douglas.')
    }

    let clearedStores = []

    if (typeof globalThis !== 'undefined') {
      if (globalThis.__placarAoVivoCacheStore) {
        globalThis.__placarAoVivoCacheStore = {}
        clearedStores.push('placar_ao_vivo')
      }
      if (globalThis.__jogosDoDiaStore) {
        globalThis.__jogosDoDiaStore = {}
        clearedStores.push('jogos_do_dia')
      }
    }

    console.log(
      '[Cache] Cache do servidor limpo com sucesso pelo administrador Douglas:',
      clearedStores.join(', '),
    )

    return e.json(200, {
      success: true,
      message: 'Cache limpo — próxima busca será direto na API',
      cleared: clearedStores,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    return e.json(500, {
      success: false,
      error: err ? err.message : 'Erro ao limpar cache do servidor',
    })
  }
})

// Rota de conveniência POST /backend/v1/limpar-cache
routerAdd('POST', '/backend/v1/limpar-cache', (e) => {
  try {
    const authRecord = e.auth
    if (!authRecord) {
      return e.unauthorizedError('Usuário não autenticado')
    }

    const userName = (authRecord.getString('name') || authRecord.getString('username') || '')
      .trim()
      .toLowerCase()
    if (userName !== 'douglas') {
      return e.forbiddenError('Acesso restrito ao administrador Douglas.')
    }

    if (typeof globalThis !== 'undefined') {
      globalThis.__placarAoVivoCacheStore = {}
      globalThis.__jogosDoDiaStore = {}
    }

    console.log('[Cache] POST /backend/v1/limpar-cache executado com sucesso.')

    return e.json(200, {
      success: true,
      message: 'Cache limpo — próxima busca será direto na API',
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    return e.json(500, {
      success: false,
      error: err ? err.message : 'Erro ao limpar cache do servidor',
    })
  }
})

// -------------------------------------------------------------
// POST /backend/v1/placar-ao-vivo/sobrescrever
// -------------------------------------------------------------
routerAdd('POST', '/backend/v1/placar-ao-vivo/sobrescrever', (e) => {
  try {
    const authRecord = e.auth
    if (!authRecord) {
      return e.unauthorizedError('Usuário não autenticado')
    }

    const userName = (authRecord.getString('name') || authRecord.getString('username') || '')
      .trim()
      .toLowerCase()
    if (userName !== 'douglas') {
      return e.forbiddenError('Acesso restrito ao administrador Douglas.')
    }

    const body = e.requestInfo().body || {}
    const jogoId = (body.jogo_id || '').trim()
    if (!jogoId) {
      return e.badRequestError('jogo_id é obrigatório.')
    }

    const col = $app.findCollectionByNameOrId('config_integracoes')
    let record
    try {
      record = $app.findFirstRecordByData('config_integracoes', 'chave', 'sobrescrita_jogos')
    } catch (_) {
      record = new Record(col)
      record.set('chave', 'sobrescrita_jogos')
      record.set('provedor', 'api_football')
      record.set('ativo', true)
    }

    let map = {}
    try {
      const raw = record.getString('api_key') || ''
      if (raw && raw.trim()) {
        map = JSON.parse(raw)
      }
    } catch (_) {}

    if (body.remover === true) {
      delete map[jogoId]
    } else {
      var parseNamesList = function (input) {
        if (!input) return []
        if (Array.isArray(input)) {
          return input
            .map(function (m) {
              return String(m || '').trim()
            })
            .filter(Boolean)
        }
        if (typeof input === 'string') {
          return input
            .split(',')
            .map(function (m) {
              return m.trim()
            })
            .filter(Boolean)
        }
        return []
      }

      var marcadoresListA = parseNamesList(body.marcadores_a)
      var marcadoresListB = parseNamesList(body.marcadores_b)
      var marcadoresList = parseNamesList(body.marcadores)

      if (
        marcadoresList.length === 0 &&
        (marcadoresListA.length > 0 || marcadoresListB.length > 0)
      ) {
        marcadoresList = marcadoresListA.concat(marcadoresListB)
      }

      map[jogoId] = {
        jogo_id: jogoId,
        placar_a:
          typeof body.placar_a === 'number' ? body.placar_a : parseInt(body.placar_a, 10) || 0,
        placar_b:
          typeof body.placar_b === 'number' ? body.placar_b : parseInt(body.placar_b, 10) || 0,
        marcadores: marcadoresList,
        marcadores_a: marcadoresListA,
        marcadores_b: marcadoresListB,
        status: (body.status || 'Ao Vivo').trim(),
        updated_at: new Date().toISOString(),
      }
    }

    record.set('api_key', JSON.stringify(map))
    $app.save(record)

    return e.json(200, {
      success: true,
      message: 'Sobrescrita manual salva com sucesso pelo administrador.',
      sobrescritas: map,
    })
  } catch (err) {
    return e.json(500, {
      success: false,
      error: err ? err.message : 'Erro ao salvar sobrescrita manual',
    })
  }
})
